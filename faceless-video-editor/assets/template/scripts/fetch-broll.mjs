// Find and download B-roll for every shot of every scene.
//   Pexels  (PEXELS_API_KEY)  - videos, then photos. Best portrait coverage. 200 searches/hour.
//   Pixabay (PIXABAY_API_KEY) - videos. 100 searches/minute: the workhorse for long form.
//   "file:clip.mp4" / "file:pic.jpg" in scene.broll - your own asset from public/.
// No key and no file -> the shot renders as an animated "kinetic" background.
// Writes build/broll.json and build/credits.txt. Searches are cached in
// build/search-cache/ and downloads in public/broll/, so a re-run only fetches
// what is missing (e.g. shots that fell back after an hourly rate limit).
import fs from "node:fs";
import path from "node:path";
import { BUILD, FORMATS, PUBLIC, ffmpeg, ffmpegRaw, log, probeDuration, readJson, readProject, sceneId, sleep, writeJson } from "./lib.mjs";

const project = readProject();
const fmt = FORMATS[project.format];
const KEYS = { pexels: process.env.PEXELS_API_KEY, pixabay: process.env.PIXABAY_API_KEY };
const sources = (project.brollSources ?? ["pexels", "pixabay"]).filter((s) => KEYS[s]);
const maxWaitMs = (project.brollMaxWaitMinutes ?? 0) * 60_000;
const trim = project.trimBroll !== false;
const exhausted = new Set();
const used = new Set();
const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;
let searches = 0, fellBack = 0;

if (!sources.length) {
  log("broll", "No PEXELS_API_KEY / PIXABAY_API_KEY: only file: assets are used, other shots go kinetic.");
}

class RateLimited extends Error {}

