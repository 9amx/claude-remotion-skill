// Find and download B-roll for every shot of every scene.
//   Pexels  (PEXELS_API_KEY)  - videos, then photos. Best portrait coverage.
//   Pixabay (PIXABAY_API_KEY) - videos, used when Pexels has nothing.
//   "file:clip.mp4" / "file:pic.jpg" in scene.broll - your own asset from public/.
// No key and no file -> the shot renders as an animated "kinetic" background.
// Writes build/broll.json and build/credits.txt. Downloads are cached in public/broll/.
import fs from "node:fs";
import path from "node:path";
import { BUILD, FORMATS, PUBLIC, log, probeDuration, readJson, readProject, sceneId, writeJson } from "./lib.mjs";

const project = readProject();
const fmt = FORMATS[project.format];
const PEXELS = process.env.PEXELS_API_KEY;
const PIXABAY = process.env.PIXABAY_API_KEY;
const used = new Set();
const credits = [];
const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;

if (!PEXELS && !PIXABAY) {
  log("broll", "No PEXELS_API_KEY / PIXABAY_API_KEY: only file: assets are used, other shots go kinetic.");
}

async function getJson(url, headers = {}) {
  const cacheFile = path.join(BUILD, "search-cache", Buffer.from(url).toString("base64url").slice(0, 120) + ".json");
  const cached = readJson(cacheFile, null);
  if (cached) return cached;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split("?")[0]}`);
  const data = await res.json();
  writeJson(cacheFile, data);
  return data;
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + ".part", Buffer.from(await res.arrayBuffer()));
  fs.renameSync(dest + ".part", dest);
}

// Smallest rendition that still covers the frame's short side, else the biggest one.
function pickRendition(files) {
  const need = Math.min(fmt.width, fmt.height);
  const sorted = files.filter((f) => f.width && f.height).sort((a, b) => a.width * a.height - b.width * b.height);
  return sorted.find((f) => Math.min(f.width, f.height) >= need) || sorted[sorted.length - 1];
}

const orientationOk = (w, h) =>
  fmt.orientation === "portrait" ? h >= w : fmt.orientation === "landscape" ? w >= h : true;

async function pexelsVideo(query, minSec) {
  const q = new URLSearchParams({ query, per_page: "20", orientation: fmt.orientation, size: "medium" });
  const data = await getJson(`https://api.pexels.com/videos/search?${q}`, { Authorization: PEXELS });
  const pool = data.videos.filter((v) => !used.has(`pexels-${v.id}`));
  const v = pool.find((x) => x.duration >= minSec) || pool[0];
  if (!v) return null;
  const file = pickRendition(v.video_files.filter((f) => f.file_type === "video/mp4"));
  return file && { id: `pexels-${v.id}`, url: file.link, ext: "mp4", credit: `${v.user?.name ?? "Pexels"} - ${v.url}` };
}

async function pexelsPhoto(query) {
  const q = new URLSearchParams({ query, per_page: "20", orientation: fmt.orientation });
  const data = await getJson(`https://api.pexels.com/v1/search?${q}`, { Authorization: PEXELS });
  const p = data.photos.find((x) => !used.has(`pexels-photo-${x.id}`));
  return p && { id: `pexels-photo-${p.id}`, url: p.src.large2x, ext: "jpg", credit: `${p.photographer} - ${p.url}` };
}

async function pixabayVideo(query, minSec) {
  const q = new URLSearchParams({ key: PIXABAY, q: query.slice(0, 100), per_page: "30", safesearch: "true" });
  const data = await getJson(`https://pixabay.com/api/videos/?${q}`);
  const pool = data.hits.filter((h) => !used.has(`pixabay-${h.id}`));
  const ranked = [...pool.filter((h) => orientationOk(h.videos.large.width, h.videos.large.height)), ...pool];
  const h = ranked.find((x) => x.duration >= minSec) || ranked[0];
  if (!h) return null;
  const file = pickRendition(Object.values(h.videos).filter((f) => f.url));
  return file && { id: `pixabay-${h.id}`, url: file.url, ext: "mp4", credit: `${h.user} - ${h.pageURL}` };
}

async function findShot(keyword, minSec) {
  const photoOnly = keyword.startsWith("photo:");
  const query = keyword.replace(/^photo:/, "").trim();
  const tries = [];
  if (PEXELS && !photoOnly) tries.push(() => pexelsVideo(query, minSec));
  if (PIXABAY && !photoOnly) tries.push(() => pixabayVideo(query, minSec));
  if (PEXELS) tries.push(() => pexelsPhoto(query));
  for (const t of tries) {
    try {
      const hit = await t();
      if (hit) return hit;
    } catch (e) {
      log("broll", `search failed (${e.message}), trying next source`);
    }
  }
  return null;
}

const result = {};
for (const [i, scene] of project.scenes.entries()) {
  const id = sceneId(i);
  const vo = readJson(path.join(BUILD, "vo", `${id}.json`), null);
  if (!vo) throw new Error(`Missing build/vo/${id}.json - run the voiceover step first.`);
  const sec = vo.durationMs / 1000;
  const keywords = scene.broll?.length ? scene.broll : [];
  const nShots = Math.max(1, Math.ceil(sec / project.maxShotSeconds));
  const shotSec = sec / nShots;
  result[id] = [];
  for (let k = 0; k < nShots; k++) {
    const kw = keywords.length ? keywords[k % keywords.length] : null;
    if (scene.visual === "kinetic" || !kw) {
      result[id].push({ type: "kinetic" });
      continue;
    }
    if (kw.startsWith("file:")) {
      const src = kw.slice(5).trim();
      const abs = path.join(PUBLIC, src);
      if (!fs.existsSync(abs)) throw new Error(`${id}: ${src} not found in public/`);
      const isVideo = VIDEO_EXT.test(src);
      result[id].push({ type: isVideo ? "video" : "image", src, duration: isVideo ? probeDuration(abs) : null });
      continue;
    }
    const hit = await findShot(kw, shotSec);
    if (!hit) {
      log("broll", `${id} shot ${k + 1}: nothing for "${kw}" -> kinetic`);
      result[id].push({ type: "kinetic" });
      continue;
    }
    used.add(hit.id);
    const src = `broll/${id}-${k + 1}-${hit.id}.${hit.ext}`;
    await download(hit.url, path.join(PUBLIC, src));
    const isVideo = hit.ext === "mp4";
    result[id].push({ type: isVideo ? "video" : "image", src, duration: isVideo ? probeDuration(path.join(PUBLIC, src)) : null });
    credits.push(hit.credit);
    log("broll", `${id} shot ${k + 1}: "${kw}" -> ${src}`);
  }
}

writeJson(path.join(BUILD, "broll.json"), result);
fs.writeFileSync(path.join(BUILD, "credits.txt"), [...new Set(credits)].join("\n") + "\n");
log("broll", `done: ${Object.values(result).flat().filter((s) => s.type !== "kinetic").length} assets`);
