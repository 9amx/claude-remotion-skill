// Verify the render: timeline lint, a contact sheet of key frames, loudness.
// Output: out/check/NNN.jpg (one per shot + hook frames), out/check/contact.jpg
// LOOK at contact.jpg (and individual frames) before delivering. Always.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC, ROOT, fail, hasCommand, log, readJson } from "./lib.mjs";

const t = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!t) fail("No public/timeline.json - build the timeline first.");
const video = ["out/final.mp4", "out/video.mp4"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
if (!video) fail("No render in out/ - render first.");
const ff = hasCommand("ffmpeg") ? ["ffmpeg"] : ["npx", "remotion", "ffmpeg"];
const ffmpeg = (a, capture = false) =>
  spawnSync(ff[0], [...ff.slice(1), "-y", "-v", capture ? "info" : "error", ...a], { cwd: ROOT, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });

// 1. Timeline lint
const warnings = [];
const allShots = t.scenes.flatMap((s) => s.shots.map((sh) => ({ ...sh, scene: s.id, at: s.startFrame + sh.from })));
for (const sh of allShots) {
  if (sh.durationInFrames < t.fps * 0.6) warnings.push(`${sh.scene}: shot at frame ${sh.at} is only ${sh.durationInFrames} frames`);
  if (sh.durationInFrames > t.fps * 6) warnings.push(`${sh.scene}: shot at frame ${sh.at} holds ${(sh.durationInFrames / t.fps).toFixed(1)}s - add B-roll keywords`);
}
const kinetic = allShots.filter((s) => s.type === "kinetic").length;
if (kinetic > allShots.length / 2) warnings.push(`${kinetic}/${allShots.length} shots are kinetic fallbacks - set PEXELS_API_KEY or add file: assets`);
const long = t.words.filter((w) => w.text.length > 14);
if (long.length) warnings.push(`long caption words may overflow: ${long.map((w) => w.text).join(", ")}`);
if (t.durationInFrames / t.fps > 60 && t.width < t.height) warnings.push("vertical video is over 60s - too long for most Shorts feeds");

// 2. Key frames: hook (0.1s, 0.5s), then the middle of every shot
const dir = path.join(ROOT, "out", "check");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const times = [0.1, 0.5, ...allShots.map((s) => (s.at + s.durationInFrames / 2) / t.fps)];
times.forEach((sec, i) => ffmpeg(["-ss", sec.toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "3", path.join(dir, `${String(i + 1).padStart(3, "0")}.jpg`)]));
const cols = t.width > t.height ? 4 : 6;
const rows = Math.ceil(times.length / cols);
ffmpeg(["-i", path.join(dir, "%03d.jpg"), "-vf", `scale=${t.width > t.height ? 480 : 270}:-1,tile=${cols}x${rows}:padding=6:color=white`, "-frames:v", "1", path.join(dir, "contact.jpg")]);

// 3. Loudness
const r = ffmpeg(["-i", video, "-af", "loudnorm=print_format=json", "-f", "null", "-"], true);
const m = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(r.stderr || "");
const lufs = m ? parseFloat(m[1]) : null;
if (lufs !== null && (lufs < -17 || lufs > -11)) warnings.push(`integrated loudness ${lufs} LUFS (target -14)`);

log("check", `${path.relative(ROOT, video)}: ${(t.durationInFrames / t.fps).toFixed(1)}s, ${t.scenes.length} scenes, ${allShots.length} shots, ${lufs ?? "?"} LUFS`);
log("check", `frames: out/check/001-${String(times.length).padStart(3, "0")}.jpg, sheet: out/check/contact.jpg`);
for (const w of warnings) console.log(`  \x1b[33m! ${w}\x1b[0m`);
if (!warnings.length) log("check", "no lint warnings - now inspect the frames visually");