async function getJson(source, url, headers = {}) {
  const cacheFile = path.join(BUILD, "search-cache", Buffer.from(url.replace(/key=[^&]+/, "")).toString("base64url").slice(0, 150) + ".json");
  const cached = readJson(cacheFile, null);
  if (cached) return cached;
  if (exhausted.has(source)) throw new RateLimited(source);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    searches++;
    if (res.status === 429) {
      // Pixabay resets every minute: always worth waiting. Pexels resets hourly:
      // wait only if brollMaxWaitMinutes allows, else fall through to other sources.
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const waitMs = source === "pixabay" ? 61_000 : reset ? reset * 1000 - Date.now() + 2000 : Infinity;
      if (attempt < 3 && waitMs <= Math.max(maxWaitMs, source === "pixabay" ? 61_000 : 0)) {
        log("broll", `${source} rate limit, waiting ${Math.ceil(waitMs / 1000)}s`);
        await sleep(waitMs);
        continue;
      }
      exhausted.add(source);
      log("broll", `${source} rate limit reached, using other sources for the rest of this run`);
      throw new RateLimited(source);
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split("?")[0]}`);
    const data = await res.json();
    writeJson(cacheFile, data);
    return data;
  }
}

// Smallest rendition that fills the frame (objectFit: cover) with at most ~1.35x
// upscaling, else the biggest. A landscape clip in a 9:16 frame is cropped, so it
// needs ~1440p+ to stay sharp; "covers the short side" alone gave blurry Shorts.
function pickRendition(files) {
  const coverScale = (f) => Math.max(fmt.width / f.width, fmt.height / f.height);
  const sorted = files.filter((f) => f.width && f.height).sort((a, b) => a.width * a.height - b.width * b.height);
  return sorted.find((f) => coverScale(f) <= 1.35) || sorted[sorted.length - 1];
}

const orientationOk = (w, h) =>
  fmt.orientation === "portrait" ? h >= w : fmt.orientation === "landscape" ? w >= h : true;

// ---------- choosing the best hit ----------
// Stock search ranks loosely: Pixabay happily returns lipstick for "phone
// settings". Score each hit by how many keyword words its tags (Pixabay) or page
// slug / alt text (Pexels) contain, then orientation, then length, keeping the
// API's own order as the tie-break. Green-screen / mockup / template clips are
// never usable as B-roll.
const STOP = new Set(["the", "and", "with", "for", "from", "into", "over", "close", "shot", "video", "footage", "photo"]);
const BLOCK = /green ?screen|chroma|mock-?up|template|alpha channel|lower third|placeholder/i;
function best(pool, query, textOf, dimsOf, minSec) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
  const scored = pool
    .map((x, i) => {
      const text = textOf(x).toLowerCase();
      if (BLOCK.test(text)) return null;
      const rel = words.length ? words.filter((w) => text.includes(w)).length / words.length : 0;
      const [w, h] = dimsOf(x);
      return { x, score: rel * 3 + (orientationOk(w, h) ? 1 : 0) + ((x.duration ?? minSec) >= minSec ? 0.5 : 0) - i * 0.02 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.x ?? null;
}

const SEARCH = {
  async pexels(query, minSec) {
    const q = new URLSearchParams({ query, per_page: "30", orientation: fmt.orientation, size: "medium" });
    const data = await getJson("pexels", `https://api.pexels.com/videos/search?${q}`, { Authorization: KEYS.pexels });
    const pool = data.videos.filter((v) => !used.has(`pexels-${v.id}`));
    const v = best(pool, query, (x) => `${x.url} ${(x.tags ?? []).join(" ")}`, (x) => [x.width, x.height], minSec);
    if (!v) return null;
    const file = pickRendition(v.video_files.filter((f) => f.file_type === "video/mp4"));
    return file && { id: `pexels-${v.id}`, url: file.link, ext: "mp4", credit: `${v.user?.name ?? "Pexels"} - ${v.url}` };
  },
  async pixabay(query, minSec) {
    const q = new URLSearchParams({ key: KEYS.pixabay, q: query.slice(0, 100), per_page: "50", safesearch: "true" });
    const data = await getJson("pixabay", `https://pixabay.com/api/videos/?${q}`);
    const pool = data.hits.filter((h) => !used.has(`pixabay-${h.id}`));
    const dims = (h) => { const v = h.videos.large?.width ? h.videos.large : h.videos.medium; return [v.width, v.height]; };
    const h = best(pool, query, (x) => x.tags ?? "", dims, minSec);
    if (!h) return null;
    const file = pickRendition(Object.values(h.videos).filter((f) => f.url));
    return file && { id: `pixabay-${h.id}`, url: file.url, ext: "mp4", credit: `${h.user} - ${h.pageURL}` };
  },
  async pixabayPhoto(query) {
    const orientation = fmt.orientation === "portrait" ? "vertical" : fmt.orientation === "landscape" ? "horizontal" : "all";
    const q = new URLSearchParams({ key: KEYS.pixabay, q: query.slice(0, 100), image_type: "photo", orientation, per_page: "30", safesearch: "true" });
    const data = await getJson("pixabay", `https://pixabay.com/api/?${q}`);
    const p = best(data.hits.filter((x) => !used.has(`pixabay-photo-${x.id}`)), query, (x) => x.tags ?? "", (x) => [x.imageWidth, x.imageHeight], 0);
    // fullHDURL needs Pixabay "full API access"; largeImageURL (1280px) works for every key.
    return p && { id: `pixabay-photo-${p.id}`, url: p.fullHDURL || p.largeImageURL, ext: "jpg", credit: `${p.user} - ${p.pageURL}` };
  },
  async photo(query) {
    const q = new URLSearchParams({ query, per_page: "30", orientation: fmt.orientation });
    const data = await getJson("pexels", `https://api.pexels.com/v1/search?${q}`, { Authorization: KEYS.pexels });
    const p = best(data.photos.filter((x) => !used.has(`pexels-photo-${x.id}`)), query, (x) => `${x.url} ${x.alt ?? ""}`, (x) => [x.width, x.height], 0);
    return p && { id: `pexels-photo-${p.id}`, url: p.src.large2x, ext: "jpg", credit: `${p.photographer} - ${p.url}` };
  },
};

