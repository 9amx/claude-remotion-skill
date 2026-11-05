// One command, script to finished video:
//   lint -> voiceover -> b-roll -> timeline -> storyboard -> audio -> render -> loudness master -> check
//   -> thumbnail -> qa (hard gate) [-> YouTube upload, only with --upload]
// Usage: node scripts/auto.mjs [--review] [--from=broll] [--only=voice] [--no-render] [--upload]
//   --review  lint + voice, then B-roll candidate sheets for every shot, with the
//             words spoken over it (build/review/), and stop. Pick, then continue with --from=broll.
//   --upload  after a clean run, upload to YouTube (scripts/youtube.mjs; sign in once with --auth)
// Env:   REMOTION_BROWSER=/path/to/chrome   (only if Remotion can't download its own)
//        REMOTION_FLAGS="--concurrency=4"     (extra flags for the render step)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PYTHON, ROOT, ffmpeg, fail, log, readProject, status } from "./lib.mjs";

const args = process.argv.slice(2);
const from = args.find((a) => a.startsWith("--from="))?.slice(7);
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const noRender = args.includes("--no-render");
const reviewMode = args.includes("--review");
const uploadAfter = args.includes("--upload");
const project = readProject();

const run = (cmd, cmdArgs) => {
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) fail(`step failed: ${cmd} ${cmdArgs.join(" ")}`);
};

const steps = [
  // Hook/script gate first: errors stop here, before any voice or render time is spent.
  ["lint", () => run("node", ["scripts/lint-script.mjs", "--strict"])],
  ["voice", () => (project.voice.provider === "file" ? run("node", ["scripts/transcribe.mjs"]) : run(PYTHON, ["scripts/voiceover.py"]))],
  ["broll", () => run("node", ["scripts/fetch-broll.mjs", ...(reviewMode ? ["--review"] : [])])],
  // Repeated footage is reported here and blocks the render below, so the storyboard can still be used to fix it.
  ["timeline", () => { run("node", ["scripts/build-timeline.mjs"]); run("node", ["scripts/check-repeats.mjs"]); }],
  // Every shot as a picture with its words, before any render time is spent.
  ["storyboard", () => run("node", ["scripts/storyboard.mjs"])],
  ["audio", () => run("node", ["scripts/gen-audio.mjs"])],
  ["render", () => { run("node", ["scripts/check-repeats.mjs", "--strict"]); run("node", ["scripts/render.mjs"]); }], // chunked + resumable for long videos
  ["master", () => {
    // Platforms normalise to about -14 LUFS; mastering there keeps the VO punchy.
    // Gain to the target, then a true-peak-safe limiter (oversampled, delay compensated)
    // so impacts and transients can't clip on phones; measured after the AAC encode, the
    // same way the qa gate measures, and corrected up to 4 times.
    const TARGET = project.qa?.lufs ?? -14;
    const measure = (file) => {
      const m = ffmpeg(["-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true });
      const sum = (m.stderr || "").split("Summary:").pop();
      const i = Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]), tp = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]);
      return Number.isFinite(i) ? { i, tp: Number.isFinite(tp) ? tp : 0 } : null;
    };
    const src = measure("out/video.mp4");
    const encode = (af) => ffmpeg(["-y", "-i", "out/video.mp4", "-c:v", "copy", "-af", af, "-ar", "48000",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "out/final.mp4"]).status === 0;
    let ok = false;
    if (src) {
      let gain = TARGET - src.i, ceil = -2.0;
      // A mix that needs a lot of limiting (a quiet voice under loud impacts, or no voice at all)
      // gets a gentle compressor first: hard-limited peaks turn into overshoot in the AAC encode.
      const comp = src.tp + gain - ceil > 3;
      const pre = gain; // into the compressor; corrections after it (make-up gain) act one to one
      if (comp) log("master", `peaks would need ${(src.tp + gain - ceil).toFixed(1)} dB of limiting - compressing gently first`);
      for (let k = 0; k < 5; k++) {
        const lim = Math.pow(10, ceil / 20).toFixed(4);
        ok = encode(`volume=${pre.toFixed(2)}dB,${comp ? "acompressor=threshold=-14dB:ratio=4:attack=3:release=150:knee=4," : ""}volume=${(gain - pre).toFixed(2)}dB,aresample=192000,alimiter=limit=${lim}:attack=2:release=80:level=false:latency=true,aresample=48000`);
        if (!ok) break;
        const out = measure("out/final.mp4");
        if (!out) break;
        log("master", `pass ${k + 1}: ${out.i.toFixed(1)} LUFS, true peak ${out.tp.toFixed(1)} dBTP`);
        const loudOk = Math.abs(out.i - TARGET) <= 0.7, peakOk = out.tp <= -1.2;
        if (loudOk && peakOk) break;
        // fix the peak first (lower the ceiling), the loudness only while the peak is safe
        if (!peakOk) ceil -= out.tp + 1.2 + 0.3;
        else gain += TARGET - out.i;
      }
    }
    if (!ok) {
      fs.copyFileSync(path.join(ROOT, "out/video.mp4"), path.join(ROOT, "out/final.mp4"));
      log("master", "could not master the audio, copied video.mp4 -> final.mp4 unmastered");
    }
  }],
  ["check", () => run("node", ["scripts/check.mjs"])],
  ["thumbnail", () => run("node", ["scripts/thumbnail.mjs"])],
  // Hard gate: black frames, frozen picture, dead air, clipping, loudness, sync. A failure stops here, before upload.
  ["qa", () => run("node", ["scripts/qa.mjs"])],
  ["upload", () => run("node", ["scripts/youtube.mjs"])],
];

