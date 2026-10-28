// Find, check and download the picture for every shot of every scene.
//
// Sources (all optional; whatever has a key / is reachable is used):
//   Pexels   (PEXELS_API_KEY)  stock video + photos, best portrait library, 200 searches/hour
//   Pixabay  (PIXABAY_API_KEY) stock video + photos, 100 searches/minute
//   Wikimedia Commons (no key) real people, places, events, documents; CC/PD licences only
//   NASA Image Library (no key) space, science, aviation; public domain
//   OpenAI images (OPENAI_API_KEY) generated stills for "ai:" keywords
// Keyword prefixes in scene.broll:
//   "city traffic night"   stock video first, photos as fallback; archive photos join in
//                          automatically when the keyword names something real (a year,
//                          a proper noun) or stock has nothing relevant
//   "photo:old map"        photos only (stock + archive)
//   "archive:Apollo 11"    Wikimedia + NASA only: accurate, real imagery
//   "ai:prompt"            generate an image (needs OPENAI_API_KEY)
//   "file:clip.mp4"        your own asset in public/
//
// Review (accuracy): `node scripts/fetch-broll.mjs --review` downloads only small
// thumbnails and writes build/review/<scene>-<shot>.jpg (candidates numbered 1-6,
// left to right, top to bottom) + build/review.json. Look at them, then write the
// winners to build/picks.json, e.g. {"s001-1": 3, "s004-2": 1}. The normal run uses
// the picks. `--review=all` reviews every shot; by default only shots that matter
// most or that search is unsure about (hook, emphasis/reveal/split scenes, weak matches).
//
// Every downloaded clip is frame-checked (nearly black or green-screen -> next
// result), long clips are trimmed to what the shot needs, picks stay stable across
// runs. Writes build/broll.json and build/credits.txt (attribution for CC images).
import fs from "node:fs";
import path from "node:path";
import { BUILD, FORMATS, PUBLIC, ffmpeg, ffmpegRaw, log, probeDuration, readJson, readProject, sceneId, sleep, writeJson } from "./lib.mjs";

const args = process.argv.slice(2);
const reviewArg = args.find((a) => a.startsWith("--review"));
const reviewAll = reviewArg === "--review=all";
const project = readProject();
const fmt = FORMATS[project.format];
const KEYS = { pexels: process.env.PEXELS_API_KEY, pixabay: process.env.PIXABAY_API_KEY, openai: process.env.OPENAI_API_KEY };
const stockSources = (project.brollSources ?? ["pexels", "pixabay"]).filter((s) => KEYS[s]);
const archiveOn = project.archive !== false; // Wikimedia + NASA need no key
const maxWaitMs = (project.brollMaxWaitMinutes ?? 0) * 60_000;
const trim = project.trimBroll !== false;
const UA = { "User-Agent": "faceless-video-editor/1.0 (https://github.com/9amx/claude-remotion-skill)" };
const exhausted = new Set();
const used = new Set();
const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;
let searches = 0, fellBack = 0;

if (!stockSources.length) log("broll", "No PEXELS_API_KEY / PIXABAY_API_KEY: stock video off; archive photos and file: assets still work.");

class RateLimited extends Error {}

