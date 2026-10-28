// One command, script to finished video:
//   voiceover -> b-roll -> timeline -> audio -> render -> loudness master -> check
// Usage: node scripts/auto.mjs [--from=broll] [--no-render]
// Env:   REMOTION_BROWSER=/path/to/chrome   (only if Remotion can't download its own)
//        REMOTION_FLAGS="--concurrency=4"     (extra flags for the render step)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, ffmpeg, fail, log, readProject } from "./lib.mjs";

const args = process.argv.slice(2);
const from = args.find((a) => a.startsWith("--from="))?.slice(7);
const noRender = args.includes("--no-render");
const project = readProject();

const run = (cmd, cmdArgs) => {
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) fail(`step failed: ${cmd} ${cmdArgs.join(" ")}`);
};

const steps = [
  ["voice", () => (project.voice.provider === "file" ? run("node", ["scripts/transcribe.mjs"]) : run("python3", ["scripts/voiceover.py"]))],
  ["broll", () => run("node", ["scripts/fetch-broll.mjs"])],
  ["timeline", () => run("node", ["scripts/build-timeline.mjs"])],
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
];

let started = !from;
for (const [name, fn] of steps) {
  if (name === from) started = true;
  if (!started) continue;
  if (noRender && ["render", "master", "check"].includes(name)) continue;
  log("auto", `--- ${name} ---`);
  fn();
}
if (!noRender) log("auto", "done -> out/final.mp4  (inspect the out/check/ contact sheets before delivering)");