async function findShot(keyword, minSec) {
  const photoOnly = keyword.startsWith("photo:");
  const query = keyword.replace(/^photo:/, "").trim();
  const tries = photoOnly ? [] : sources.map((s) => () => SEARCH[s](query, minSec));
  if (KEYS.pexels) tries.push(() => SEARCH.photo(query));
  if (KEYS.pixabay) tries.push(() => SEARCH.pixabayPhoto(query));
  for (const t of tries) {
    try {
      const hit = await t();
      if (hit) return hit;
    } catch (e) {
      if (!(e instanceof RateLimited)) log("broll", `search failed (${e.message}), trying next source`);
    }
  }
  return null;
}

// ---------- 1. plan: one search per shot (cached), no downloads yet ----------
// A shot keeps the clip it got last run (same keyword, file still on disk), so
// re-running after a rate limit only fills the gaps instead of reshuffling clips.
const previous = readJson(path.join(BUILD, "broll.json"), {});
const keepPrev = (id, k, kw) => {
  const p = previous[id]?.[k];
  return p?.assetId && p.src && p.keyword === kw && fs.existsSync(path.join(PUBLIC, p.src)) ? p : null;
};
for (const p of Object.values(previous).flat()) if (p.assetId) used.add(p.assetId);
const plan = {};
const jobs = [];
for (const [i, scene] of project.scenes.entries()) {
  const id = sceneId(i);
  const vo = readJson(path.join(BUILD, "vo", `${id}.json`), null);
  if (!vo) throw new Error(`Missing build/vo/${id}.json - run the voiceover step first.`);
  const sec = vo.durationMs / 1000;
  const keywords = scene.broll?.length ? scene.broll : [];
  // Split layout shows two clips side by side for the whole scene.
  const split = scene.layout === "split";
  const nShots = split ? 2 : Math.max(1, Math.ceil(sec / project.maxShotSeconds));
  const shotSec = split ? sec : sec / nShots;
  plan[id] = [];
  for (let k = 0; k < nShots; k++) {
    const kw = keywords.length ? keywords[k % keywords.length] : null;
    if (scene.visual === "kinetic" || !kw) {
      plan[id].push({ type: "kinetic" });
      continue;
    }
    if (kw.startsWith("file:")) {
      const src = kw.slice(5).trim();
      const abs = path.join(PUBLIC, src);
      if (!fs.existsSync(abs)) throw new Error(`${id}: ${src} not found in public/`);
      const isVideo = VIDEO_EXT.test(src);
      plan[id].push({ type: isVideo ? "video" : "image", src, duration: isVideo ? probeDuration(abs) : null });
      continue;
    }
    const prev = keepPrev(id, k, kw);
    if (prev) {
      plan[id].push(prev);
      continue;
    }
    const hit = sources.length || KEYS.pexels || KEYS.pixabay ? await findShot(kw, shotSec) : null;
    if (!hit) {
      if (sources.length) log("broll", `${id} shot ${k + 1}: nothing for "${kw}" -> kinetic`);
      fellBack++;
      plan[id].push({ type: "kinetic" });
      continue;
    }
    used.add(hit.id);
    const shot = { type: hit.ext === "mp4" ? "video" : "image", src: `broll/${hit.id}.${hit.ext}`, duration: null, assetId: hit.id, keyword: kw, credit: hit.credit };
    plan[id].push(shot);
    jobs.push({ shot, hit, kw, shotSec, label: `${id} shot ${k + 1} "${kw}"` });
  }
}

// ---------- 2. download (4 at a time), trim long clips to what the shot needs ----------
async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + ".part", Buffer.from(await res.arrayBuffer()));
  fs.renameSync(dest + ".part", dest);
}

async function fetchOnce({ shot, hit, shotSec }) {
  const abs = path.join(PUBLIC, shot.src);
  // A trimmed copy is named by the length it keeps; reuse it if it is long enough.
  const keep = Math.ceil(shotSec + 2);
  const trimmed = abs.replace(/\.mp4$/, `.t${keep}.mp4`);
  if (shot.type === "video" && fs.existsSync(trimmed)) {
    shot.src = path.relative(PUBLIC, trimmed);
    shot.duration = probeDuration(trimmed);
    return;
  }
  if (!fs.existsSync(abs)) await download(hit.url, abs);
  if (shot.type !== "video") return;
  shot.duration = probeDuration(abs);
  // Stock clips are often 10-60s; a 40 minute video would keep gigabytes it never shows.
  if (trim && shot.duration && shot.duration > keep + 3) {
    const offset = Math.min((shot.duration - keep) * 0.35, 4);
    const r = ffmpeg(["-ss", offset.toFixed(2), "-i", abs, "-t", String(keep), "-an", "-c:v", "copy", "-movflags", "+faststart", trimmed]);
    if (r.status === 0 && fs.existsSync(trimmed)) {
      fs.rmSync(abs);
      shot.src = path.relative(PUBLIC, trimmed);
      shot.duration = probeDuration(trimmed);
    }
  }
}

