// Hard quality gate for the finished video. Nothing is uploaded unless this passes.
//   node scripts/qa.mjs            check out/final.mp4 (else out/video.mp4)
//   node scripts/qa.mjs --file=x   check another file
// Writes out/qa/report.json, out/qa/sheet-*.jpg (one frame per second, numbered)
// and out/qa/hook.jpg (the first 3 seconds at 4 frames per second).
// Exit code 0 = pass, 1 = fail. Every failure says what is wrong and where.
//
// What it checks:
//   format      size, frame rate, audio stream present, Shorts length
//   sync        video and audio lengths match each other and the timeline
//   picture     black frames, frozen picture, no picture change at all
//   sound       loudness (-14 LUFS +-1), true peak (<= -1 dBTP), clipping,
//               dead air in the middle, a hard cut-off at the very end
// The sheets are for the eyes: open them and look at every tile before you pass the video.
import fs from "node:fs";
import path from "node:path";
import { FORMATS, PUBLIC, ROOT, ffmpeg, log, readJson, readProject, timecode } from "./lib.mjs";

const args = process.argv.slice(2);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const video = opt("file") ? path.resolve(opt("file")) : ["out/final.mp4", "out/video.mp4"].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
const OUT = path.join(ROOT, "out", "qa");
fs.mkdirSync(OUT, { recursive: true });

const fails = [], warns = [], info = {};
const bad = (m) => fails.push(m);
const warn = (m) => warns.push(m);
const finish = () => {
  const report = { file: video ? path.relative(ROOT, video) : null, pass: fails.length === 0, fails, warns, info, at: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  for (const f of fails) console.log(`  \x1b[31m✗ ${f}\x1b[0m`);
  for (const w of warns) console.log(`  \x1b[33m! ${w}\x1b[0m`);
  log("qa", report.pass ? `PASS${warns.length ? ` with ${warns.length} warning(s)` : ""} - now look at out/qa/hook.jpg and out/qa/sheet-*.jpg` : `FAIL: ${fails.length} problem(s) - fix them, render again, run qa again`);
  process.exit(report.pass ? 0 : 1);
};
if (!video) { bad("no render found in out/ (final.mp4 or video.mp4)"); finish(); }

const project = (() => { try { return readProject(); } catch { return {}; } })();
const timeline = readJson(path.join(PUBLIC, "timeline.json"), null);
const qa = { maxSeconds: 60, lufs: -14, lufsTolerance: 1, truePeak: -1, ...(project.qa || {}) };
const run = (a) => ffmpeg(a, { capture: true }).stderr || "";
const num = (re, s) => { const m = re.exec(s); return m ? parseFloat(m[1]) : null; };

// ---------- format ----------
const probe = run(["-i", video]);
const vline = /Stream #.*Video: .*/.exec(probe)?.[0] || "";
const aline = /Stream #.*Audio: .*/.exec(probe)?.[0] || "";
const [w, h] = (/, (\d{2,5})x(\d{2,5})[ ,]/.exec(vline) || []).slice(1).map(Number);
const fps = num(/([\d.]+) fps/, vline);
const dm = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe);
const duration = dm ? +dm[1] * 3600 + +dm[2] * 60 + +dm[3] : null;
Object.assign(info, { width: w, height: h, fps, duration });
const want = FORMATS[project.format] || (timeline ? { width: timeline.width, height: timeline.height } : null);
if (!vline) bad("no video stream");
if (!aline) bad("no audio stream");
if (want && (w !== want.width || h !== want.height)) bad(`size ${w}x${h}, expected ${want.width}x${want.height}`);
if (timeline && fps && Math.abs(fps - timeline.fps) > 0.05) bad(`frame rate ${fps}, timeline is ${timeline.fps}`);
if (project.format === "shorts" && duration > qa.maxSeconds + 0.05) bad(`${duration.toFixed(2)}s long, Shorts limit here is ${qa.maxSeconds}s`);
if (timeline && duration && Math.abs(duration - timeline.durationInFrames / timeline.fps) > 0.25) {
  bad(`file is ${duration.toFixed(2)}s but the timeline is ${(timeline.durationInFrames / timeline.fps).toFixed(2)}s`);
}

