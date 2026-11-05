// Footage bank: real video for long-form edits, chosen shot by shot.
//
// Free libraries rarely have one clean clip per spoken line, but a single DVIDS
// b-roll package holds dozens of real shots. This downloads packages by theme
// (build/bank-themes.json) into a folder OUTSIDE public/ (the render copies public/),
// splits each at its internal cuts and writes one numbered contact sheet per theme,
// so an editor can pick an exact shot for each line. Only small preview renditions
// are downloaded for that; a picked shot is cut straight from the 1080p file over
// HTTP, so a few seconds of footage never costs a 200 MB download.
//
//   node scripts/footage-bank.mjs                 download + index + sheets (resumes)
//   node scripts/footage-bank.mjs --no-sheets     download + index only
//   node scripts/footage-bank.mjs --sheets[=a,b]  rebuild the sheets (of these themes); safe while a download runs
//   node scripts/footage-bank.mjs --cut=build/bank-picks.json
//        cut picked shots into public/broll/bank-*.mp4 and write them into project.json
//
// bank-themes.json: { "dir": "../bank", "themes": { "raid": { "q": ["fast rope", ...], "max": 8 } } }
// bank-picks.json:  { "s001-2": "raid:14" } or { "s001-2": { "id": "raid:14", "in": 1.0, "len": 3.5 } }
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { BUILD, PUBLIC, ROOT, ffmpeg, ffmpegRaw, fail, log, probeDuration, readJson, sleep, writeJson } from "./lib.mjs";

const args = process.argv.slice(2);
const cfg = readJson(path.join(BUILD, "bank-themes.json"), null);
if (!cfg) fail("build/bank-themes.json is missing");
const DIR = path.resolve(ROOT, cfg.dir ?? "../bank");
const INDEX = path.join(DIR, "index.json");
const SHEETS = path.join(DIR, "sheets");
const KEY = process.env.DVIDS_API_KEY;
// drawtext font: Arial Bold on Windows; elsewhere fontconfig's default (no fontfile).
const FONT_ARG = process.platform === "win32" ? "fontfile='C\\:/Windows/Fonts/arialbd.ttf':" : "";
const MAX_BYTES = (cfg.maxMB ?? 700) * 1024 * 1024;
const MIN_SEG = cfg.minSegSeconds ?? 2.5;
fs.mkdirSync(SHEETS, { recursive: true });
const index = readJson(INDEX, { clips: {} });
// Tiles live in their own file, so a sheet run can't be overwritten by a running download.
const TILES = path.join(DIR, "tiles.json");
const tiles = readJson(TILES, {});
const save = () => { const now = readJson(INDEX, { clips: {} }); writeJson(INDEX, { clips: { ...now.clips, ...index.clips } }); };

async function api(p, params) {
  const url = `https://api.dvidshub.net/${p}?${new URLSearchParams({ api_key: KEY, ...params })}`;
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if (r.status === 429 && i < 4) { await sleep(30000); continue; }
    if (!r.ok) throw new Error(`DVIDS ${p} ${r.status}`);
    return r.json();
  }
}

// A b-roll package has many real shots; a news story has an anchor and a slate.
const isPackage = (r) => /b-?\s?roll|\bbroll\b/i.test(`${r.title} ${r.short_description ?? ""}`);
const NOT_FOOTAGE = /\b(interview|ceremony|podcast|minute|newscast|news|update|pac|graduation|change of command|speaks|remarks|briefing|retirement|memorial|concert|band|football|basketball|recruit(ing)? commercial|psa|audio)\b/i;

async function candidates(theme, spec) {
  const seen = new Map();
  for (const q of spec.q) {
    const data = await api("search", { q, type: "video", hd: "1", max_results: "50", aspect_ratio: "16:9", short_description_length: "200" });
    for (const r of data.results ?? []) {
      const d = Number(r.duration) || 0;
      if (r.type !== "video" || d < 20 || d > (cfg.maxSeconds ?? 500)) continue;
      if (NOT_FOOTAGE.test(r.title ?? "") && !isPackage(r)) continue;
      if (!seen.has(r.id)) seen.set(r.id, { ...r, q, score: (isPackage(r) ? 2 : 0) + Math.min(1, d / 120) });
    }
    await sleep(150);
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, spec.max ?? 8);
}

