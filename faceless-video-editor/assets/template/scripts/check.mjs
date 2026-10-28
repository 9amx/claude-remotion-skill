// Verify the render: timeline lint, contact sheets of key frames, loudness.
// Output: out/check/frames/NNNN.jpg (hook frames + middle of every shot) and
//   out/check/contact.jpg                    one chapter (Shorts)
//   out/check/ch01-1.jpg, ch01-2.jpg, ...    long form: per chapter, max 30 tiles each
// LOOK at the sheets (and single frames where something looks off) before delivering.
import fs from "node:fs";
import path from "node:path";
import { PUBLIC, ROOT, ffmpeg, fail, log, readJson, timecode } from "./lib.mjs";

const t = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!t) fail("No public/timeline.json - build the timeline first.");
const video = ["out/final.mp4", "out/video.mp4"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
if (!video) fail("No render in out/ - render first.");
const sec = (f) => f / t.fps;

// 1. Timeline lint
const warnings = [];
const allShots = t.scenes.flatMap((s) => s.shots.map((sh) => ({ ...sh, scene: s.id, chapter: s.chapter, at: s.startFrame + sh.from })));
for (const sh of allShots) {
  const where = `${sh.scene} @ ${timecode(sec(sh.at))}`;
  if (sh.durationInFrames < t.fps * 0.6) warnings.push(`${where}: shot only ${sh.durationInFrames} frames`);
  if (sh.durationInFrames > t.fps * 8) warnings.push(`${where}: shot holds ${sec(sh.durationInFrames).toFixed(1)}s - add B-roll keywords`);
}
for (let i = 1; i < allShots.length; i++) {
  if (allShots[i].src && allShots[i].src === allShots[i - 1].src) warnings.push(`${allShots[i].scene}: same clip twice in a row (${allShots[i].src})`);
}
t.chapters.forEach((ch, c) => {
  const shots = allShots.filter((s) => s.chapter === c);
  const kinetic = shots.filter((s) => s.type === "kinetic").length;
  if (shots.length && kinetic > shots.length / 2) {
    warnings.push(`${t.chapters.length > 1 ? `chapter ${c + 1} "${ch.title}": ` : ""}${kinetic}/${shots.length} shots are kinetic fallbacks - check API keys / rate limits, or add file: assets`);
  }
});
for (const s of t.scenes) {
  if (s.chapterStart && t.showChapterCards && (s.emphasis || s.lowerThird)) warnings.push(`${s.id}: emphasis/lowerThird on a chapter's first scene collides with the chapter card`);
}
const long = t.words.filter((w) => w.text.length > 14);
if (long.length && t.captions.style !== "subtitle") warnings.push(`long caption words may overflow: ${[...new Set(long.map((w) => w.text))].slice(0, 10).join(", ")}`);
if (sec(t.durationInFrames) > 60 && t.width < t.height) warnings.push("vertical video is over 60s - too long for most Shorts feeds");
if (sec(t.durationInFrames) > 180 && t.captions.style === "pop") warnings.push('3-word pop captions for a long video get tiring: consider captions.style "subtitle"');

// 2. Key frames: hook (0.1s, 0.5s), then the middle of every shot
const dir = path.join(ROOT, "out", "check");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
const samples = [
  { at: 0.1, chapter: 0 },
  { at: 0.5, chapter: 0 },
  ...allShots.map((s) => ({ at: sec(s.at + s.durationInFrames / 2), chapter: s.chapter })),
];
samples.forEach((s, i) => {
  s.file = path.join(dir, "frames", `${String(i + 1).padStart(4, "0")}.jpg`);
  ffmpeg(["-ss", s.at.toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "4", "-vf", `scale=${t.width > t.height ? 480 : 270}:-2`, s.file]);
});

// 3. Contact sheets; the log prints each sheet's time range so a bad tile maps back to the video
const portrait = t.width < t.height;
const cols = portrait ? 6 : 5, maxTiles = cols * (portrait ? 3 : 6);
const sheets = [];
const groups = t.chapters.length > 1 ? t.chapters.map((_, c) => samples.filter((s) => s.chapter === c)) : [samples];
groups.forEach((group, c) => {
  for (let p = 0; p * maxTiles < group.length; p++) {
    const tiles = group.slice(p * maxTiles, (p + 1) * maxTiles);
    const list = path.join(dir, "frames", `list-${c}-${p}.txt`);
    fs.writeFileSync(list, tiles.map((s) => `file '${s.file}'\nduration 1`).join("\n") + "\n");
    const name = t.chapters.length > 1 ? `ch${String(c + 1).padStart(2, "0")}-${p + 1}.jpg` : p ? `contact-${p + 1}.jpg` : "contact.jpg";
    const rows = Math.ceil(tiles.length / cols);
    ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", `tile=${cols}x${rows}:padding=6:color=white`, "-frames:v", "1", "-q:v", "3", path.join(dir, name)]);
    sheets.push(`${name} (${timecode(tiles[0].at)}-${timecode(tiles[tiles.length - 1].at)})`);
  }
});

// 4. Loudness
const r = ffmpeg(["-i", video, "-af", "loudnorm=print_format=json", "-f", "null", "-"], { capture: true });
const m = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(r.stderr || "");
const lufs = m ? parseFloat(m[1]) : null;
if (lufs !== null && (lufs < -17 || lufs > -11)) warnings.push(`integrated loudness ${lufs} LUFS (target -14)`);

log("check", `${path.relative(ROOT, video)}: ${timecode(sec(t.durationInFrames))}, ${t.chapters.length} chapter(s), ${t.scenes.length} scenes, ${allShots.length} shots, ${lufs ?? "?"} LUFS`);
log("check", `contact sheets in out/check/: ${sheets.join(", ")}`);
for (const w of warnings.slice(0, 40)) console.log(`  \x1b[33m! ${w}\x1b[0m`);
if (warnings.length > 40) console.log(`  \x1b[33m! ...and ${warnings.length - 40} more\x1b[0m`);
if (!warnings.length) log("check", "no lint warnings - now inspect the sheets visually");