async function getJson(source, url, headers = {}) {
  const cacheFile = path.join(BUILD, "search-cache", Buffer.from(url.replace(/key=[^&]+/, "")).toString("base64url").slice(0, 150) + ".json");
  const cached = readJson(cacheFile, null);
  if (cached) return cached;
  if (exhausted.has(source)) throw new RateLimited(source);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { ...UA, ...headers } });
    searches++;
    if (res.status === 429) {
      // Pixabay, Wikimedia and NASA reset within a minute: worth waiting. Pexels
      // resets hourly: wait only if brollMaxWaitMinutes allows, else use other sources.
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const retryAfter = Number(res.headers.get("retry-after"));
      const short = source === "pixabay" || source === "wikimedia" || source === "nasa";
      const waitMs = short ? (retryAfter ? retryAfter * 1000 : 61_000) : reset ? reset * 1000 - Date.now() + 2000 : Infinity;
      if (attempt < 3 && waitMs <= Math.max(maxWaitMs, short ? 65_000 : 0)) {
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

// Smallest rendition that FILLS the frame (objectFit: cover) with at most ~1.35x
// upscaling, else the biggest. A landscape clip in a 9:16 frame is cropped, so it
// needs ~1440p+ to stay sharp.
function pickRendition(files) {
  const coverScale = (f) => Math.max(fmt.width / f.width, fmt.height / f.height);
  const sorted = files.filter((f) => f.width && f.height).sort((a, b) => a.width * a.height - b.width * b.height);
  return sorted.find((f) => coverScale(f) <= 1.35) || sorted[sorted.length - 1];
}

const orientationOk = (w, h) =>
  fmt.orientation === "portrait" ? h >= w : fmt.orientation === "landscape" ? w >= h : true;

// ---------- sources: each returns normalized candidates ----------
// { id, source, kind: "video"|"image", url, ext, thumb, text, w, h, duration, credit }
const CC_OK = /^(public domain|pd|cc0|cc[ -]by(-sa)?([ -]\d(\.\d)?)?|attribution|no restrictions)/i;
const strip = (h) => (h ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const SOURCES = {
  async pexels(query) {
    const q = new URLSearchParams({ query, per_page: "30", orientation: fmt.orientation, size: "medium" });
    const data = await getJson("pexels", `https://api.pexels.com/videos/search?${q}`, { Authorization: KEYS.pexels });
    return data.videos.map((v) => {
      const f = pickRendition(v.video_files.filter((x) => x.file_type === "video/mp4"));
      return f && { id: `pexels-${v.id}`, source: "pexels", kind: "video", url: f.link, ext: "mp4", thumb: v.image, text: `${v.url} ${(v.tags ?? []).join(" ")}`,
        w: v.width, h: v.height, duration: v.duration, credit: `${v.user?.name ?? "Pexels"} - ${v.url}` };
    }).filter(Boolean);
  },
  async pixabay(query) {
    const q = new URLSearchParams({ key: KEYS.pixabay, q: query.slice(0, 100), per_page: "50", safesearch: "true" });
    const data = await getJson("pixabay", `https://pixabay.com/api/videos/?${q}`);
    return data.hits.map((h) => {
      const f = pickRendition(Object.values(h.videos).filter((x) => x.url));
      const big = h.videos.large?.width ? h.videos.large : h.videos.medium;
      return f && { id: `pixabay-${h.id}`, source: "pixabay", kind: "video", url: f.url, ext: "mp4", thumb: h.videos.tiny?.thumbnail || h.videos.small?.thumbnail,
        text: h.tags ?? "", w: big.width, h: big.height, duration: h.duration, credit: `${h.user} - ${h.pageURL}` };
    }).filter(Boolean);
  },
  async pexelsPhoto(query) {
    const q = new URLSearchParams({ query, per_page: "30", orientation: fmt.orientation });
    const data = await getJson("pexels", `https://api.pexels.com/v1/search?${q}`, { Authorization: KEYS.pexels });
    return data.photos.map((p) => ({ id: `pexels-photo-${p.id}`, source: "pexels", kind: "image", url: p.src.large2x, ext: "jpg", thumb: p.src.medium,
      text: `${p.url} ${p.alt ?? ""}`, w: p.width, h: p.height, credit: `${p.photographer} - ${p.url}` }));
  },
  async pixabayPhoto(query) {
    const orientation = fmt.orientation === "portrait" ? "vertical" : fmt.orientation === "landscape" ? "horizontal" : "all";
    const q = new URLSearchParams({ key: KEYS.pixabay, q: query.slice(0, 100), image_type: "photo", orientation, per_page: "30", safesearch: "true" });
    const data = await getJson("pixabay", `https://pixabay.com/api/?${q}`);
    // fullHDURL needs Pixabay "full API access"; largeImageURL (1280px) works for every key.
    return data.hits.map((p) => ({ id: `pixabay-photo-${p.id}`, source: "pixabay", kind: "image", url: p.fullHDURL || p.largeImageURL, ext: "jpg",
      thumb: p.webformatURL, text: p.tags ?? "", w: p.imageWidth, h: p.imageHeight, credit: `${p.user} - ${p.pageURL}` }));
  },
  async wikimedia(query) {
    const q = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6",
      gsrlimit: "20", prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: String(Math.max(fmt.width, fmt.height)) });
    const data = await getJson("wikimedia", `https://commons.wikimedia.org/w/api.php?${q}`);
    const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return pages.map((p) => {
      const ii = p.imageinfo?.[0];
      const meta = ii?.extmetadata ?? {};
      const lic = strip(meta.LicenseShortName?.value);
      // Only licences that allow commercial use and modification (we crop and zoom).
      if (!ii || !/^image\/(jpeg|png)$/.test(ii.mime) || !CC_OK.test(lic) || /\bNC\b|\bND\b|non-?commercial|no ?deriv/i.test(lic)) return null;
      const title = p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "");
      const src = ii.thumburl || ii.url;
      return { id: `wikimedia-${p.pageid}`, source: "wikimedia", kind: "image", url: src, ext: /png$/.test(ii.mime) ? "png" : "jpg",
        // Title + description only: category lists are long and match almost anything.
        thumb: src.replace(/\/\d+px-/, "/320px-"), text: `${title} ${strip(meta.ImageDescription?.value).slice(0, 300)}`,
        w: ii.width, h: ii.height, credit: `"${title}" by ${strip(meta.Artist?.value) || "unknown"}, ${lic} - ${ii.descriptionurl}` };
    }).filter(Boolean);
  },
  async nasa(query) {
    const q = new URLSearchParams({ q: query, media_type: "image", page_size: "20" });
    const data = await getJson("nasa", `https://images-api.nasa.gov/search?${q}`);
    return (data.collection?.items ?? []).map((it) => {
      const d = it.data?.[0], id = d?.nasa_id;
      if (!id) return null;
      const base = `https://images-assets.nasa.gov/image/${encodeURIComponent(id)}/${encodeURIComponent(id)}`;
      return { id: `nasa-${id}`, source: "nasa", kind: "image", url: `${base}~large.jpg`, fallbackUrl: `${base}~orig.jpg`, ext: "jpg", thumb: it.links?.[0]?.href,
        text: `${d.title} ${strip(d.description)} ${(d.keywords ?? []).join(" ")}`, w: 0, h: 0,
        credit: `NASA - "${d.title}" (${d.center ?? "NASA"}) - https://images.nasa.gov/details/${encodeURIComponent(id)}` };
    }).filter(Boolean);
  },
};

