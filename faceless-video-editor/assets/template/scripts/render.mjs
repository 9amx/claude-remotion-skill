// Render out/video.mp4.
// Short videos: one Remotion render. Long videos (> renderChunkMinutes * 1.5):
// split at scene boundaries into ~renderChunkMinutes parts, render each part
// muted, render the audio once, then join without re-encoding. Every part is
// cached by a hash of its content + src/, so a crash or a one-line script fix
// re-renders only the parts that changed.
// Env: REMOTION_BROWSER=/path/to/chrome, REMOTION_FLAGS="--concurrency=8 ..."
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC, ROOT, ffmpeg, fail, log, readJson, readProject, remotionCmd, sha1, timecode, writeJson } from "./lib.mjs";

const project = readProject();
const t = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!t) fail("No public/timeline.json - build the timeline first.");
const chunkFrames = Math.round((project.renderChunkMinutes ?? 5) * 60 * t.fps);
const flags = [
  ...(process.env.REMOTION_BROWSER ? [`--browser-executable=${process.env.REMOTION_BROWSER}`] : []),
  ...(process.env.REMOTION_FLAGS || "").split(/\s+/).filter(Boolean),
];
const OUT = path.join(ROOT, "out");
fs.mkdirSync(OUT, { recursive: true });

const remotion = (args) => {
  const r = spawnSync(...remotionCmd(["render", "src/index.ts", "Faceless", ...args, "--overwrite", ...flags]), { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) fail(`render failed: ${args.join(" ")}`);
};

if (t.durationInFrames <= chunkFrames * 1.5) {
  remotion(["out/video.mp4", "--codec", "h264", "--crf", "18"]);
  process.exit(0);
}

// ---------- chunked ----------
// Cut points: the first scene start past each chunk length.
const ranges = [];
let from = 0;
for (const s of t.scenes) {
  if (s.startFrame - from >= chunkFrames) {
    ranges.push([from, s.startFrame - 1]);
    from = s.startFrame;
  }
}
ranges.push([from, t.durationInFrames - 1]);

// What a part's pixels depend on: the timeline content overlapping it + all source code.
const srcHash = sha1(
  fs.readdirSync(path.join(ROOT, "src"), { recursive: true })
    .map(String).sort()
    .filter((f) => fs.statSync(path.join(ROOT, "src", f)).isFile())
    .map((f) => f + fs.readFileSync(path.join(ROOT, "src", f), "utf8"))
    .join("\n"),
);
// Total length only matters to the progress bar; otherwise a line edited near
// the end would invalidate every part before it.
const global = { ...t, scenes: undefined, words: undefined, music: undefined, chapters: undefined,
  sfx: undefined, sfxLevel: undefined, sfxFiles: undefined, sfxPeaks: undefined, reveals: undefined, // audio only; parts are muted
  durationInFrames: t.progressBar ? t.durationInFrames : undefined };
const flagsKey = (process.env.REMOTION_FLAGS || "").replace(/--concurrency=\S+/, "");

const dir = path.join(OUT, "parts");
fs.mkdirSync(dir, { recursive: true });
const manifestFile = path.join(dir, "manifest.json");
const manifest = readJson(manifestFile, {});
const parts = [];
// Progress for long renders: frames per second so far -> time left.
const t0 = Date.now();
let doneFrames = 0;
let todo = ranges.reduce((n, [a, b]) => n + b - a + 1, 0);
for (const [i, [a, b]] of ranges.entries()) {
  const scenes = t.scenes.filter((s) => s.startFrame <= b && s.startFrame + s.durationInFrames > a);
  const words = t.words.filter((w) => (w.endMs / 1000) * t.fps >= a - t.fps && (w.startMs / 1000) * t.fps <= b + t.fps);
  const chapters = t.chapters.filter((c) => c.startFrame <= b && c.startFrame + c.durationInFrames > a).map((c) => c.title);
  const key = sha1(JSON.stringify({ a, b, srcHash, global, scenes, words, chapters, flagsKey }));
  const file = path.join(dir, `part-${String(i + 1).padStart(3, "0")}.mp4`);
  parts.push(file);
  const label = `part ${i + 1}/${ranges.length} (${timecode(a / t.fps)}-${timecode((b + 1) / t.fps)})`;
  if (manifest[path.basename(file)] === key && fs.existsSync(file)) {
    log("render", `${label} unchanged, skipped`);
    todo -= b - a + 1;
    continue;
  }
  log("render", label);
  const ts = Date.now();
  remotion([path.relative(ROOT, file), `--frames=${a}-${b}`, "--muted", "--codec", "h264", "--crf", "18"]);
  manifest[path.basename(file)] = key;
  writeJson(manifestFile, manifest); // saved after every part: a crash keeps finished parts
  doneFrames += b - a + 1;
  const fps = doneFrames / ((Date.now() - t0) / 1000);
  log("render", `${label} done in ${Math.round((Date.now() - ts) / 1000)}s - ${fps.toFixed(1)} frames/s, about ${Math.ceil((todo - doneFrames) / fps / 60)} min left`);
}
// Drop parts from an earlier, longer layout.
for (const f of fs.readdirSync(dir)) {
  if (/^part-\d+\.mp4$/.test(f) && !parts.includes(path.join(dir, f))) fs.rmSync(path.join(dir, f));
}

log("render", "audio (whole video, one pass)");
remotion(["out/parts/audio.wav", "--codec", "wav"]);

log("render", `joining ${parts.length} parts`);
const list = path.join(dir, "list.txt");
fs.writeFileSync(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
const r = ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-i", path.join(dir, "audio.wav"),
  "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", path.join(OUT, "video.mp4")]);
if (r.status !== 0) fail("joining parts failed");
log("render", `out/video.mp4 (${timecode(t.durationInFrames / t.fps)})`);