// Live status page (build/status.html): which step, how far, what needs fixing.
const DOING = {
  lint: "Checking the script", voice: "Cleaning the voice and finding every word's timing", broll: "Finding footage for every shot",
  timeline: "Laying the edit out on the words", storyboard: "Drawing the storyboard", audio: "Music and sound effects",
  render: "Rendering the video", master: "Setting the loudness", check: "Checking the finished video", thumbnail: "Making the thumbnail", qa: "Final quality check", upload: "Uploading",
};
const planned = steps.map(([n]) => n).filter((n) => (n !== "upload" || uploadAfter) && !(reviewMode && !["lint", "voice", "broll"].includes(n)) &&
  !(noRender && ["render", "master", "check", "thumbnail", "qa", "upload"].includes(n)) && (!only || n === only));
status({ title: project.title ?? "Video", steps: planned, done: from ? planned.slice(0, Math.max(0, planned.indexOf(from))) : [],
  step: null, doing: "Starting", progress: null, etaSec: null, finished: false, failed: null, ...(from ? {} : { issues: [], stats: {} }) });
log("auto", `live status: ${path.join(ROOT, "build", "status.html")} (open it in a browser)`);
// The editor view (preview + timeline + live status) runs on its own in the
// background and keeps running after this run; a second start just finds it.
if (!args.includes("--no-editor")) {
  spawn(process.execPath, [path.join(ROOT, "scripts", "editor.mjs")], { cwd: ROOT, stdio: "ignore", detached: true, env: process.env }).unref();
  log("auto", "editor view: http://localhost:3100  (preview, timeline, inspector - or run: npm run editor)");
  if (!args.includes("--no-remote") && process.env.REMOTE_AGENT_TOKEN && (process.env.REMOTE_URL || process.env.REMOTE_AGENT_URL)) {
    spawn(process.execPath, [path.join(ROOT, "scripts", "remote-agent.mjs")], { cwd: ROOT, stdio: "ignore", detached: true, env: process.env }).unref();
    log("auto", `remote agent: connecting to ${process.env.REMOTE_URL || process.env.REMOTE_AGENT_URL}`);
  }
}
const done = new Set(from ? planned.slice(0, Math.max(0, planned.indexOf(from))) : []);

let started = !from;
for (const [name, fn] of steps) {
  if (name === from) started = true;
  if (!started || (only && name !== only)) continue;
  if (reviewMode && !["lint", "voice", "broll"].includes(name)) break;
  if (noRender && ["render", "master", "check", "thumbnail", "qa", "upload"].includes(name)) continue;
  if (name === "upload" && !uploadAfter && only !== "upload") continue;
  log("auto", `--- ${name} ---`);
  status({ step: name, doing: DOING[name] ?? name, progress: null, etaSec: null });
  fn();
  done.add(name);
  status({ done: [...done], progress: null, etaSec: null });
}
status(reviewMode ? { step: null, doing: "Review sheets ready - pick the footage", finished: false } : { step: null, finished: !noRender && !only, output: "out/final.mp4", doing: "Done" });
if (reviewMode) log("auto", "review sheets ready in build/review/ - pick into build/picks.json, then: node scripts/auto.mjs --from=broll");
else if (!noRender && !only) {
  log("auto", "done -> out/final.mp4 + out/thumbnail.jpg  (inspect the out/check/ contact sheets and the thumbnail before delivering)");
  if (!uploadAfter) log("auto", "upload: node scripts/youtube.mjs --dry-run, then node scripts/youtube.mjs");
}