// ---------- relevance ----------
// Stock search ranks loosely (Pixabay returns lipstick for "phone settings").
// Score each candidate by how many keyword words its tags / title / description
// contain, then orientation, motion and length, keeping each API's own order as
// the tie-break. Green-screen / mockup / template clips are never usable.
const STOP = new Set(["the", "and", "with", "for", "from", "into", "over", "close", "shot", "video", "footage", "photo", "image"]);
const BLOCK = /green ?screen|chroma|mock-?up|template|alpha channel|lower third|placeholder/i;
const wordsOf = (q) => q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
const relevance = (query, text) => {
  const words = wordsOf(query), t = text.toLowerCase();
  return words.length ? words.filter((w) => t.includes(w)).length / words.length : 0;
};
// Names something real and specific (a year, a proper noun after the first word):
// archive imagery is then likely more accurate than stock.
const factual = (q) => /\b(1[5-9]\d\d|20\d\d)\b/.test(q) || /\s[A-Z][a-z]/.test(q);

function rank(cands, query, minSec) {
  return cands
    .filter((c) => !used.has(c.id) && !BLOCK.test(c.text))
    .map((c, i) => {
      const rel = relevance(query, c.text);
      const archive = c.source === "wikimedia" || c.source === "nasa";
      const score = rel * 3 + (c.w && orientationOk(c.w, c.h) ? 1 : 0) + (c.kind === "video" ? 0.6 : 0) +
        ((c.duration ?? minSec) >= minSec ? 0.4 : 0) + (archive && factual(query) ? 0.8 : 0) - i * 0.01;
      return { ...c, rel, score };
    })
    .sort((a, b) => b.score - a.score);
}