// ---------- sync: stream lengths ----------
const streamLen = (sel) => {
  const r = ffmpeg(["-i", video, "-map", sel, "-c", "copy", "-f", "null", "-"], { capture: true }).stderr || "";
  const all = [...r.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
  return all ? +all[1] * 3600 + +all[2] * 60 + +all[3] : null;
};
const vLen = streamLen("0:v:0"), aLen = streamLen("0:a:0");
Object.assign(info, { videoSeconds: vLen, audioSeconds: aLen });
// AAC adds a few milliseconds of padding, so allow a little; more means a silent or black tail.
if (vLen && aLen && Math.abs(vLen - aLen) > 0.25) bad(`audio (${aLen.toFixed(2)}s) and picture (${vLen.toFixed(2)}s) lengths differ: a silent or black tail`);
else if (vLen && aLen && Math.abs(vLen - aLen) > 0.08) warn(`audio ${aLen.toFixed(2)}s vs picture ${vLen.toFixed(2)}s: small tail, check the ending`);

// ---------- picture ----------
const pic = run(["-i", video, "-vf", "blackdetect=d=0.12:pic_th=0.94:pix_th=0.10,freezedetect=n=0.0015:d=1.2", "-an", "-f", "null", "-"]);
// A "dip" or "fade" transition goes through black on purpose: allow a short dip at a scene change.
const dips = (timeline?.scenes || []).filter((sc) => ["dip", "fade"].includes(sc.transition)).map((sc) => sc.startFrame / timeline.fps);
const intended = (s, e) => e - s <= 0.45 && dips.some((t) => s >= t - 0.4 && e <= t + 0.4);
for (const m of pic.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)) {
  const [s, e] = [+m[1], +m[2]];
  if (intended(s, e)) continue;
  if (s > 0.05 && e < (duration ?? 1e9) - 0.6) bad(`black picture ${timecode(s)}-${timecode(e)} (${(+m[3]).toFixed(2)}s)`);
  else if (s <= 0.05 && e > 0.25) bad(`video opens on black for ${e.toFixed(2)}s - Shorts must show something from the first frame`);
}
const freezes = [...pic.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
for (const [s, d] of freezes) {
  if (d >= 3) bad(`picture frozen for ${d.toFixed(1)}s from ${timecode(s)} - nothing moves`);
  else warn(`picture still for ${d.toFixed(1)}s from ${timecode(s)} - check it is meant (a held graphic) and not a stuck clip`);
}

// ---------- sound ----------
const loud = run(["-i", video, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
const summary = loud.slice(loud.lastIndexOf("Summary:"));
const lufs = num(/I:\s+(-?[\d.]+) LUFS/, summary);
const tp = num(/Peak:\s+(-?[\d.]+) dBFS/, summary);
Object.assign(info, { lufs, truePeak: tp });
if (lufs == null) bad("could not measure loudness");
else if (Math.abs(lufs - qa.lufs) > qa.lufsTolerance) bad(`loudness ${lufs} LUFS, target ${qa.lufs} +-${qa.lufsTolerance} (run the master step)`);
if (tp != null && tp > qa.truePeak) bad(`true peak ${tp} dBTP, must be <= ${qa.truePeak} (clips on phones)`);

const stats = run(["-i", video, "-vn", "-af", "astats=measure_perchannel=none:measure_overall=Peak_level+Number_of_Infs+Number_of_NaNs", "-f", "null", "-"]);
const peak = num(/Peak level dB:\s+(-?[\d.inf]+)/, stats);
if (peak != null && peak >= -0.05) bad(`sample peak ${peak} dBFS: digital clipping`);
if (/Number of (Infs|NaNs):\s+[1-9]/.test(stats)) bad("broken audio samples (NaN/Inf)");

const sil = run(["-i", video, "-vn", "-af", "silencedetect=noise=-46dB:d=0.9", "-f", "null", "-"]);
for (const m of sil.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)) {
  const [s, e, d] = [+m[1], +m[2], +m[3]];
  if (s > 0.4 && e < (duration ?? 1e9) - 1.2) bad(`dead air ${timecode(s)}-${timecode(e)} (${d.toFixed(1)}s of near silence)`);
}
if (duration) {
  const tail = run(["-ss", String(Math.max(0, duration - 0.25)), "-i", video, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
  const tailDb = num(/max_volume: (-?[\d.]+) dB/, tail);
  info.tailMaxDb = tailDb;
  if (tailDb != null && tailDb > -12) warn(`audio is still loud (${tailDb} dB) in the last 0.25s - it may cut off hard; fade the music out`);
}

// ---------- frames to look at ----------
const font = process.platform === "win32" ? "C\\:/Windows/Fonts/arial.ttf" : null;
const label = (txt) => `drawtext=${font ? `fontfile='${font}':` : ""}text='${txt}':x=12:y=12:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6`;
const portrait = (h || 0) > (w || 0);
const tileW = portrait ? 270 : 384;
for (const f of fs.readdirSync(OUT)) if (/^(sheet-\d+|hook)\.jpg$/.test(f)) fs.rmSync(path.join(OUT, f));
ffmpeg(["-t", "3", "-i", video, "-vf", `fps=4,scale=${tileW}:-2,${label("%{pts\\:hms}")},tile=6x2:padding=4:color=white`, "-frames:v", "1", "-q:v", "3", path.join(OUT, "hook.jpg")]);
const perSheet = portrait ? 18 : 20;
const sheets = Math.ceil((duration || 0) / perSheet);
for (let i = 0; i < sheets; i++) {
  ffmpeg(["-ss", String(i * perSheet), "-t", String(perSheet), "-i", video, "-vf",
    `fps=1,scale=${tileW}:-2,${label("%{pts\\:hms}")},tile=${portrait ? "6x3" : "5x4"}:padding=4:color=white`,
    "-frames:v", "1", "-q:v", "3", path.join(OUT, `sheet-${i + 1}.jpg`)]);
}
info.sheets = sheets;
finish();