async function fetchClip(theme, r) {
  const id = `dvids-${String(r.id).replace(/^video:/, "")}`;
  const file = path.join(DIR, `${id}.mp4`);
  if (index.clips[id]?.segments) { if (!index.clips[id].themes.includes(theme)) { index.clips[id].themes.push(theme); save(); } return; }
  if (!fs.existsSync(file)) {
    const asset = await api("asset", { id: r.id });
    const files = (asset.results?.files ?? []).filter((f) => f.type === "video/mp4" && f.src);
    if (!files.some((f) => f.width >= 1280)) return log("bank", `${id}: no HD file`);
    // The preview: the smallest rendition that still reads on a contact sheet.
    const preview = files.filter((f) => f.width >= 480).sort((a, b) => a.width - b.width)[0] ?? files[0];
    const res = await fetch(preview.src);
    if (!res.ok) return log("bank", `${id}: download ${res.status}`);
    if (Number(res.headers.get("content-length")) > MAX_BYTES) { res.body?.cancel(); return log("bank", `${id}: over the size limit, skipped`); }
    fs.writeFileSync(file + ".part", Buffer.from(await res.arrayBuffer()));
    fs.renameSync(file + ".part", file);
  }
  const duration = probeDuration(file);
  // Internal cuts, on a small copy of the picture: fast and good enough.
  const out = ffmpegRaw(["-i", file, "-vf", "scale=320:-2,select='gt(scene,0.3)',metadata=print:file=-", "-an", "-f", "null", "-"]);
  const text = out?.toString() ?? "";
  const cuts = [...text.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const bounds = [0, ...cuts, duration];
  const segments = [];
  for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] - bounds[i] >= MIN_SEG) segments.push([+bounds[i].toFixed(2), +bounds[i + 1].toFixed(2)]);
  index.clips[id] = { file: path.basename(file), dvidsId: r.id, title: r.title, duration, themes: [theme], segments,
    credit: `DVIDS - "${r.title}" - ${[r.credit, r.unit_name, r.branch].filter(Boolean).join(", ")} - ${r.url} (U.S. government work; no endorsement implied)` };
  save();
  log("bank", `${theme}: ${id} ${Math.round(duration)}s, ${segments.length} shots - ${String(r.title).slice(0, 60)}`);
}

// Mean brightness of a frame, to drop black tiles and slates before anyone looks at them.
function frameStats(file, t) {
  const buf = ffmpegRaw(["-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=64:36", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  if (!buf?.length) return null;
  let s = 0, s2 = 0;
  for (const v of buf) { s += v; s2 += v * v; }
  const mean = s / buf.length;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / buf.length - mean * mean)) };
}

