// One command, script to finished video:
//   lint -> voiceover -> b-roll -> timeline -> storyboard -> audio -> render -> loudness master -> check
//   -> thumbnail [-> YouTube upload, only with --upload]
// Usage: node scripts/auto.mjs [--review] [--from=broll] [--only=voice] [--no-render] [--upload]
//   --review  lint + voice, then B-roll candidate sheets for every shot, with the
//             words spoken over it (build/review/), and stop. Pick, then continue with --from=broll.
//   --upload  after a clean run, upload to YouTube (scripts/youtube.mjs; sign in once with --auth)
// Env:   REMOTION_BROWSER=/path/to/chrome   (only if Remotion can't download its own)
//        REMOTION_FLAGS="--concurrency=4"     (extra flags for the render step)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PYTHON, ROOT, ffmpeg, fail, log, readProject } from "./lib.mjs";

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
  ["timeline", () => run("node", ["scripts/build-timeline.mjs"])],
  // Every shot as a picture with its words, before any render time is spent.
  ["storyboard", () => run("node", ["scripts/storyboard.mjs"])],
  ["audio", () => run("node", ["scripts/gen-audio.mjs"])],
  ["render", () => run("node", ["scripts/render.mjs"])], // chunked + resumable for long videos
  ["master", () => {
    // Platforms normalise to about -14 LUFS; mastering there keeps the VO punchy.
    // Two-pass loudnorm: measure, then apply linearly (single pass undershoots).
    const target = "I=-14:TP=-1.5:LRA=11";
    const m = ffmpeg(["-i", "out/video.mp4", "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { capture: true });
    const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(m.stderr || "");
    let af = `loudnorm=${target}`;
    if (json) {
      const v = JSON.parse(json[0]);
      af += `:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true`;
    }
    const r = ffmpeg(["-i", "out/video.mp4", "-c:v", "copy", "-af", af, "-ar", "48000",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "out/final.mp4"]);
    if (r.status !== 0) {
      fs.copyFileSync(path.join(ROOT, "out/video.mp4"), path.join(ROOT, "out/final.mp4"));
      log("master", "loudnorm unavailable, copied video.mp4 -> final.mp4 unmastered");
    }
  }],
  ["check", () => run("node", ["scripts/check.mjs"])],
  ["thumbnail", () => run("node", ["scripts/thumbnail.mjs"])],
  ["upload", () => run("node", ["scripts/youtube.mjs"])],
];

let started = !from;
for (const [name, fn] of steps) {
  if (name === from) started = true;
  if (!started || (only && name !== only)) continue;
  if (reviewMode && !["lint", "voice", "broll"].includes(name)) break;
  if (noRender && ["render", "master", "check", "thumbnail", "upload"].includes(name)) continue;
  if (name === "upload" && !uploadAfter && only !== "upload") continue;
  log("auto", `--- ${name} ---`);
  fn();
}
if (reviewMode) log("auto", "review sheets ready in build/review/ - pick into build/picks.json, then: node scripts/auto.mjs --from=broll");
else if (!noRender && !only) {
  log("auto", "done -> out/final.mp4 + out/thumbnail.jpg  (inspect the out/check/ contact sheets and the thumbnail before delivering)");
  if (!uploadAfter) log("auto", "upload: node scripts/youtube.mjs --dry-run, then node scripts/youtube.mjs");
}
