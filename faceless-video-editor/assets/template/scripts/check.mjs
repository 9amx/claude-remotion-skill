// Verify the render: timeline lint, contact sheets of key frames, loudness.
// Output: out/check/frames/NNNN.jpg (hook frames + middle of every shot) and
//   out/check/contact.jpg                    one chapter (Shorts)
//   out/check/ch01-1.jpg, ch01-2.jpg, ...    long form: per chapter, max 30 tiles each
//   out/check/sync.txt                       tile -> the words spoken over that shot,
//                                            its keyword and how well the clip matched
// LOOK at the sheets (and single frames where something looks off) before delivering.
import fs from "node:fs";
import path from "node:path";
import { PUBLIC, ROOT, ffmpeg, fail, log, readJson, status, timecode } from "./lib.mjs";
const DRAWTEXT_FONT = process.platform === "win32" ? "fontfile='C\\\\:/Windows/Fonts/arial.ttf':" : "";

const t = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!t) fail("No public/timeline.json - build the timeline first.");
const video = ["out/final.mp4", "out/video.mp4"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
if (!video) fail("No render in out/ - render first.");
const sec = (f) => f / t.fps;

// 1. Timeline lint
const warnings = [];
const allShots = t.scenes.flatMap((s) => s.shots.map((sh, k) => ({ ...sh, scene: s.id, n: k + 1, chapter: s.chapter, at: s.startFrame + sh.from })));
for (const sh of allShots) {
  const where = `${sh.scene} @ ${timecode(sec(sh.at))}`;
  if (sh.durationInFrames < t.fps * 0.6) warnings.push(`${where}: shot only ${sh.durationInFrames} frames`);
  const steps = [0, ...(sh.graphic?.at ?? []), sh.durationInFrames];
  const still = Math.max(...steps.slice(1).map((a, k) => a - steps[k]));
  if (still > t.fps * 8) warnings.push(`${where}: shot holds ${sec(sh.durationInFrames).toFixed(1)}s - add B-roll keywords`);
}
for (let i = 1; i < allShots.length; i++) {
  if (allShots[i].src && allShots[i].src === allShots[i - 1].src) warnings.push(`${allShots[i].scene}: same clip twice in a row (${allShots[i].src})`);
}
for (const sh of allShots) {
  if (sh.crossesCut) warnings.push(`${sh.scene} @ ${timecode(sec(sh.at))}: the stock clip's own cut shows inside this shot - pick a longer clip`);
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

// 1b. Retention report: how often the picture changes and how often something
// bigger than a cut happens. Thresholds are practitioner defaults, not laws.
const shorts = t.height > t.width;
const visual = new Set([0]), interrupts = [0];
t.scenes.forEach((s, i) => {
  visual.add(s.startFrame);
  s.shots.forEach((sh) => {
    visual.add(s.startFrame + sh.from);
    (sh.graphic?.at ?? []).forEach((a) => visual.add(s.startFrame + sh.from + a)); // each explainer item landing
  });
  (s.punches ?? []).forEach((f) => visual.add(s.startFrame + f));
  const prevLook = t.scenes[i - 1]?.look ?? "normal";
  if (s.emphasis || s.badge || s.lowerThird || (s.chapterStart && t.showChapterCards) || s.fx?.length || s.layout === "split" ||
    (s.transition && s.transition !== "cut") || (i > 0 && (s.look ?? "normal") !== prevLook)) interrupts.push(s.startFrame);
  s.shots.forEach((sh) => sh.type === "graphic" && interrupts.push(s.startFrame + sh.from)); // a chart or map is an interrupt
});
const maxGap = (frames) => {
  const f = [...frames, t.durationInFrames].sort((a, b) => a - b);
  let best = [0, 0];
  for (let i = 1; i < f.length; i++) if (f[i] - f[i - 1] > best[1] - best[0]) best = [f[i - 1], f[i]];
  return best;
};
const [va, vb] = maxGap([...visual]);
const [ia, ib] = maxGap(interrupts);
const visTarget = shorts ? 3.5 : 8, intTarget = shorts ? 12 : 90;
const spoken = t.words.length / ((t.words[t.words.length - 1].endMs - t.words[0].startMs) / 60000);
let pauses = 0;
for (let i = 1; i < t.words.length; i++) if (t.words[i].scene === t.words[i - 1].scene && t.words[i].startMs - t.words[i - 1].endMs > 700) pauses++;
const report = [
  `first word at ${(t.words[0].startMs / 1000).toFixed(2)}s${t.words[0].startMs > 500 ? " (!) - start talking within 0.5s" : ""}`,
  `hook text on frame 0: ${t.scenes[0].emphasis ? "yes" : "no" + (shorts ? " (!)" : "")}`,
  `longest hold without a visual change: ${sec(vb - va).toFixed(1)}s at ${timecode(sec(va))}${sec(vb - va) > visTarget ? ` (!) target <= ${visTarget}s` : ""}`,
  `longest stretch without a pattern interrupt: ${sec(ib - ia).toFixed(0)}s at ${timecode(sec(ia))}${sec(ib - ia) > intTarget ? ` (!) target <= ${intTarget}s` : ""}`,
  `speech rate ${Math.round(spoken)} wpm${spoken < (shorts ? 140 : 120) ? " (!) slow - raise voice.rate or tighten" : spoken > 200 ? " (!) fast - captions will be hard to read" : ""}`,
  `pauses over 0.7s inside scenes: ${pauses}${pauses > (shorts ? 1 : 10) ? " (!) - dead air; tighten (voice.tightenPauses for recordings)" : ""}`,
];
for (const line of report) if (line.includes("(!)")) warnings.push(`retention: ${line.replace(" (!)", "")}`);

// 2. Key frames: hook (0.1s, 0.5s), then the middle of every shot
const dir = path.join(ROOT, "out", "check");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
const samples = [
  { at: 0.1, chapter: 0 },
  { at: 0.5, chapter: 0 },
  ...allShots.map((s) => ({ at: sec(s.at + s.durationInFrames / 2), chapter: s.chapter })),
];
// Tiles carry their number (when this ffmpeg has drawtext) so sync.txt maps back to them.
let labels = true;
samples.forEach((s, i) => {
  s.file = path.join(dir, "frames", `${String(i + 1).padStart(4, "0")}.jpg`);
  const scale = `scale=${t.width > t.height ? 480 : 270}:-2`;
  const grab = (vf) => ffmpeg(["-ss", s.at.toFixed(3), "-i", video, "-frames:v", "1", "-q:v", "4", "-vf", vf, s.file], { capture: true }).status === 0 && fs.existsSync(s.file);
  if (!(labels && grab(`${scale},drawtext=${DRAWTEXT_FONT}text='${i + 1}':x=8:y=8:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6`))) {
    labels = false;
    grab(scale);
  }
});

// Sync report: does each picture show what the voice says over it?
const sync = ["tile  time         shot       says -> shows (keyword)  [match]"];
samples.slice(2).forEach((s, k) => {
  const sh = allShots[k];
  const a = sec(sh.at), b = sec(sh.at + sh.durationInFrames);
  const g = sh.graphic;
  const shows = sh.type === "kinetic" ? "KINETIC FALLBACK (no matching footage)"
    : g ? `GRAPHIC ${g.type}: ${g.title ?? g.label ?? g.text ?? (g.places ?? []).map((p) => p.name).concat(g.countries ?? []).join(", ") ?? ""}`.trim()
    : sh.keyword ?? sh.src;
  const match = sh.type === "kinetic" ? "!" : g ? "data" : sh.picked ? "picked" : sh.rel == null ? "own" : sh.rel < 0.5 ? `${sh.rel} weak?` : String(sh.rel);
  sync.push(`${String(k + 3).padStart(4)}  ${a.toFixed(1).padStart(5)}-${b.toFixed(1).padEnd(5)}  ${sh.scene}-${String(sh.n).padEnd(3)}  "${sh.words ?? ""}" -> ${shows}  [${match}]`);
});
fs.writeFileSync(path.join(dir, "sync.txt"), sync.join("\n") + "\n");
const weak = allShots.filter((sh) => sh.type !== "kinetic" && sh.type !== "graphic" && !sh.picked && sh.rel != null && sh.rel < 0.5).length;

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
log("check", `contact sheets in out/check/: ${sheets.join(", ")}${labels ? " (tiles numbered)" : ""}`);
log("check", `sync report: out/check/sync.txt - tile 1-2 = hook, then one tile per shot with the words spoken over it` +
  `${weak ? `; ${weak} weak match(es) marked "weak?" - look at those tiles first` : ""}`);
log("check", "retention report:");
for (const line of report) console.log(`    ${line.includes("(!)") ? "\x1b[33m" : ""}${line}\x1b[0m`);
for (const w of warnings.slice(0, 40)) console.log(`  \x1b[33m! ${w}\x1b[0m`);
if (warnings.length > 40) console.log(`  \x1b[33m! ...and ${warnings.length - 40} more\x1b[0m`);
if (!warnings.length) log("check", "no lint warnings - now inspect the sheets visually");
{
  const prev = readJson(path.join(ROOT, "build", "status.json"), {});
  status({ issues: warnings.slice(0, 60), stats: { ...(prev.stats ?? {}), "length": timecode(sec(t.durationInFrames)), "loudness": lufs != null ? `${lufs} LUFS` : "?",
    "weak matches": weak } });
}