function buildSheets(only) {
  for (const theme of Object.keys(cfg.themes)) {
    if (only && !only.includes(theme)) continue;
    for (const k of Object.keys(tiles)) if (k.startsWith(`${theme}:`)) delete tiles[k];
    const dir = path.join(SHEETS, `_${theme}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const [id, clip] of Object.entries(index.clips)) {
      if (!clip.themes.includes(theme)) continue;
      const file = path.join(DIR, clip.file);
      // At most a dozen shots a clip so one package can't fill a theme.
      const step = Math.max(1, Math.ceil(clip.segments.length / (cfg.perClip ?? 12)));
      for (const [i, [a, b]] of clip.segments.entries()) {
        if (i % step) continue;
        const mid = a + (b - a) * 0.5;
        const st = frameStats(file, mid);
        if (!st || st.mean < 18 || st.sd < 12) continue; // black, flat or a slate
        n++;
        const label = `${n}  ${Math.round(b - a)}s`;
        const tile = path.join(dir, `${String(n).padStart(4, "0")}.jpg`);
        const r = ffmpeg(["-ss", mid.toFixed(2), "-i", file, "-frames:v", "1", "-vf",
          `scale=320:180:force_original_aspect_ratio=increase,crop=320:180,drawbox=x=0:y=0:w=92:h=26:color=black@0.8:t=fill,drawtext=${FONT_ARG}text='${label}':x=5:y=5:fontsize=17:fontcolor=white,format=yuvj420p`, "-q:v", "4", tile]);
        if (r.status !== 0 || !fs.existsSync(tile)) { n--; continue; }
        tiles[`${theme}:${n}`] = { clip: id, in: a, out: b };
      }
    }
    // 6 x 6 pages.
    const pages = Math.ceil(n / 36);
    for (let p = 0; p < pages; p++) {
      const out = path.join(SHEETS, `${theme}-${p + 1}.jpg`);
      ffmpeg(["-framerate", "1", "-start_number", String(p * 36 + 1), "-i", path.join(dir, "%04d.jpg"), "-frames:v", "1", "-vf", "tile=6x6:padding=4:color=white", "-q:v", "5", out]);
    }
    log("bank", `${theme}: ${n} shots on ${pages} sheet(s)`);
    fs.rmSync(dir, { recursive: true, force: true });
    writeJson(TILES, tiles);
  }
}

// Cut the picks into public/broll/ and point the shots at them.
// The sharpest 1080p rendition with a sane bitrate (DVIDS lists several).
async function hdUrl(clip) {
  const asset = await api("asset", { id: clip.dvidsId ?? `video:${clip.file.replace(/^dvids-|.mp4$/g, "")}` });
  const files = (asset.results?.files ?? []).filter((f) => f.type === "video/mp4" && f.src && f.width >= 1280).sort((a, b) => b.width - a.width || (b.size ?? 0) - (a.size ?? 0));
  if (!files.length) throw new Error("no HD file");
  return files[0].src;
}

async function cutPicks(file) {
  const picks = readJson(path.resolve(ROOT, file), null);
  if (!picks) fail(`${file} not found`);
  const projectFile = path.join(ROOT, "project.json");
  const project = readJson(projectFile);
  const scenes = project.chapters.flatMap((c) => c.scenes);
  const voFor = (i) => readJson(path.join(BUILD, "vo", `s${String(i + 1).padStart(3, "0")}.json`), null);
  let done = 0;
  // One shot, one use: refuse a segment picked for two beats, before any cutting. Keyed on the
  // segment and not the pick id, because one segment can have a number in several themes.
  if (project.allowRepeats !== true) {
    const claimed = new Map();
    const clashes = [];
    for (const [key, pick] of Object.entries(picks)) for (const x of [].concat(pick)) {
      const id = typeof x === "string" ? x : x.id;
      const tile = tiles[id];
      if (!tile) fail(`${key}: no tile ${id}`);
      const segment = `${tile.clip}@${tile.in}`;
      if (claimed.has(segment)) clashes.push(`${key} (${id}) repeats ${claimed.get(segment)}`);
      else claimed.set(segment, `${key} (${id})`);
    }
    if (clashes.length) fail(`the same shot is picked more than once. Choose another shot for:\n  ${clashes.join("\n  ")}`);
  }
  // Cut everything first, four at a time; the loop below then finds the files in place.
  const nameOf = (tile, len) => `broll/bank-${tile.clip.slice(6)}-${Math.round(tile.in * 10)}-${Math.round(len * 10)}.mp4`;
  const jobs = new Map();
  for (const [key, pick] of Object.entries(picks)) for (const x of [].concat(pick)) {
    const p = typeof x === "string" ? { id: x } : x;
    const tile = tiles[p.id];
    if (!tile) fail(`${key}: no tile ${p.id}`);
    const start = tile.in + (p.in ?? 0.15), len = Math.min(p.len ?? 14, tile.out - start - 0.1);
    const name = nameOf(tile, len);
    if (!fs.existsSync(path.join(PUBLIC, name))) jobs.set(name, { clip: index.clips[tile.clip], start, len, dest: path.join(PUBLIC, name), id: p.id });
  }
  const queue = [...jobs.values()];
  log("bank", `${queue.length} shots to cut`);
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let j; (j = queue.shift()); ) {
      for (let attempt = 0; attempt < 4; attempt++) {
        // DVIDS sometimes refuses a burst of asset calls: wait and ask again, never lose the run.
        let url;
        try { url = await hdUrl(j.clip); } catch (e) { log("bank", `${j.id}: ${e.message}, retrying`); await sleep(8000 * (attempt + 1)); continue; }
        // Async, so four really run at once. Most of the wait is the network.
        const status = await new Promise((res) => spawn("ffmpeg", ["-y", "-v", "error", "-ss", j.start.toFixed(2), "-i", url, "-t", j.len.toFixed(2), "-an", "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30",
          "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", j.dest + ".tmp.mp4"], { stdio: "ignore" }).on("close", res));
        if (status === 0 && fs.existsSync(j.dest + ".tmp.mp4")) { fs.renameSync(j.dest + ".tmp.mp4", j.dest); log("bank", `cut ${j.id}, ${queue.length} left`); break; }
        await sleep(4000);
      }
      if (!fs.existsSync(j.dest)) log("bank", `could not cut ${j.id}`);
    }
  }));
  for (const [key, pick] of Object.entries(picks)) {
    const m = key.match(/^s(\d+)-(\d+)$/);
    if (!m) fail(`bad key ${key}`);
    const scene = scenes[Number(m[1]) - 1];
    const beat = scene?.broll?.[Number(m[2]) - 1];
    if (!beat) fail(`${key}: no such beat`);
    // One id, or several for a long beat: more angles, cut on the words.
    const list = (Array.isArray(pick) ? pick : [pick]).map((x) => (typeof x === "string" ? { id: x } : x));
    const names = [], credits = [];
    for (const p of list) {
      const tile = tiles[p.id];
      if (!tile) fail(`${key}: no tile ${p.id}`);
      const clip = index.clips[tile.clip];
      const start = tile.in + (p.in ?? 0.15);
      const len = Math.min(p.len ?? 14, tile.out - start - 0.1);
      const name = `broll/bank-${tile.clip.slice(6)}-${Math.round(tile.in * 10)}-${Math.round(len * 10)}.mp4`;
      const dest = path.join(PUBLIC, name);
      if (!fs.existsSync(dest)) {
        const url = await hdUrl(clip);
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          const r = ffmpeg(["-ss", start.toFixed(2), "-i", url, "-t", len.toFixed(2), "-an", "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30",
            "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest + ".tmp.mp4"]);
          ok = r.status === 0 && fs.existsSync(dest + ".tmp.mp4");
          if (!ok) await sleep(4000);
        }
        if (!ok) fail(`${key}: could not cut ${p.id}`);
        fs.renameSync(dest + ".tmp.mp4", dest);
      }
      names.push(`file:${name}`);
      if (!credits.includes(clip.credit)) credits.push(clip.credit);
      log("bank", `${key}: ${p.id} -> ${name} (${len.toFixed(1)}s)`);
    }
    delete beat.graphic;
    beat.kw = names;
    beat.credit = credits.join(" | ");
    delete beat.move; delete beat.focus;
    done++;
  }
  writeJson(projectFile, project);
  log("bank", `${done} shots cut and written to project.json`);
}

// The Studio's "replace this shot": cut one shot and put it in place of one keyword,
// leaving the rest of that beat alone. { "scene": 12, "old": "file:broll/x.mp4", "tile": "smg:5" }
async function swapShot(file) {
  const job = readJson(path.resolve(ROOT, file), null);
  if (!job) fail(`${file} not found`);
  const tile = tiles[job.tile];
  if (!tile) fail(`no shot ${job.tile} in the bank`);
  const clip = index.clips[tile.clip];
  const projectFile = path.join(ROOT, "project.json");
  const project = readJson(projectFile);
  const scene = (project.chapters ? project.chapters.flatMap((c) => c.scenes) : project.scenes)[job.scene - 1];
  const beat = scene?.broll?.find((e) => [].concat(e?.kw ?? []).includes(job.old));
  if (!beat) fail(`scene ${job.scene} has no shot ${job.old}`);
  const start = tile.in + 0.15, len = Math.min(14, tile.out - start - 0.1);
  const name = `broll/bank-${tile.clip.slice(6)}-${Math.round(tile.in * 10)}-${Math.round(len * 10)}.mp4`;
  const dest = path.join(PUBLIC, name);
  if (!fs.existsSync(dest)) {
    if (!KEY) fail("DVIDS_API_KEY is not set, so the full-size shot can't be downloaded");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const url = await hdUrl(clip);
    const r = ffmpeg(["-ss", start.toFixed(2), "-i", url, "-t", len.toFixed(2), "-an", "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30",
      "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest + ".tmp.mp4"]);
    if (r.status !== 0 || !fs.existsSync(dest + ".tmp.mp4")) fail(`could not cut ${job.tile}`);
    fs.renameSync(dest + ".tmp.mp4", dest);
  }
  const kw = [].concat(beat.kw);
  kw[kw.indexOf(job.old)] = `file:${name}`;
  beat.credit = kw.length === 1 ? clip.credit : [...new Set([...String(beat.credit ?? "").split(" | ").filter(Boolean), clip.credit])].join(" | ");
  beat.kw = kw;
  delete beat.move; delete beat.focus; delete beat.graphic;
  writeJson(projectFile, project);
  log("bank", `scene ${job.scene}: ${job.old} -> ${name}`);
}

const swapArg = args.find((a) => a.startsWith("--swap="));
if (swapArg) { await swapShot(swapArg.slice(7)); process.exit(0); }
const cutArg = args.find((a) => a.startsWith("--cut="));
if (cutArg) { await cutPicks(cutArg.slice(6)); process.exit(0); }
const sheetsArg = args.find((a) => a.startsWith("--sheets"));
if (!sheetsArg) {
  if (!KEY) fail("DVIDS_API_KEY is not set");
  for (const [theme, spec] of Object.entries(cfg.themes)) {
    const list = await candidates(theme, spec);
    log("bank", `${theme}: ${list.length} packages`);
    const queue = [...list];
    await Promise.all(Array.from({ length: cfg.parallel ?? 8 }, async () => {
      for (let r; (r = queue.shift()); ) {
        try { await fetchClip(theme, r); } catch (e) { log("bank", `${r.id}: ${e.message}`); }
      }
    }));
  }
}
if (!args.includes("--no-sheets")) buildSheets(sheetsArg?.includes("=") ? sheetsArg.split("=")[1].split(",") : null);
log("bank", `done: ${Object.keys(index.clips).length} clips, ${Object.keys(tiles).length} shots on sheets. Sheets in ${SHEETS}`);