// Look at the clip before trusting it: nearly black footage and green-screen
// mockups are common stock results that search scores can't see.
function frameProblem(file, duration) {
  const times = duration ? [0.2, 0.5, 0.8].map((f) => duration * f) : [0];
  let luma = 0, green = 0, n = 0;
  for (const t of times) {
    const buf = ffmpegRaw([...(duration ? ["-ss", t.toFixed(2)] : []), "-i", file, "-frames:v", "1", "-vf", "scale=48:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    if (!buf?.length) continue;
    let l = 0, g = 0;
    for (let i = 0; i < buf.length; i += 3) {
      const [r, gg, b] = [buf[i], buf[i + 1], buf[i + 2]];
      l += 0.299 * r + 0.587 * gg + 0.114 * b;
      if (gg > 120 && gg > r * 1.6 && gg > b * 1.6) g++;
    }
    luma += l / (buf.length / 3);
    green = Math.max(green, g / (buf.length / 3));
    n++;
  }
  if (!n) return "unreadable";
  if (luma / n < 20) return "nearly black";
  if (green > 0.12) return "green screen";
  return null;
}

async function fetchJob(job) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await fetchOnce(job);
    const file = path.join(PUBLIC, job.shot.src);
    const problem = frameProblem(file, job.shot.type === "video" ? job.shot.duration : null);
    if (!problem) {
      log("broll", `${job.label} -> ${job.shot.src}`);
      return;
    }
    fs.rmSync(file, { force: true });
    const next = await findShot(job.kw, job.shotSec);
    log("broll", `${job.label}: ${path.basename(job.shot.src)} is ${problem}, ${next ? "trying the next result" : "no more results"}`);
    if (!next) break;
    used.add(next.id);
    job.hit = next;
    Object.assign(job.shot, { type: next.ext === "mp4" ? "video" : "image", src: `broll/${next.id}.${next.ext}`, duration: null, assetId: next.id, credit: next.credit });
  }
  throw new Error("no usable clip");
}

const queue = [...jobs];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let job; (job = queue.shift()); ) {
      try {
        await fetchJob(job);
      } catch (e) {
        log("broll", `${job.label}: ${e.message} -> kinetic`);
        Object.assign(job.shot, { type: "kinetic", src: undefined, duration: undefined, assetId: undefined, credit: undefined });
        fellBack++;
      }
    }
  }),
);

writeJson(path.join(BUILD, "broll.json"), plan);
const credits = Object.values(plan).flat().map((s) => s.credit).filter(Boolean);
// Delete downloads no shot uses any more (changed keywords, earlier picks).
const keep = new Set(Object.values(plan).flat().map((s) => s.src).filter(Boolean).map((s) => path.basename(s)));
const brollDir = path.join(PUBLIC, "broll");
if (fs.existsSync(brollDir)) {
  for (const f of fs.readdirSync(brollDir)) {
    if (/^(pexels|pixabay)-/.test(f) && !keep.has(f) && !f.endsWith(".part")) fs.rmSync(path.join(brollDir, f));
  }
}
fs.writeFileSync(path.join(BUILD, "credits.txt"), [...new Set(credits)].join("\n") + "\n");
const total = Object.values(plan).flat().length;
log("broll", `done: ${total - Object.values(plan).flat().filter((s) => s.type === "kinetic").length}/${total} shots have footage, ${searches} new searches`);
if (exhausted.size && fellBack) {
  log("broll", `${fellBack} shots fell back because ${[...exhausted].join(", ")} hit a rate limit. ` +
    "Re-run `node scripts/auto.mjs --from=broll` later: finished searches and downloads are cached.");
}