// All candidates for a keyword, best first. Stops querying sources once there are
// enough relevant ones, so rate-limited APIs aren't hit needlessly.
async function candidatesFor(keyword, minSec, want = 6) {
  const mode = keyword.match(/^(photo|archive):/)?.[1] ?? "auto";
  const query = keyword.replace(/^(photo|archive):/, "").trim();
  const archive = archiveOn ? ["wikimedia", "nasa"] : [];
  const photos = [...(KEYS.pexels ? ["pexelsPhoto"] : []), ...(KEYS.pixabay ? ["pixabayPhoto"] : [])];
  const order =
    mode === "archive" ? archive :
    mode === "photo" ? (factual(query) ? [...archive, ...photos] : [...photos, ...archive]) :
    factual(query) ? [...stockSources, ...archive, ...photos] : [...stockSources, ...photos, ...archive];
  let pool = [];
  for (const src of order) {
    try {
      pool = pool.concat(await SOURCES[src](query, minSec));
    } catch (e) {
      if (!(e instanceof RateLimited)) log("broll", `${src} search failed (${e.message}), trying next source`);
    }
    if (rank(pool, query, minSec).filter((c) => c.rel >= 0.5).length >= want) break;
  }
  return rank(pool, query, minSec);
}

// ---------- AI stills for "ai:" keywords ----------
async function generateImage(prompt, dest) {
  if (!KEYS.openai) throw new Error("set OPENAI_API_KEY for ai: keywords");
  const size = fmt.orientation === "portrait" ? "1024x1536" : fmt.orientation === "landscape" ? "1536x1024" : "1024x1024";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEYS.openai}` },
    body: JSON.stringify({ model: project.aiImageModel ?? "gpt-image-1", prompt: `${prompt}. Photographic, cinematic lighting, no text, no watermark.`, size }),
  });
  if (!res.ok) throw new Error(`OpenAI images ${res.status}`);
  const data = await res.json();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(data.data[0].b64_json, "base64"));
}

// ---------- download + checks ----------
async function download(url, dest, fallbackUrl) {
  let res = await fetch(url, { headers: UA });
  if (!res.ok && fallbackUrl) res = await fetch(fallbackUrl, { headers: UA });
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
  if (!fs.existsSync(abs)) await download(hit.url, abs, hit.fallbackUrl);
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

const shotFromHit = (hit, kw) => ({ type: hit.kind, src: `broll/${hit.id.replace(/[^\w.-]+/g, "_")}.${hit.ext}`, duration: null, assetId: hit.id, keyword: kw, credit: hit.credit });

async function fetchJob(job) {
  if (job.ai) {
    const abs = path.join(PUBLIC, job.shot.src);
    if (!fs.existsSync(abs)) await generateImage(job.ai, abs);
    log("broll", `${job.label} -> ${job.shot.src} (AI-generated)`);
    return;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    await fetchOnce(job);
    const file = path.join(PUBLIC, job.shot.src);
    const problem = frameProblem(file, job.shot.type === "video" ? job.shot.duration : null);
    if (!problem) {
      log("broll", `${job.label} -> ${job.shot.src}${job.picked ? " (picked)" : ""}`);
      return;
    }
    fs.rmSync(file, { force: true });
    const next = (await candidatesFor(job.kw, job.shotSec))[0];
    log("broll", `${job.label}: ${path.basename(job.shot.src)} is ${problem}, ${next ? "trying the next result" : "no more results"}`);
    if (!next) break;
    used.add(next.id);
    job.hit = next;
    Object.assign(job.shot, shotFromHit(next, job.kw));
  }
  throw new Error("no usable clip");
}

// ---------- 1. plan ----------
// Shots: scene length / maxShotSeconds (split layout: always 2). Shot k uses
// keyword k (cycling). A shot keeps the clip it got last run (same keyword, file
// on disk), so re-runs only fill gaps. Review picks override everything.
const previous = readJson(path.join(BUILD, "broll.json"), {});
const picks = readJson(path.join(BUILD, "picks.json"), {});
const review = readJson(path.join(BUILD, "review.json"), {});
const keepPrev = (id, k, kw) => {
  const p = previous[id]?.[k];
  return p?.assetId && p.src && p.keyword === kw && fs.existsSync(path.join(PUBLIC, p.src)) ? p : null;
};

const shotsOf = (scene, i) => {
  const id = sceneId(i);
  const vo = readJson(path.join(BUILD, "vo", `${id}.json`), null);
  if (!vo) throw new Error(`Missing build/vo/${id}.json - run the voiceover step first.`);
  const sec = vo.durationMs / 1000;
  const split = scene.layout === "split";
  const nShots = split ? 2 : Math.max(1, Math.ceil(sec / project.maxShotSeconds));
  return { id, nShots, shotSec: split ? sec : sec / nShots, keywords: scene.broll?.length ? scene.broll : [] };
};

// ---------- review mode: contact sheets of candidates ----------
if (reviewArg) {
  const out = {};
  const dir = path.join(BUILD, "review");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let sheets = 0;
  for (const [i, scene] of project.scenes.entries()) {
    const { id, nShots, shotSec, keywords } = shotsOf(scene, i);
    const important = i === 0 || scene.emphasis || [].concat(scene.fx ?? []).includes("reveal") || scene.layout === "split";
    for (let k = 0; k < nShots; k++) {
      const kw = keywords.length ? keywords[k % keywords.length] : null;
      if (!kw || scene.visual === "kinetic" || /^(file|ai):/.test(kw)) continue;
      const key = `${id}-${k + 1}`;
      const cands = (await candidatesFor(kw, shotSec)).slice(0, 6);
      if (!cands.length) continue;
      // Default: review the hook, emphasis/reveal/split scenes and weak matches only.
      if (!reviewAll && !important && cands[0].rel >= 0.67) continue;
      // Normalize every thumbnail to the same 320x320 tile, then lay them out 3x2.
      for (const [n, c] of cands.entries()) {
        const raw = path.join(dir, `${key}-raw${n + 1}`), tile = path.join(dir, `${key}-t${n + 1}.jpg`);
        try {
          await download(c.thumb, raw);
          // One pixel format for every tile: a 4:4:4 JPEG in a 4:2:0 sequence stops the tiler.
          ffmpeg(["-i", raw, "-frames:v", "1", "-vf", "scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=white,format=yuvj420p", tile]);
        } catch {}
        if (!fs.existsSync(tile)) ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=320x320", "-frames:v", "1", "-vf", "format=yuvj420p", tile]);
        fs.rmSync(raw, { force: true });
      }
      ffmpeg(["-framerate", "1", "-start_number", "1", "-i", path.join(dir, `${key}-t%d.jpg`), "-vf", "tile=3x2:padding=8:color=white", "-frames:v", "1", path.join(dir, `${key}.jpg`)]);
      for (let n = 1; n <= cands.length; n++) fs.rmSync(path.join(dir, `${key}-t${n}.jpg`), { force: true });
      out[key] = { scene: id, keyword: kw, line: scene.text, sheet: `build/review/${key}.jpg`,
        candidates: cands.map((c, n) => ({ n: n + 1, id: c.id, source: c.source, kind: c.kind, rel: Math.round(c.rel * 100) / 100, text: c.text.slice(0, 140), hit: c })) };
      sheets++;
    }
  }
  writeJson(path.join(BUILD, "review.json"), out);
  log("broll", `review: ${sheets} sheets in build/review/ (candidates 1-6, left to right, top to bottom).`);
  log("broll", 'Write choices to build/picks.json, e.g. {"s001-1": 3}; change the keyword instead if none fits. Then run without --review.');
  process.exit(0);
}

// Review picks: reserve every picked clip first (the first shot to pick a clip
// gets it), and release clips that picks are replacing, so a clip can move from
// one shot to another. Everything else already on screen stays reserved.
const pickFor = (key, kw) => {
  const rv = review[key], n = picks[key];
  return n != null && rv?.keyword === kw ? rv.candidates.find((c) => c.n === Number(n) || c.id === n)?.hit ?? null : null;
};
const pickedBy = new Map();
const replaced = new Set();
for (const [i, scene] of project.scenes.entries()) {
  const { id, nShots, keywords } = shotsOf(scene, i);
  for (let k = 0; k < nShots; k++) {
    const kw = keywords.length ? keywords[k % keywords.length] : null;
    const hit = kw && pickFor(`${id}-${k + 1}`, kw);
    if (!hit) continue;
    if (!pickedBy.has(hit.id)) pickedBy.set(hit.id, `${id}-${k + 1}`);
    if (previous[id]?.[k]?.assetId && previous[id][k].assetId !== hit.id) replaced.add(previous[id][k].assetId);
  }
}
for (const p of Object.values(previous).flat()) if (p.assetId && !replaced.has(p.assetId)) used.add(p.assetId);
for (const pid of pickedBy.keys()) used.add(pid);

const plan = {};
const jobs = [];
for (const [i, scene] of project.scenes.entries()) {
  const { id, nShots, shotSec, keywords } = shotsOf(scene, i);
  plan[id] = [];
  for (let k = 0; k < nShots; k++) {
    const kw = keywords.length ? keywords[k % keywords.length] : null;
    const label = `${id} shot ${k + 1} "${kw}"`;
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
    if (kw.startsWith("ai:")) {
      const prompt = kw.slice(3).trim();
      const shot = { type: "image", src: `broll/ai-${Buffer.from(prompt).toString("base64url").slice(0, 40)}.png`, duration: null, assetId: `ai-${prompt}`,
        keyword: kw, credit: "AI-generated image (OpenAI) - disclose as altered/synthetic content if it looks real" };
      plan[id].push(shot);
      jobs.push({ shot, ai: prompt, kw, shotSec, label });
      continue;
    }
    // A review pick for this shot (same keyword) wins.
    const key = `${id}-${k + 1}`;
    let picked = pickFor(key, kw);
    if (picked && pickedBy.get(picked.id) !== key) {
      log("broll", `${label}: pick ${picks[key]} was already picked for ${pickedBy.get(picked.id)}, choosing automatically`);
      picked = null;
    }
    const prev = keepPrev(id, k, kw);
    if (prev && (!picked || prev.assetId === picked.id)) {
      plan[id].push(prev);
      continue;
    }
    const hit = picked ?? (await candidatesFor(kw, shotSec))[0];
    if (!hit) {
      log("broll", `${label}: nothing found -> kinetic`);
      fellBack++;
      plan[id].push({ type: "kinetic" });
      continue;
    }
    used.add(hit.id);
    const shot = shotFromHit(hit, kw);
    plan[id].push(shot);
    jobs.push({ shot, hit, kw, shotSec, label, picked: !!picked });
  }
}

// ---------- 2. download (4 at a time) ----------
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
const all = Object.values(plan).flat();
const credits = [...new Set(all.map((s) => s.credit).filter(Boolean))];
// Delete downloads no shot uses any more (changed keywords, earlier picks).
const keep = new Set(all.map((s) => s.src).filter(Boolean).map((s) => path.basename(s)));
const brollDir = path.join(PUBLIC, "broll");
if (fs.existsSync(brollDir)) {
  for (const f of fs.readdirSync(brollDir)) {
    if (/^(pexels|pixabay|wikimedia|nasa)-/.test(f) && !keep.has(f) && !f.endsWith(".part")) fs.rmSync(path.join(brollDir, f));
  }
}
fs.writeFileSync(path.join(BUILD, "credits.txt"), credits.join("\n") + "\n");
log("broll", `done: ${all.filter((s) => s.type !== "kinetic").length}/${all.length} shots have footage, ${searches} new searches`);
const bySource = {};
for (const s of all) if (s.assetId) bySource[s.assetId.split("-")[0]] = (bySource[s.assetId.split("-")[0]] ?? 0) + 1;
if (Object.keys(bySource).length) log("broll", `sources: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(", ")}`);
if (credits.some((c) => /CC BY/i.test(c))) log("broll", "CC BY / BY-SA images used: paste build/credits.txt into the video description (required).");
if (credits.some((c) => /^AI-generated/.test(c))) log("broll", "AI images used: if they look real, tick YouTube's altered/synthetic content disclosure.");
if (exhausted.size && fellBack) {
  log("broll", `${fellBack} shots fell back because ${[...exhausted].join(", ")} hit a rate limit. ` +
    "Re-run `node scripts/auto.mjs --from=broll` later: finished searches and downloads are cached.");
}
