// Find, check and download the picture for every shot of every scene.
//
// Sources (all optional; whatever has a key / is reachable is used):
//   Pexels   (PEXELS_API_KEY)  stock video + photos, best portrait library, 200 searches/hour
//   Pixabay  (PIXABAY_API_KEY) stock video + photos, 100 searches/minute
//   Wikimedia Commons (no key) real people, places, events, documents; CC/PD licences only
//   NASA Image Library (no key) space, science, aviation; public domain
//   Coverr   (COVERR_API_KEY)  free cinematic stock video, no attribution needed
//   DVIDS    (DVIDS_API_KEY)   US military / government video: wars, disasters, rescues,
//                              aircraft, ships. Mostly public domain; credited anyway
//   OpenAI images (OPENAI_API_KEY) generated stills for "ai:" keywords
//   YouTube CC (YOUTUBE_API_KEY or the channel sign-in) Creative Commons video, license-checked
//                              (yt-lib.mjs); used only when an authorized file exists (yt-engine.mjs
//                              source / import / authorize). Searched like DVIDS: real things only
// Keyword prefixes in scene.broll:
//   "city traffic night"   stock video first, photos as fallback; archive photos join in
//                          automatically when the keyword names something real (a year,
//                          a proper noun) or stock has nothing relevant
//   "photo:old map"        photos only (stock + archive)
//   "archive:Apollo 11"    Wikimedia + NASA (+ DVIDS, YouTube CC video) only: accurate, real imagery
//   "yt:Saturn V liftoff"  YouTube Creative Commons only
//   "ai:prompt"            generate an image (needs OPENAI_API_KEY)
//   "file:clip.mp4"        your own asset in public/; "file:talk.mp4#12.5-16" uses just
//                          that part (cut once into broll/clip-*.mp4). A beat's "credit"
//                          goes to build/credits.txt (CC BY and licensed clips need it).
//   "adobe:430358060"      an Adobe Stock clip licensed through the Adobe connector
//                          and added with scripts/adobe-stock.mjs (also usable as a pick)
// Beats with "graphic" need no search: map places given as names are geocoded
// (OpenStreetMap Nominatim, cached in build/geocode.json) and the country
// shapes are copied to public/geo/.
//
// Shots follow the words: scene.broll beats ({ "on": "phrase", "kw": [...] }) start
// on their phrase (lib.mjs planShots), so every search knows exactly which words
// it has to illustrate and for how long.
//
// Review (accuracy): `node scripts/fetch-broll.mjs --review` downloads only small
// thumbnails and writes build/review/<scene>-<shot>.jpg (candidates numbered 1-6,
// left to right, top to bottom) + build/review.json (with the words spoken over
// each shot). Look at them, then write the winners to build/picks.json, e.g.
// {"s001-1": 3, "s004-2": 1}. The normal run uses the picks. `--review` covers
// every shot; `--review=key` only the ones that matter most or that search is
// unsure about (hook, emphasis/reveal/split scenes, weak matches). Long form:
// `--review --chapter=N` does one chapter and keeps the other chapters' sheets.
//
// No random footage: a result is used automatically only if it shares words with
// the keyword (brollMinRelevance, default 0.25); otherwise the beat's other
// keywords are tried, then the kinetic fallback. Review picks always win.
// Every downloaded clip is frame-checked (nearly black or green-screen -> next
// result), long clips are trimmed to what the shot needs, the clip's own internal
// cuts are detected (build-timeline plays a stretch without one), picks stay
// stable across runs. Writes build/broll.json and build/credits.txt (attribution for CC images).
import fs from "node:fs";
import path from "node:path";
import { BLOCK, BUILD, FORMATS, GRAPHIC_TYPES, PUBLIC, ROOT, adobeAsset, ffmpeg, ffmpegRaw, fail, log, parseFileRef, planShots, probeDuration, probeSize, readJson, readProject,
  relevance, sceneId, sleep, status, writeJson } from "./lib.mjs";
import { NOT_REAL, QuotaError, YT, authorizedSource, fetchRaw, licenseFor, loadLicenses, noteWanted, saveLicenses, searchCC, usable, videoDetails, windowFor,
  ytAvailable } from "./yt-lib.mjs";
import { bestMoment, checkMedia, clearVisionTmp, scoreImages, visionReady, visualQuery } from "./vision.mjs";
import { mismatch } from "./match-rules.mjs";

const args = process.argv.slice(2);
const reviewArg = args.find((a) => a.startsWith("--review"));
const reviewAll = reviewArg !== "--review=key";
// Long form: review one chapter at a time (--chapter=2); earlier sheets and picks stay.
const chapterArg = Number(args.find((a) => a.startsWith("--chapter="))?.slice(10)) || null;
// --review --shot=s004-2: just that shot's sheet (the editor's "find alternatives").
const shotArg = args.find((a) => a.startsWith("--shot="))?.slice(7) ?? null;
const project = readProject();
const fmt = FORMATS[project.format];
const KEYS = { pexels: process.env.PEXELS_API_KEY, pixabay: process.env.PIXABAY_API_KEY, coverr: process.env.COVERR_API_KEY,
  dvids: process.env.DVIDS_API_KEY, openai: process.env.OPENAI_API_KEY,
  unsplash: process.env.UNSPLASH_ACCESS_KEY ?? process.env.UNSPLASH_API_KEY, flickr: process.env.FLICKR_API_KEY,
  // These two work with public demo keys (rate-limited); free personal keys lift the limits.
  smithsonian: process.env.SMITHSONIAN_API_KEY ?? "DEMO_KEY", europeana: process.env.EUROPEANA_API_KEY ?? "api2demo" };
// Coverr joins the stock search whenever its key is set, after the listed sources.
const listed = project.brollSources ?? ["pexels", "pixabay"];
const stockSources = [...listed, ...(listed.includes("coverr") ? [] : ["coverr"])].filter((s) => KEYS[s]);
const archiveOn = project.archive !== false; // Wikimedia + NASA need no key, DVIDS needs DVIDS_API_KEY
const ARCHIVE = new Set(["wikimedia", "nasa", "dvids", "archiveorg", "openverse", "flickr", "smithsonian", "europeana", "artic", "cleveland", "svs", "wellcome", "inat", "youtube"]);
// YouTube Creative Commons (yt-lib.mjs): on with YOUTUBE_API_KEY or the channel sign-in, for archive: / yt:
// keywords and lines that name something real. A search costs 100 of the 10,000 free daily quota units.
const ytOn = project.youtubeCC !== false && ytAvailable();
const ytBudget = project.youtubeMaxSearches ?? 30;
// Vision (vision.mjs, CLIP): a downloaded clip must show its keyword at least this much (0-1), else the next result.
const VMIN = project.visionMin ?? 0.4;
const visionOn = project.vision !== false && (await visionReady());
let ytSearches = 0;
const ytWanted = new Set();
const maxWaitMs = (project.brollMaxWaitMinutes ?? 0) * 60_000;
const trim = project.trimBroll !== false;
// Below this share of keyword words a result is never auto-picked: 1 of 3 words ("closed shop sign" -> a shop) is not a match.
const MIN_REL = project.brollMinRelevance ?? 0.4;
// Search every source for every keyword and compare all results (default), or
// stop at the first sources that give enough good matches (brollSearchAll: false,
// fewer API calls). A source that hits its rate limit drops out for the run.
const searchAll = project.brollSearchAll !== false;
const UA = { "User-Agent": "faceless-video-editor/1.0 (https://github.com/9amx/claude-remotion-skill)" };
const exhausted = new Set();
const unreachable = new Map(); // source -> network failures this run
const used = new Set();
const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;
let searches = 0, fellBack = 0;

if (!stockSources.length) log("broll", "No PEXELS_API_KEY / PIXABAY_API_KEY / COVERR_API_KEY: stock video off; archive photos and file: assets still work.");

class RateLimited extends Error {}

async function getJson(source, url, headers = {}) {
  const cacheFile = path.join(BUILD, "search-cache", Buffer.from(url.replace(/key=[^&]+/, "")).toString("base64url").slice(0, 150) + ".json");
  const cached = readJson(cacheFile, null);
  if (cached) return cached;
  if (exhausted.has(source)) throw new RateLimited(source);
  for (let attempt = 0; ; attempt++) {
    // 20 s cap: a site that hangs must not stall the whole footage step.
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(20_000) });
    searches++;
    if (res.status === 429) {
      // Pixabay, Wikimedia and NASA reset within a minute: worth waiting. Pexels
      // resets hourly: wait only if brollMaxWaitMinutes allows, else use other sources.
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const retryAfter = Number(res.headers.get("retry-after"));
      const short = ["pixabay", "wikimedia", "nasa", "archiveorg", "openverse", "flickr", "unsplash", "europeana", "artic", "cleveland", "svs", "wellcome"].includes(source);
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
  async coverr(query) {
    const q = new URLSearchParams({ query: query.slice(0, 100), page_size: "30", urls: "true" });
    const data = await getJson("coverr", `https://api.coverr.co/videos?${q}`, { Authorization: `Bearer ${KEYS.coverr}` });
    return (data.hits ?? []).map((v) => {
      const url = v.urls?.mp4_download || v.urls?.mp4;
      return url && { id: `coverr-${v.id}`, source: "coverr", kind: "video", url, ext: "mp4", thumb: v.thumbnail || v.poster,
        text: `${v.title ?? ""} ${v.description ?? ""} ${(v.tags ?? []).join(" ")}`, w: v.max_width, h: v.max_height, duration: v.duration,
        // Coverr's terms: every download is reported (fetchOnce does it).
        ping: `https://api.coverr.co/videos/${v.id}/stats/downloads`, credit: `Coverr - "${v.title ?? v.id}" - https://coverr.co/videos/${v.id}` };
    }).filter(Boolean);
  },
  async dvids(query) {
    // DVIDS answers "landscape"/"portrait" with nothing; 16:9 works (vertical video is rare there).
    const aspect = fmt.orientation === "landscape" ? "16:9" : "";
    const q = new URLSearchParams({ api_key: KEYS.dvids, q: query.slice(0, 100), type: "video", hd: "1", max_results: "25", short_description_length: "300",
      thumb_width: "320", thumb_height: "180", ...(aspect ? { aspect_ratio: aspect } : {}) });
    const data = await getJson("dvids", `https://api.dvidshub.net/search?${q}`);
    // Search has no file links: resolveUrl asks /asset for them once a clip is chosen.
    return (data.results ?? []).filter((r) => r.type === "video" && r.id).map((r) => ({
      id: `dvids-${String(r.id).replace(/^video:/, "")}`, source: "dvids", kind: "video", url: null, dvidsId: r.id, ext: "mp4", thumb: r.thumbnail,
      text: `${r.title ?? ""} ${strip(r.short_description)} ${[].concat(r.keywords ?? []).join(" ")}`, duration: r.duration,
      // Shape only (for the orientation score); the real size comes with the asset call.
      w: Number(String(r.aspect_ratio).split(":")[0]) || 0, h: Number(String(r.aspect_ratio).split(":")[1]) || 0,
      credit: `DVIDS - "${r.title}" - ${[r.credit, r.unit_name, r.branch].filter(Boolean).join(", ")} - ${r.url} (U.S. government work; no endorsement implied)` }));
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

  // ---- more free sources: real footage and photos, commercial-use licences only ----
  // Wikimedia Commons VIDEO (webm/ogv, transcoded to H.264 on download): real events, places, products.
  async wikimediaVideo(query) {
    const q = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: `${query} filetype:video`, gsrnamespace: "6",
      gsrlimit: "20", prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "320" });
    const data = await getJson("wikimedia", `https://commons.wikimedia.org/w/api.php?${q}`);
    const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return pages.map((p) => {
      const ii = p.imageinfo?.[0];
      const meta = ii?.extmetadata ?? {};
      const lic = strip(meta.LicenseShortName?.value);
      if (!ii || !/^(video|application)\/(webm|ogg|mp4)/.test(ii.mime) || !CC_OK.test(lic) || /\bNC\b|\bND\b|non-?commercial|no ?deriv/i.test(lic)) return null;
      if (ii.size > 600e6 || (ii.width && ii.width < 1000)) return null; // too big to fetch, or too small to fill 1080p
      const title = p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
      return { id: `wikimedia-v${p.pageid}`, source: "wikimedia", kind: "video", url: ii.url, ext: "mp4", transcode: true,
        thumb: ii.thumburl, text: `${title} ${strip(meta.ImageDescription?.value).slice(0, 300)}`, w: ii.width, h: ii.height,
        duration: Number(meta.Duration?.value ?? ii.duration) || undefined,
        credit: `"${title}" by ${strip(meta.Artist?.value) || "unknown"}, ${lic} - ${ii.descriptionurl}` };
    }).filter(Boolean);
  },
  // NASA video (public domain): launches, Earth, space, aircraft. The file list comes with the chosen clip.
  async nasaVideo(query) {
    const q = new URLSearchParams({ q: query, media_type: "video", page_size: "20" });
    const data = await getJson("nasa", `https://images-api.nasa.gov/search?${q}`);
    return (data.collection?.items ?? []).map((it) => {
      const d = it.data?.[0], id = d?.nasa_id;
      return id && { id: `nasa-v-${id}`, source: "nasa", kind: "video", url: null, nasaId: id, ext: "mp4", thumb: it.links?.[0]?.href,
        text: `${d.title} ${strip(d.description).slice(0, 300)} ${(d.keywords ?? []).join(" ")}`, w: 0, h: 0,
        credit: `NASA - "${d.title}" (${d.center ?? "NASA"}) - https://images.nasa.gov/details/${encodeURIComponent(id)}` };
    }).filter(Boolean);
  },
  // Internet Archive: films marked public domain / CC0 / CC BY / CC BY-SA only (rights are per item).
  async archiveOrg(query) {
    const lic = "(licenseurl:*publicdomain* OR licenseurl:*creativecommons.org/licenses/by/* OR licenseurl:*creativecommons.org/licenses/by-sa/*)";
    const q = new URLSearchParams({ q: `(${query.replace(/[():"]/g, " ")}) AND mediatype:movies AND ${lic}`, rows: "20", output: "json" });
    for (const f of ["identifier", "title", "description", "licenseurl", "creator", "subject"]) q.append("fl[]", f);
    const data = await getJson("archiveorg", `https://archive.org/advancedsearch.php?${q}`);
    return (data.response?.docs ?? []).filter((d) => d.identifier && !/-nc|-nd|noncommercial/i.test(d.licenseurl ?? "")).map((d) => ({
      id: `archiveorg-${d.identifier}`, source: "archiveorg", kind: "video", url: null, iaId: d.identifier, ext: "mp4", transcode: true,
      thumb: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`, w: 0, h: 0,
      text: `${[].concat(d.title ?? []).join(" ")} ${strip([].concat(d.description ?? []).join(" ")).slice(0, 300)} ${[].concat(d.subject ?? []).join(" ")}`,
      credit: `Internet Archive - "${[].concat(d.title ?? d.identifier)[0]}"${d.creator ? ` by ${[].concat(d.creator)[0]}` : ""} - ${d.licenseurl} - https://archive.org/details/${d.identifier}` }));
  },
  // Openverse: CC photos from 800+ collections (Flickr, museums, Wikimedia), commercial use + modification allowed.
  async openverse(query) {
    const q = new URLSearchParams({ q: query.slice(0, 200), license_type: "commercial,modification", page_size: "20", mature: "false",
      aspect_ratio: fmt.orientation === "portrait" ? "tall" : fmt.orientation === "landscape" ? "wide" : "square" });
    const data = await getJson("openverse", `https://api.openverse.org/v1/images/?${q}`);
    return (data.results ?? []).filter((r) => r.url && /^(by|by-sa|cc0|pdm)$/i.test(r.license)).map((r) => ({
      id: `openverse-${r.id}`, source: "openverse", kind: "image", url: r.url, ext: /\.png(\?|$)/i.test(r.url) ? "png" : "jpg", thumb: r.thumbnail,
      text: `${r.title ?? ""} ${(r.tags ?? []).map((t) => t.name).join(" ")}`, w: r.width ?? 0, h: r.height ?? 0,
      credit: `"${r.title ?? "untitled"}" by ${r.creator ?? "unknown"}, ${String(r.license).toUpperCase()} ${r.license_version ?? ""} via ${r.source ?? r.provider} - ${r.foreign_landing_url}` }));
  },
  // Unsplash (free key UNSPLASH_ACCESS_KEY): stock-quality photos, Unsplash licence (commercial use OK).
  async unsplash(query) {
    const q = new URLSearchParams({ query: query.slice(0, 100), per_page: "20", content_filter: "high",
      ...(fmt.orientation === "portrait" ? { orientation: "portrait" } : fmt.orientation === "landscape" ? { orientation: "landscape" } : { orientation: "squarish" }) });
    const data = await getJson("unsplash", `https://api.unsplash.com/search/photos?${q}`, { Authorization: `Client-ID ${KEYS.unsplash}`, "Accept-Version": "v1" });
    return (data.results ?? []).map((p) => ({
      id: `unsplash-${p.id}`, source: "unsplash", kind: "image", url: `${p.urls.raw}&w=${Math.max(fmt.width, fmt.height)}&fm=jpg&q=85`, ext: "jpg", thumb: p.urls.small,
      text: `${p.description ?? ""} ${p.alt_description ?? ""} ${(p.tags ?? []).map((t) => t.title).join(" ")}`, w: p.width, h: p.height,
      // Unsplash API terms: report each download (fetchOnce does it).
      ping: p.links?.download_location, pingAuth: `Client-ID ${KEYS.unsplash}`,
      credit: `Photo by ${p.user?.name ?? "unknown"} on Unsplash - ${p.links?.html}` }));
  },
  // Smithsonian Open Access: CC0 images (science, history, nature, air & space). DEMO_KEY works but is
  // rate-limited; a free api.data.gov key (SMITHSONIAN_API_KEY) lifts it.
  async smithsonian(query) {
    const q = new URLSearchParams({ q: `${query.replace(/[":]/g, " ")} AND online_media_type:"Images"`, api_key: KEYS.smithsonian, rows: "20" });
    const data = await getJson("smithsonian", `https://api.si.edu/openaccess/api/v1.0/search?${q}`);
    return (data.response?.rows ?? []).map((r) => {
      const m = (r.content?.descriptiveNonRepeating?.online_media?.media ?? []).find((x) => x.usage?.access === "CC0" && x.type === "Images" && x.content);
      if (!m) return null;
      const notes = (r.content?.freetext?.notes ?? []).map((n) => n.content).join(" ");
      return { id: `smithsonian-${r.id}`, source: "smithsonian", kind: "image", url: `${m.content}&max=3000`, ext: "jpg", thumb: m.thumbnail ?? `${m.content}&max=320`,
        text: `${r.title ?? ""} ${strip(notes).slice(0, 250)} ${(r.content?.indexedStructured?.topic ?? []).join(" ")}`, w: 0, h: 0,
        credit: `Smithsonian - "${r.title}" (${r.unitCode ?? "Smithsonian"}), CC0 - ${r.content?.descriptiveNonRepeating?.record_link ?? ""}` };
    }).filter(Boolean);
  },
  // Europeana: 3,000+ European museums and archives, openly licensed only (PD, CC0, CC BY, CC BY-SA) - photos and
  // VIDEO (old newsreels, e.g. Open Beelden). Demo key works; a free EUROPEANA_API_KEY is better.
  async europeana(query) { return europeanaSearch(query, "IMAGE"); },
  async europeanaVideo(query) { return europeanaSearch(query, "VIDEO"); },
  // Art Institute of Chicago (no key): public-domain artworks, photographs and posters (IIIF images).
  async artic(query) {
    const q = new URLSearchParams({ q: query.slice(0, 100), limit: "20", fields: "id,title,artist_display,image_id,is_public_domain,thumbnail,date_display" });
    q.append("query[term][is_public_domain]", "true");
    const data = await getJson("artic", `https://api.artic.edu/api/v1/artworks/search?${q}`, { "AIC-User-Agent": "faceless-video-editor (open-access footage search)" });
    return (data.data ?? []).filter((a) => a.is_public_domain && a.image_id).map((a) => ({
      id: `artic-${a.id}`, source: "artic", kind: "image", url: `https://www.artic.edu/iiif/2/${a.image_id}/full/1686,/0/default.jpg`, ext: "jpg",
      thumb: `https://www.artic.edu/iiif/2/${a.image_id}/full/320,/0/default.jpg`, text: `${a.title ?? ""} ${a.artist_display ?? ""} ${a.date_display ?? ""} ${a.thumbnail?.alt_text ?? ""}`,
      w: a.thumbnail?.width ?? 0, h: a.thumbnail?.height ?? 0,
      credit: `"${a.title}" - ${(a.artist_display ?? "").split("\n")[0]}, Art Institute of Chicago, public domain (CC0) - https://www.artic.edu/artworks/${a.id}` }));
  },
  // Cleveland Museum of Art (no key): CC0 open-access artworks and photographs.
  async cleveland(query) {
    const q = new URLSearchParams({ q: query.slice(0, 100), cc0: "1", has_image: "1", limit: "20" });
    const data = await getJson("cleveland", `https://openaccess-api.clevelandart.org/api/artworks/?${q}`);
    return (data.data ?? []).map((a) => {
      const im = a.images?.print ?? a.images?.web;
      return im?.url && { id: `cleveland-${a.id}`, source: "cleveland", kind: "image", url: im.url, ext: "jpg", thumb: a.images?.web?.url,
        text: `${a.title ?? ""} ${a.type ?? ""} ${strip(a.description).slice(0, 200)} ${a.creation_date ?? ""}`, w: Number(im.width) || 0, h: Number(im.height) || 0,
        credit: `"${a.title}" - ${(a.creators ?? []).map((c) => c.description).join(", ") || "unknown"}, Cleveland Museum of Art, CC0 - ${a.url}` };
    }).filter(Boolean);
  },
  // NASA Scientific Visualization Studio (no key, public domain): HD/4K video of Earth, weather,
  // climate, the Sun, Moon, planets and missions. The movie file is chosen with the clip.
  async svs(query) {
    const q = new URLSearchParams({ search: query.slice(0, 100), limit: "20" });
    const data = await getJson("svs", `https://svs.gsfc.nasa.gov/api/search/?${q}`);
    return (data.results ?? []).filter((r) => r.id && /visualization|animation|produced|hyperwall/i.test(r.result_type ?? "")).map((r) => ({
      id: `svs-${r.id}`, source: "svs", kind: "video", url: null, svsId: r.id, ext: "mp4", w: 0, h: 0,
      thumb: `https://svs.gsfc.nasa.gov/vis/a000000/a${String(Math.floor(r.id / 100) * 100).padStart(6, "0")}/a${String(r.id).padStart(6, "0")}/thumbnail.jpg`,
      text: `${r.title ?? ""} ${strip(r.description).slice(0, 300)}`,
      credit: `NASA's Scientific Visualization Studio - "${r.title}" - https://svs.gsfc.nasa.gov/${r.id}/` }));
  },
  // Wellcome Collection (no key): CC BY / CC0 / public-domain photos and illustrations of medicine,
  // the body, disease, hospitals and the history of science (IIIF images).
  async wellcome(query) {
    const q = new URLSearchParams({ query: query.slice(0, 100), pageSize: "20", "locations.license": "cc-by,cc-0,pdm", include: "source.contributors" });
    const data = await getJson("wellcome", `https://api.wellcomecollection.org/catalogue/v2/images?${q}`);
    return (data.results ?? []).map((im) => {
      const loc = (im.locations ?? []).find((l) => /iiif-image/.test(l.locationType?.id ?? "")) ?? im.locations?.[0];
      const lic = loc?.license?.id ?? "";
      if (!loc?.url || !/^(cc-by|cc-0|pdm)$/.test(lic)) return null;
      const base = loc.url.replace(/\/info\.json$/, "");
      const ar = Number(im.aspectRatio) || 1.5;
      const who = (im.source?.contributors ?? []).map((c) => c.agent?.label).filter(Boolean).join(", ");
      return { id: `wellcome-${im.id}`, source: "wellcome", kind: "image", url: `${base}/full/!2400,2400/0/default.jpg`, ext: "jpg",
        thumb: `${base}/full/320,/0/default.jpg`, text: `${im.source?.title ?? ""} ${who}`,
        // IIIF serves up to 2400 px on the long side; the real size is checked by the quality gate after download.
        w: ar >= 1 ? 2400 : Math.round(2400 * ar), h: ar >= 1 ? Math.round(2400 / ar) : 2400,
        credit: `"${im.source?.title ?? "untitled"}"${who ? ` - ${who}` : ""}, Wellcome Collection, ${loc.license?.label ?? lic.toUpperCase()} - https://wellcomecollection.org/works/${im.source?.id}` };
    }).filter(Boolean);
  },
  // iNaturalist (no key): research-grade CC0 / CC BY / CC BY-SA photos of real animals and plants.
  // Only when the keyword names a species iNaturalist knows ("red fox", "bald eagle", "oak tree").
  async inat(query) {
    const words = query.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
    // The whole keyword, then its two-word pieces ("red fox in snow" -> "red fox"): at most 3 lookups.
    const content = words.filter((w) => !/^(the|and|with|from|into|over|under|near|in|on|at|of|for|its|their|close|up|shot|view|aerial|footage)$/.test(w));
    const tries = [...new Set([query.slice(0, 60), ...content.slice(0, 3).flatMap((w, i) => (content[i + 1] ? [`${w} ${content[i + 1]}`] : []))])].slice(0, 3);
    let taxon = null;
    for (const term of tries) {
      const t = await getJson("inat", `https://api.inaturalist.org/v1/taxa/autocomplete?${new URLSearchParams({ q: term, per_page: "5", is_active: "true" })}`);
      // The taxon's common (or Latin) name must be in the keyword, so "boardroom meeting" never turns into an insect.
      taxon = (t.results ?? []).find((x) => {
        const names = [x.preferred_common_name, x.english_common_name, x.name].filter(Boolean).map((n) => n.toLowerCase());
        return names.some((n) => { const nw = n.split(/[^a-z]+/).filter((w) => w.length > 2); return nw.length && nw.every((w) => words.includes(w)); });
      });
      if (taxon) break;
    }
    if (!taxon) return [];
    const q = new URLSearchParams({ taxon_id: String(taxon.id), photo_license: "cc0,cc-by,cc-by-sa", quality_grade: "research", photos: "true", order_by: "votes", per_page: "20" });
    const data = await getJson("inat", `https://api.inaturalist.org/v1/observations?${q}`);
    const name = taxon.preferred_common_name ?? taxon.name;
    return (data.results ?? []).flatMap((o) => (o.photos ?? []).slice(0, 1)).filter((p) => /^(cc0|cc-by|cc-by-sa)$/.test(p.license_code ?? "") && p.url).map((p) => ({
      id: `inat-${p.id}`, source: "inat", kind: "image", url: p.url.replace(/\/square\./, "/original."), ext: "jpg", thumb: p.url.replace(/\/square\./, "/small."),
      text: `${name} ${taxon.name} ${taxon.iconic_taxon_name ?? ""} wildlife nature`, w: p.original_dimensions?.width ?? 0, h: p.original_dimensions?.height ?? 0,
      credit: `${name} - ${p.attribution} via iNaturalist - https://www.inaturalist.org/photos/${p.id}` }));
  },
  // Flickr (free key FLICKR_API_KEY): CC BY, CC BY-SA, CC0, public domain, no known copyright, US government only.
  async flickr(query) {
    const q = new URLSearchParams({ method: "flickr.photos.search", api_key: KEYS.flickr, text: query.slice(0, 100), license: "4,5,7,8,9,10",
      sort: "relevance", content_type: "1", media: "photos", per_page: "25", extras: "url_l,url_k,url_o,o_dims,owner_name,license,tags,description", format: "json", nojsoncallback: "1" });
    const data = await getJson("flickr", `https://api.flickr.com/services/rest/?${q}`);
    const LIC = { 4: "CC BY 2.0", 5: "CC BY-SA 2.0", 7: "No known copyright restrictions", 8: "United States Government Work", 9: "CC0 1.0", 10: "Public Domain Mark" };
    return (data.photos?.photo ?? []).map((p) => {
      const url = p.url_k || p.url_o || p.url_l, w = Number(p.width_k || p.width_o || p.width_l), h = Number(p.height_k || p.height_o || p.height_l);
      return url && { id: `flickr-${p.id}`, source: "flickr", kind: "image", url, ext: "jpg", thumb: url.replace(/(_[a-z])?\.jpg$/, "_n.jpg"),
        text: `${p.title ?? ""} ${p.tags ?? ""} ${strip(p.description?._content).slice(0, 200)}`, w, h,
        credit: `"${p.title || "untitled"}" by ${p.ownername}, ${LIC[p.license]} - https://www.flickr.com/photos/${p.owner}/${p.id}` };
    }).filter(Boolean);
  },
  // YouTube Creative Commons, same rules as scripts/yt-engine.mjs: every video gets a license record
  // (build/yt/licenses.json); only CC BY videos that pass it AND have an authorized file (the maker's
  // file, an imported one, or a recorded authorization) become candidates. Good matches still missing
  // the file or a person's check are listed in build/yt/wanted.json.
  async youtube(query, minSec) {
    const cacheFile = path.join(BUILD, "search-cache", `yt-${Buffer.from(query).toString("base64url").slice(0, 140)}.json`);
    let ids = readJson(cacheFile, null);
    if (!ids) {
      if (exhausted.has("youtube")) throw new RateLimited("youtube");
      if (ytSearches >= ytBudget) { exhausted.add("youtube"); log("broll", `youtube: ${ytBudget} searches this run (youtubeMaxSearches), the rest without it`); throw new RateLimited("youtube"); }
      try { ids = await searchCC(query, { max: 10 }); ytSearches++; searches++; }
      catch (e) { if (e instanceof QuotaError) { exhausted.add("youtube"); log("broll", "youtube quota used up for today, using other sources"); throw new RateLimited("youtube"); } throw e; }
      writeJson(cacheFile, ids);
    }
    const vfile = path.join(YT, "videos.json"), videos = readJson(vfile, {});
    const missing = ids.filter((id) => !videos[id]);
    if (missing.length) { Object.assign(videos, await videoDetails(missing)); writeJson(vfile, videos); }
    const lic = loadLicenses();
    const out = [];
    for (const id of ids) {
      const v = videos[id];
      if (!v || v.duration < Math.min(3, minSec)) continue;
      if (NOT_REAL.test(`${v.title} ${v.tags.join(" ")}`) && !NOT_REAL.test(query)) continue; // a model / toy / game, not the thing
      lic[id] = licenseFor(v, lic[id]);
      const text = `${v.title} ${v.tags.join(" ")} ${v.description.slice(0, 300)}`;
      if (!usable(lic[id]) || !authorizedSource(id)) {
        if (lic[id].status !== "rejected" && relevance(query, text) >= MIN_REL) {
          noteWanted(v, usable(lic[id]) ? "no authorized file yet" : `license review: ${lic[id].flags.join("; ")}`, query); ytWanted.add(id);
        }
        continue;
      }
      const w = windowFor(v, [query], minSec + 4);
      out.push({ id: `youtube-${id}`, source: "youtube", kind: "video", url: null, ytId: id, startAt: w.start, ext: "mp4", thumb: v.thumb,
        text: `${text} ${w.chapter ?? ""}`, w: v.definition === "hd" ? 1920 : 640, h: v.definition === "hd" ? 1080 : 360, duration: v.duration,
        credit: lic[id].attribution });
    }
    saveLicenses(lic);
    return out;
  },
};

const OPEN_RIGHTS = /publicdomain|\/licenses\/by\/|\/licenses\/by-sa\/|rightsstatements\.org\/vocab\/NoC-US/i;
async function europeanaSearch(query, type) {
  const q = new URLSearchParams({ wskey: KEYS.europeana, query: query.slice(0, 200), reusability: "open", media: "true", rows: "20", qf: `TYPE:${type}`, profile: "rich" });
  const data = await getJson("europeana", `https://api.europeana.eu/record/v2/search.json?${q}`);
  return (data.items ?? []).map((i) => {
    const url = i.edmIsShownBy?.[0], rights = i.rights?.[0] ?? "";
    if (!url || !OPEN_RIGHTS.test(rights) || /-nc|-nd/i.test(rights)) return null;
    // Video must be a direct file, not a player page.
    if (type === "VIDEO" && !/\.(mp4|m4v|webm|ogv|mov)(\?|$)|openbeelden\.nl\/files\//i.test(url)) return null;
    const title = (i.title?.[0] ?? "untitled").slice(0, 120);
    return { id: `europeana-${String(i.id).replace(/[^\w]+/g, "_").slice(-60)}`, source: "europeana", kind: type === "VIDEO" ? "video" : "image", url,
      ext: type === "VIDEO" ? "mp4" : "jpg", transcode: type === "VIDEO", thumb: i.edmPreview?.[0],
      text: `${title} ${strip([].concat(i.dcDescription ?? []).join(" ")).slice(0, 250)} ${[].concat(i.edmConceptPrefLabelLangAware?.en ?? []).join(" ")}`, w: 0, h: 0,
      credit: `"${title}" - ${[].concat(i.dataProvider ?? i.provider ?? ["Europeana"])[0]} via Europeana - ${rights} - ${i.guid ?? ""}` };
  }).filter(Boolean);
}

// ---------- relevance ----------
// Stock search ranks loosely (Pixabay returns lipstick for "phone settings").
// Score each candidate by how many keyword words its tags / title / description
// contain, then orientation, motion and length, keeping each API's own order as
// the tie-break. Green-screen / mockup / template clips are never usable.
// Names something real and specific (a year, a proper noun after the first word):
// archive imagery is then likely more accurate than stock.
const factual = (q) => /\b(1[5-9]\d\d|20\d\d)\b/.test(q) || /\s[A-Z][a-z]/.test(q);

const GAME = /\b(trailer|gameplay|gamescom|video ?game|let's play|walkthrough|playstation|xbox|nintendo|steam edition)\b/i;
function rank(cands, query, minSec) {
  // Too small to fill the frame (known size, over 1.6x upscale) never makes the list.
  const upscale = (c) => (c.w && c.h && c.w > 50 ? Math.max(fmt.width / c.w, fmt.height / c.h) : 1);
  return cands
    .filter((c) => !used.has(c.id) && !BLOCK.test(c.text) && (project.qualityGate === false || upscale(c) <= 1.6))
    .map((c, i) => {
      const rel = relevance(query, c.text);
      const archive = ARCHIVE.has(c.source);
      const score = rel * 3 + (c.w && orientationOk(c.w, c.h) ? 1 : 0) + (c.kind === "video" ? 0.6 : 0) +
        ((c.duration ?? minSec) >= minSec ? 0.4 : 0) + (c.duration > 600 ? -0.7 : 0) /* a 10+ min "video" is a show or lecture: talking heads, logos */ + (GAME.test(c.text) && !GAME.test(query) ? -1.5 : 0) /* game trailers / gameplay only for gaming topics */ + (archive ? (factual(query) ? 0.8 : -0.4) : 0) - (c.ri ?? i) * 0.01;
      return { ...c, rel, score: score - (upscale(c) > 1.15 ? 0.5 : 0) };
    })
    .sort((a, b) => b.score - a.score);
}

// All candidates for a keyword from every source, best first (with
// brollSearchAll: false it stops once there are enough relevant ones).
async function candidatesFor(keyword, minSec, want = 6) {
  const mode = keyword.match(/^(photo|archive|yt):/)?.[1] ?? "auto";
  // "-word" exclusions are for the rules (match-rules.mjs), not for the search engines.
  const query = visualQuery(keyword).query;
  // Wrong generation / era, a toy or game, an excluded word: dropped before anything is downloaded.
  const fits = (list) => list.filter((c) => !mismatch(keyword, c.text));
  // "yt:" = YouTube Creative Commons only.
  if (mode === "yt") {
    if (!ytOn) log("broll", `"${keyword}": yt: needs YOUTUBE_API_KEY (or node scripts/youtube.mjs --auth)`);
    let pool = [];
    try { if (ytOn) pool = await SOURCES.youtube(query, minSec); } catch (e) { if (!(e instanceof RateLimited)) log("broll", `youtube search failed (${e.message})`); }
    return fits(rank(pool, query, minSec));
  }
  // YouTube CC (license-checked, authorized files only): for archive: keywords and lines naming something real.
  const yt = ytOn && mode !== "photo" && (mode === "archive" || factual(query)) ? ["youtube"] : [];
  // DVIDS is military / government video: only for archive: keywords and lines that
  // name something real, never for a photo: shot or a generic "office desk".
  // DVIDS is US military video: only when the line is about the military, war, disasters, aircraft or ships -
  // otherwise its loose search wins with unrelated clips ("Roman empire" -> a tank exercise).
  const MIL = /\b(army|navy|air ?force|marine|military|soldier|troop|war|battle|missile|tank|jet|aircraft|airplane|plane|helicopter|ship|carrier|submarine|navy|rescue|disaster|hurricane|flood|earthquake|wildfire|evacuat|pentagon|nato|drone|parachute|veteran|combat|bomb|nuclear|rocket|launch)/i;
  const dvids = KEYS.dvids && mode !== "photo" && (mode === "archive" || factual(query)) && MIL.test(query) ? ["dvids"] : [];
  // Real footage first (video beats a still), then real photos. archiveOrg only for
  // lines that name something real: its films are old and rarely fit a generic line.
  // Subject-gated free sources: searched only when the line is about what they hold.
  const SCI = /\b(earth|planet|climate|weather|hurricane|typhoon|cyclone|storm|tornado|drought|flood|wildfire|aerosol|ozone|atmosphere|ocean|sea (ice|level)|glacier|ice ?sheet|arctic|antarctic|greenland|carbon|co2|emission|heat ?wave|el ni|sun|solar|moon|lunar|mars|jupiter|saturn|venus|asteroid|comet|meteor|galaxy|nebula|black hole|universe|eclipse|aurora|satellite|orbit|nasa|telescope|hubble|webb|space|cosmic)/i;
  const MED = /\b(medic|doctor|surgeon|surgery|hospital|nurse|patient|disease|illness|virus|bacteri|plague|pandemic|epidemic|vaccin|anatom|skeleton|skull|heart|brain|lung|blood|dna|gene|drug|pharma|pill|cancer|tumou?r|health|clinic|asylum|psychiat|leprosy|cholera|smallpox|tuberculosis|malaria|apothecary|microscope)/i;
  const svs = mode !== "photo" && SCI.test(query) ? ["svs"] : [];
  const wellcome = mode === "archive" || MED.test(query) ? ["wellcome"] : [];
  const freeVideo = mode === "photo" ? [] : ["wikimediaVideo", "nasaVideo", ...svs, ...(mode === "archive" || factual(query) ? ["archiveOrg", "europeanaVideo"] : [])];
  const archive = archiveOn ? [...dvids, ...yt, ...freeVideo, "wikimedia", "nasa", "openverse", ...(KEYS.flickr ? ["flickr"] : []), "europeana", "smithsonian", ...wellcome, "artic", "cleveland"] : [];
  const photos = [...(KEYS.pexels ? ["pexelsPhoto"] : []), ...(KEYS.pixabay ? ["pixabayPhoto"] : []), ...(KEYS.unsplash ? ["unsplash"] : []), ...(archiveOn ? ["inat"] : [])];
  const order =
    mode === "archive" ? archive :
    mode === "photo" ? (factual(query) ? [...archive, ...photos] : [...photos, ...archive]) :
    factual(query) ? [...stockSources, ...archive, ...photos] : [...stockSources, ...photos, ...archive];
  let pool = [];
  for (const src of order.filter((s) => (unreachable.get(s) ?? 0) < 2)) {
    try {
      // ri: the result's rank inside its own source, so no source wins just by being searched first.
      pool = pool.concat((await SOURCES[src](query, minSec)).map((c, ri) => ({ ...c, ri })));
    } catch (e) {
      if (!(e instanceof RateLimited)) log("broll", `${src} search failed (${e.message}), trying next source`);
      // A site that can't be reached (timeout, DNS) twice is skipped for the rest of the run, so it can't slow every shot.
      if (/fetch failed|timeout|aborted|ENOTFOUND|ECONNRE/i.test(`${e.name} ${e.message} ${e.cause?.code ?? ""}`)) {
        unreachable.set(src, (unreachable.get(src) ?? 0) + 1);
        if (unreachable.get(src) === 2) log("broll", `${src} is unreachable right now - skipped for the rest of this run`);
      }
    }
    if (!searchAll && rank(pool, query, minSec).filter((c) => c.rel >= 0.5).length >= want) break;
  }
  return fits(rank(pool, query, minSec));
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
  // Wikimedia's file servers answer 429 when many files are fetched at once:
  // wait (Retry-After, else 20-40s) and try again rather than losing the shot.
  let res;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(url, { headers: UA });
    if (res.status !== 429 || attempt >= 3) break;
    const wait = (Number(res.headers.get("retry-after")) || 20 * (attempt + 1)) * 1000;
    log("broll", `${new URL(url).host} busy (429), retrying in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
  if (!res.ok && fallbackUrl) res = await fetch(fallbackUrl, { headers: UA });
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + ".part", Buffer.from(await res.arrayBuffer()));
  fs.renameSync(dest + ".part", dest);
}

// DVIDS search results carry no file links: the asset call lists the MP4 renditions.
async function resolveUrl(hit) {
  if (hit.url) return hit.url;
  if (hit.nasaId) {
    // NASA lists every rendition: the original MP4 if there is one, else the large one.
    const data = await getJson("nasa", `https://images-api.nasa.gov/asset/${encodeURIComponent(hit.nasaId)}`);
    const files = (data.collection?.items ?? []).map((i) => i.href).filter((h) => /\.mp4$/i.test(h));
    const f = files.find((h) => /~orig\.mp4$/i.test(h)) ?? files.find((h) => /~large\.mp4$/i.test(h)) ?? files[0];
    if (!f) throw new Error("NASA video has no MP4 file");
    return f.replace(/^http:/, "https:");
  }
  if (hit.svsId) {
    // SVS lists every rendition: the smallest MP4 that fills 1080p, preferring ones without burnt-in dates, labels or captions.
    const data = await getJson("svs", `https://svs.gsfc.nasa.gov/api/${hit.svsId}`);
    const movies = (data.media_groups ?? []).flatMap((g) => g.items ?? []).map((i) => i.instance ?? i)
      .filter((m) => /movie|video/i.test(m.media_type ?? "") && /\.mp4$/i.test(m.url ?? "") && Number(m.width) >= 1280);
    const clean = (m) => (/date|label|overlay|caption|text|title|slate|credit|_print/i.test(m.url.split("/").pop()) ? 1 : 0);
    const f = movies.sort((a, b) => clean(a) - clean(b) || Number(a.width) - Number(b.width)).find((m) => Number(m.width) >= 1920) ?? movies[0];
    if (!f) throw new Error("SVS item has no HD MP4 movie");
    return f.url.replace(/^http:/, "https:");
  }
  if (hit.iaId) {
    // Internet Archive: the smallest H.264/MPEG4 file that is at least 720p (old SD films can't fill 1080p).
    const data = await getJson("archiveorg", `https://archive.org/metadata/${encodeURIComponent(hit.iaId)}`);
    const vids = (data.files ?? []).filter((f) => /h\.264|mpeg4|matroska|webm/i.test(f.format ?? "") && Number(f.size) < 900e6);
    const hd = vids.filter((f) => Number(f.height) >= 700).sort((a, b) => Number(a.size) - Number(b.size));
    const f = hd[0];
    if (!f) throw new Error("Internet Archive item has no HD video file");
    return `https://archive.org/download/${encodeURIComponent(hit.iaId)}/${encodeURIComponent(f.name)}`;
  }
  if (hit.source !== "dvids") return hit.url;
  if (!KEYS.dvids) throw new Error("DVIDS_API_KEY is not set");
  const q = new URLSearchParams({ api_key: KEYS.dvids, id: hit.dvidsId });
  const data = await getJson("dvids", `https://api.dvidshub.net/asset?${q}`);
  const f = pickRendition((data.results?.files ?? []).filter((x) => x.type === "video/mp4" && x.src));
  if (!f) throw new Error("DVIDS asset has no MP4 file");
  return f.src;
}

async function fetchOnce({ shot, hit, shotSec }) {
  const abs = path.join(PUBLIC, shot.src);
  // A trimmed copy is named by the length it keeps; reuse it if it is long enough.
  // Room to spare: build-timeline may skip past a cut inside the clip.
  const keep = Math.ceil(shotSec + 4);
  const trimmed = abs.replace(/\.mp4$/, `.t${keep}.mp4`);
  if (shot.type === "video" && fs.existsSync(trimmed)) {
    shot.src = path.relative(PUBLIC, trimmed);
    shot.duration = probeDuration(trimmed);
    return;
  }
  // YouTube CC: cut the stretch the match found straight from the authorized file (build/yt/raw/),
  // silent (a CC video's soundtrack may be someone else's music) and re-encoded so the cut is exact.
  if (hit.source === "youtube") {
    const raw = await fetchRaw(hit.ytId);
    const dur = probeDuration(raw) ?? hit.duration ?? 0;
    // A chapter gave hit.startAt; CLIP over the whole video finds the stretch that shows it, if it's sure.
    const bm = visionOn ? await bestMoment(raw, shot.query ?? shot.keyword, keep, { duration: dur }) : null;
    const start = Math.max(0, Math.min(bm && bm.score >= 0.4 ? bm.start : hit.startAt ?? 0, dur - keep));
    fs.mkdirSync(path.dirname(trimmed), { recursive: true });
    const r = ffmpeg(["-ss", start.toFixed(2), "-i", raw, "-t", String(keep), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", trimmed]);
    if (r.status !== 0 || !fs.existsSync(trimmed)) throw new Error(`could not cut ${hit.ytId}`);
    shot.src = path.relative(PUBLIC, trimmed);
    shot.duration = probeDuration(trimmed);
    return;
  }
  if (!fs.existsSync(abs)) {
    if (hit.transcode) {
      // WebM / Ogg / archive files: H.264 so trimming, color match and the renderer all handle them.
      const src = abs + ".src";
      await download(await resolveUrl(hit), src, hit.fallbackUrl);
      const r = ffmpeg(["-i", src, "-t", "120", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-movflags", "+faststart", abs]);
      fs.rmSync(src, { force: true });
      if (r.status !== 0 || !fs.existsSync(abs)) throw new Error("could not convert the clip to H.264");
    } else await download(await resolveUrl(hit), abs, hit.fallbackUrl);
    if (hit.ping && hit.source === "coverr" && KEYS.coverr) {
      await fetch(hit.ping, { method: "PATCH", headers: { ...UA, Authorization: `Bearer ${KEYS.coverr}` } })
        .catch((e) => log("broll", `coverr download report failed (${e.message})`));
    }
    if (hit.ping && hit.pingAuth) {
      await fetch(hit.ping, { headers: { ...UA, Authorization: hit.pingAuth } }).catch((e) => log("broll", `${hit.source} download report failed (${e.message})`));
    }
  }
  if (shot.type !== "video") return;
  shot.duration = probeDuration(abs);
  // Stock clips are often 10-60s; a 40 minute video would keep gigabytes it never shows.
  if (trim && shot.duration && shot.duration > keep + 3) {
    let offset = Math.min((shot.duration - keep) * 0.35, 4);
    // The stretch that shows the keyword best (CLIP over the whole clip), not a fixed spot.
    const bm = visionOn ? await bestMoment(abs, shot.query ?? shot.keyword, keep, { duration: shot.duration }) : null;
    if (bm && bm.score >= 0.3) offset = Math.min(bm.start, shot.duration - keep);
    const r = ffmpeg(["-ss", offset.toFixed(2), "-i", abs, "-t", String(keep), "-an", "-c:v", "copy", "-movflags", "+faststart", trimmed]);
    if (r.status === 0 && fs.existsSync(trimmed)) {
      if (!hit.local) fs.rmSync(abs); // a licensed original stays: re-downloading needs the connector
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
  return qualityProblem(file, duration, times);
}

// Quality gate: footage that would look cheap in a 1080p edit. Too small to fill
// the frame without visible upscaling, starved of bitrate (blocky), or out of
// focus in every sampled frame (sharpness = variance of a Laplacian on a 320px
// gray frame; deliberately soft portraits score ~150, unusable blur under 40).
function qualityProblem(file, duration, times) {
  if (project.qualityGate === false) return null;
  const size = probeSize(file);
  if (size && Math.max(fmt.width / size[0], fmt.height / size[1]) > 1.6) return `low resolution (${size[0]}x${size[1]})`;
  if (duration && size) {
    const bpp = (fs.statSync(file).size * 8) / (duration * size[0] * size[1] * 30);
    if (bpp < 0.012) return "heavily compressed";
  }
  let sharpest = 0;
  for (const t of times) {
    const buf = ffmpegRaw([...(duration ? ["-ss", t.toFixed(2)] : []), "-i", file, "-frames:v", "1", "-vf", "scale=320:-2,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    if (!buf?.length) continue;
    const w = 320, h = Math.floor(buf.length / w);
    let sum = 0, sum2 = 0, k = 0;
    for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
      const v = 4 * buf[y * w + x] - buf[y * w + x - 1] - buf[y * w + x + 1] - buf[(y - 1) * w + x] - buf[(y + 1) * w + x];
      sum += v; sum2 += v * v; k++;
    }
    if (k) sharpest = Math.max(sharpest, sum2 / k - (sum / k) ** 2);
  }
  if (sharpest && sharpest < 40) return "out of focus";
  return motionProblem(file, duration);
}

// Footage that plays choppy - a client flagged it as "glitchy": stop-motion
// (a page-flip clip: runs of FROZEN frames, then a jump every second) and stutter (frozen
// frames in the middle of motion). Measured as the mean pixel change between frames on a
// 160x90 gray copy, over two 3 s samples. A truly repeated frame changes by ~0; a still or
// very slow shot still changes by 0.02+ (sensor noise), so slow, smooth footage passes.
function motionProblem(file, duration) {
  if (!duration || project.motionGate === false) return null;
  for (const at of [0.3, 0.65]) {
    const ss = Math.max(0, Math.min(duration * at, duration - 3.2));
    const buf = ffmpegRaw(["-ss", ss.toFixed(2), "-t", "3", "-i", file, "-an", "-vf", "scale=160:90,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
    const n = 160 * 90, frames = buf ? Math.floor(buf.length / n) : 0;
    if (frames < 20) continue;
    const d = [];
    for (let i = 1; i < frames; i++) { let s = 0; for (let k = 0; k < n; k++) s += Math.abs(buf[i * n + k] - buf[(i - 1) * n + k]); d.push(s / n); }
    const moving = d.filter((x) => x > 0.3).length;
    if (moving < d.length * 0.2) continue; // a still / locked-off shot: nothing to stutter
    // Frozen frames sitting between moving ones (stutter), or long frozen runs (stop-motion).
    const frozen = d.filter((x) => x <= 0.012).length;
    const sorted = [...d].sort((a, b) => a - b), median = sorted[Math.floor(d.length / 2)];
    const jumps = d.filter((x) => x > 15 && x > median * 8).length; // hard page-flips / cuts every second
    if (frozen >= d.length * 0.15) return `choppy (${Math.round((frozen / d.length) * 100)}% frozen frames in a moving shot - stop-motion or stutter)`;
    if (jumps >= 2) return `choppy (${jumps} hard jumps in 3 s - stop-motion or a flashing edit)`;
  }
  return null;
}

// Stock clips are often edits of several shots. Times (s) where the picture
// changes completely, so build-timeline can play a stretch without one.
// A cut is a one-frame spike in the scene-change score; camera moves and fast
// action raise it over several frames, so compare each frame with its neighbours.
function detectCuts(file) {
  const r = ffmpeg(["-i", file, "-an", "-vf", "scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score", "-f", "null", "-"], { capture: true });
  const frames = [];
  let t = null;
  for (const line of (r.stderr || "").split("\n")) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) t = parseFloat(pts[1]);
    const sc = /scene_score=([\d.]+)/.exec(line);
    if (sc && t !== null) frames.push([t, parseFloat(sc[1])]);
  }
  return frames.filter(([, s], i) => {
    const near = Math.max(0, ...[-2, -1, 1, 2].map((d) => frames[i + d]?.[1] ?? 0));
    return s >= 0.4 || (s >= 0.15 && s > near * 3 + 0.02);
  }).map(([at]) => Math.round(at * 100) / 100);
}

// keyword: what the script asked for (keeps a clip across runs); query: what found it.
const shotFromHit = (hit, kw, query = kw) => ({ type: hit.kind, src: `broll/${hit.id.replace(/[^\w.-]+/g, "_")}.${hit.ext}`, duration: null,
  assetId: hit.id, keyword: kw, ...(query !== kw ? { query } : {}), rel: Math.round((hit.rel ?? 0) * 100) / 100, credit: hit.credit });

// Best candidate that actually matches: the shot's keyword first, then the beat's
// other keywords. null = nothing relevant (better a kinetic shot than a random clip).
// Words chose the candidates; the picture decides between them. Thumbnails (cached in build/vision-thumbs/)
// are scored with CLIP: one that clearly shows something else (a meme, a toy, a title card) is skipped.
async function visualPick(cands, q) {
  if (!cands.length || !visionOn) return cands[0] ?? null;
  const dir = path.join(BUILD, "vision-thumbs");
  const files = [];
  for (const c of cands) {
    const f = path.join(dir, `${c.id.replace(/[^\w.-]+/g, "_").slice(0, 80)}.img`);
    if (!fs.existsSync(f) && c.thumb) await download(c.thumb, f).catch(() => {});
    files.push(fs.existsSync(f) ? f : null);
  }
  const sc = await scoreImages(files.filter(Boolean), q);
  if (!sc) return cands[0];
  let k = 0;
  const scored = cands.map((c, i) => ({ c, v: files[i] ? sc[k++]?.match ?? null : null }));
  // Only a thumbnail that clearly shows something else drops a candidate; YouTube thumbnails are often
  // clickbait (faces, big text), so there it only ranks - the downloaded frames are checked anyway.
  const ok = scored.filter((x) => x.v == null || x.v >= 0.1 || x.c.source === "youtube");
  ok.sort((a, b) => (b.c.rel + 1.5 * (b.v ?? 0.5)) - (a.c.rel + 1.5 * (a.v ?? 0.5)));
  return ok[0]?.c ?? null;
}

async function bestFor(shot, shotSec, alts) {
  for (const q of [shot, ...alts.filter((a) => a !== shot)]) {
    if (!q || /^(file|ai|adobe):/.test(q)) continue;
    const cands = (await candidatesFor(q, shotSec)).filter((c) => c.rel >= MIN_REL).slice(0, 6);
    const hit = await visualPick(cands, q);
    if (hit) return { hit, query: q };
  }
  return null;
}

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
    let problem = frameProblem(file, job.shot.type === "video" ? job.shot.duration : null);
    // Does it show the thing? (CLIP on 3 frames). Review picks were chosen by eye: never second-guessed.
    if (!problem && visionOn && !job.picked) {
      const v = await checkMedia(file, job.query ?? job.kw, { video: job.shot.type === "video", duration: job.shot.duration });
      if (v) {
        job.shot.vision = v.score;
        if (v.score < VMIN) problem = `not showing "${visualQuery(job.query ?? job.kw).query}" (vision ${v.score}${v.junk ? `, looks like ${v.junk}` : ""})`;
      }
    }
    if (!problem) {
      log("broll", `${job.label} -> ${job.shot.src}${job.picked ? " (picked)" : ""}`);
      return;
    }
    fs.rmSync(file, { force: true });
    const next = await bestFor(job.query ?? job.kw, job.shotSec, job.alts ?? []);
    log("broll", `${job.label}: ${path.basename(job.shot.src)} is ${problem}, ${next ? "trying the next result" : "no more relevant results"}`);
    if (!next) break;
    used.add(next.hit.id);
    job.hit = next.hit;
    job.query = next.query;
    Object.assign(job.shot, shotFromHit(next.hit, job.kw, next.query));
  }
  throw new Error("no usable clip");
}

// ---------- graphics ----------
// Map places: names are geocoded once (Nominatim allows 1 request/second) and
// cached; give { "name", "lat", "lon" } to skip it. The log prints what each
// name resolved to: check it ("Paris" could be Paris, Texas).
const geocodeFile = path.join(BUILD, "geocode.json");
const geocoded = readJson(geocodeFile, {});
async function geocode(name) {
  if (geocoded[name]) return geocoded[name];
  const q = new URLSearchParams({ q: name, format: "json", limit: "1", "accept-language": "en" });
  let res;
  try {
    res = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: UA });
  } catch (e) {
    fail(`map place "${name}": geocoding failed (${e.message}). Give it as { "name": "${name}", "lat": ..., "lon": ... }`);
  }
  if (!res.ok) fail(`map place "${name}": geocoder answered ${res.status}. Give it as { "name": "${name}", "lat": ..., "lon": ... }`);
  const [hit] = await res.json();
  if (!hit) fail(`map place "${name}": not found. Use a fuller name ("Sylhet, Bangladesh") or give lat/lon.`);
  geocoded[name] = { lat: Number(hit.lat), lon: Number(hit.lon), found: hit.display_name };
  writeJson(geocodeFile, geocoded);
  log("broll", `map: "${name}" -> ${hit.display_name} (${Number(hit.lat).toFixed(2)}, ${Number(hit.lon).toFixed(2)})`);
  await sleep(1100);
  return geocoded[name];
}
let geoNames = null;
const countryNames = () => {
  if (geoNames) return geoNames;
  const src = path.join(ROOT, "node_modules", "world-atlas", "countries-50m.json");
  if (!fs.existsSync(src)) fail("Map graphics need the world-atlas package: run npm install");
  const dest = path.join(PUBLIC, "geo", "countries-50m.json");
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  return (geoNames = JSON.parse(fs.readFileSync(src, "utf8")).objects.countries.geometries.map((g) => g.properties.name));
};
// The 3D globe needs NASA Blue Marble / Black Marble / cloud textures in public/earth/.
// They ship with the three-globe package (public domain NASA imagery).
function earthTextures() {
  const dest = path.join(PUBLIC, "earth");
  const files = ["earth-blue-marble.jpg", "earth-night.jpg", "earth-water.png", "earth-topology.png", "night-sky.png"];
  if (files.every((f) => fs.existsSync(path.join(dest, f))) && fs.existsSync(path.join(dest, "clouds.png"))) return;
  const src = path.join(ROOT, "node_modules", "three-globe", "example");
  if (!fs.existsSync(src)) fail("The 3D globe needs its textures: run npm install (package three-globe)");
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(src, "img", f), path.join(dest, f));
  fs.copyFileSync(path.join(src, "clouds", "clouds.png"), path.join(dest, "clouds.png"));
}
async function resolveGraphic(g, label) {
  if (g.type === "globe" && g.look !== "vector") earthTextures();
  if (!GRAPHIC_TYPES.includes(g.type)) fail(`${label}: graphic type "${g.type}" - use ${GRAPHIC_TYPES.join(", ")}`);
  if (g.type !== "map" && g.type !== "globe") return g;
  const names = countryNames();
  for (const c of g.countries ?? []) {
    if (!names.some((n) => n.toLowerCase() === c.toLowerCase())) {
      const near = names.filter((n) => n.toLowerCase().includes(c.toLowerCase().slice(0, 4))).slice(0, 4);
      fail(`${label}: no country called "${c}" on the map${near.length ? ` - did you mean ${near.map((n) => `"${n}"`).join(", ")}?` : ""}`);
    }
  }
  const places = [];
  for (const p of g.places ?? []) {
    const name = typeof p === "string" ? p : p.name;
    const at = typeof p === "object" && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : await geocode(name);
    places.push({ name: name.split(",")[0], lat: at.lat, lon: at.lon, ...(p.label ? { label: p.label } : {}) });
  }
  if (!places.length && !(g.countries ?? []).length) fail(`${label}: a map needs "places" or "countries"`);
  if (g.type === "globe" && !places.length) fail(`${label}: a globe needs at least one place in "places"`);
  return { ...g, places };
}

// ---------- test a query across every source ----------
//   node scripts/fetch-broll.mjs --search="Apollo 11 launch"          (also photo:/archive: prefixes)
// Prints the ranked candidates with source, kind, size and match - nothing is downloaded.
const searchArg = args.find((a) => a.startsWith("--search="))?.slice(9);
if (searchArg) {
  const list = await candidatesFor(searchArg, 3, 12);
  const by = {};
  for (const c of list) by[c.source] = (by[c.source] ?? 0) + 1;
  console.log(`"${searchArg}": ${list.length} usable candidates  (${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`);
  for (const c of list.slice(0, 15)) console.log(`  ${c.score.toFixed(2)}  ${c.source.padEnd(10)} ${c.kind.padEnd(5)} ${c.w ? `${c.w}x${c.h}` : "?"}`.padEnd(42) + `rel ${c.rel.toFixed(2)}  ${(c.text ?? "").replace(/\s+/g, " ").slice(0, 70)}`);
  process.exit(0);
}

// ---------- 1. plan ----------
// Shots: lib.mjs planShots - one per beat, starting on the beat's words, more
// for long beats (split layout: always 2). A shot keeps the clip it got last run
// (same keyword, file on disk), so re-runs only fill gaps. Review picks override everything.
const previous = readJson(path.join(BUILD, "broll.json"), {});
const picks = readJson(path.join(BUILD, "picks.json"), {});
const review = readJson(path.join(BUILD, "review.json"), {});
const keepPrev = (id, k, kw) => {
  const p = previous[id]?.[k]?.bgShot ?? previous[id]?.[k];
  return p?.assetId && p.src && p.keyword === kw && fs.existsSync(path.join(PUBLIC, p.src)) ? p : null;
};

const shotsOf = (scene, i) => {
  const id = sceneId(i);
  const vo = readJson(path.join(BUILD, "vo", `${id}.json`), null);
  if (!vo) throw new Error(`Missing build/vo/${id}.json - run the voiceover step first.`);
  const { shots, notes } = planShots(scene, vo, project.maxShotSeconds);
  for (const n of notes) log("broll", `${id}: ${n}`);
  return { id, shots: shots.map((sh) => ({ ...sh, sec: (sh.endMs - sh.startMs) / 1000 })) };
};

// ---------- review mode: contact sheets of candidates ----------
if (reviewArg) {
  const dir = path.join(BUILD, "review");
  const keep = chapterArg || shotArg;
  const out = keep ? readJson(path.join(BUILD, "review.json"), {}) : {};
  if (!keep) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let sheets = 0;
  for (const [i, scene] of project.scenes.entries()) {
    if (chapterArg && scene.chapter !== chapterArg - 1) continue;
    if (shotArg && !shotArg.startsWith(`${sceneId(i)}-`)) continue;
    const { id, shots } = shotsOf(scene, i);
    const important = i === 0 || scene.emphasis || [].concat(scene.fx ?? []).includes("reveal") || scene.layout === "split";
    for (const [k, sh] of shots.entries()) {
      const kw = sh.kw;
      if (!kw || scene.visual === "kinetic" || /^(file|ai):/.test(kw)) continue;
      const key = `${id}-${k + 1}`;
      if (shotArg && key !== shotArg) continue;
      // The sheet shows the best 6, at most 3 from one source, so every library gets a say.
      const all = await candidatesFor(kw, sh.sec);
      const perSource = {};
      const cands = all.filter((c) => (perSource[c.source] = (perSource[c.source] ?? 0) + 1) <= 3).slice(0, 6);
      if (cands.length < 6) cands.push(...all.filter((c) => !cands.includes(c)).slice(0, 6 - cands.length));
      if (!cands.length) continue;
      // Default: review the hook, emphasis/reveal/split scenes and weak matches only.
      if (!shotArg && !reviewAll && !important && cands[0].rel >= 0.67) continue;
      // Normalize every thumbnail to the same 320x320 tile, then lay them out 3x2.
      for (const [n, c] of cands.entries()) {
        const raw = path.join(dir, `${key}-raw${n + 1}`), tile = path.join(dir, `${key}-t${n + 1}.jpg`);
        try {
          await download(c.thumb.replace("/320px-", "/330px-"), raw);
          // One pixel format for every tile: a 4:4:4 JPEG in a 4:2:0 sequence stops the tiler.
          ffmpeg(["-i", raw, "-frames:v", "1", "-vf", "scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=white,format=yuvj420p", tile]);
        } catch {}
        if (!fs.existsSync(tile)) ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=320x320", "-frames:v", "1", "-vf", "format=yuvj420p", tile]);
        fs.rmSync(raw, { force: true });
      }
      ffmpeg(["-framerate", "1", "-start_number", "1", "-i", path.join(dir, `${key}-t%d.jpg`), "-vf", "tile=3x2:padding=8:color=white", "-frames:v", "1", path.join(dir, `${key}.jpg`)]);
      for (let n = 1; n <= cands.length; n++) fs.rmSync(path.join(dir, `${key}-t${n}.jpg`), { force: true });
      // words: exactly what the voice says while this shot is on screen - pick for THAT.
      out[key] = { scene: id, keyword: kw, words: sh.words, seconds: Math.round(sh.sec * 10) / 10, line: scene.text, sheet: `build/review/${key}.jpg`,
        candidates: cands.map((c, n) => ({ n: n + 1, id: c.id, source: c.source, kind: c.kind, rel: Math.round(c.rel * 100) / 100, text: c.text.slice(0, 140), hit: c })) };
      sheets++;
    }
  }
  writeJson(path.join(BUILD, "review.json"), out);
  log("broll", `review: ${sheets} sheets in build/review/${chapterArg ? ` for chapter ${chapterArg}` : ""} (candidates 1-6, left to right, top to bottom).`);
  log("broll", 'Pick for the WORDS of each shot (build/review.json "words"). Write choices to build/picks.json, e.g. {"s001-1": 3}; change the keyword instead if none fits. Then run without --review.');
  process.exit(0);
}

// Review picks: reserve every picked clip first (the first shot to pick a clip
// gets it), and release clips that picks are replacing, so a clip can move from
// one shot to another. Everything else already on screen stays reserved.
const pickFor = (key, kw) => {
  const rv = review[key], n = picks[key];
  if (n == null || rv?.keyword !== kw) return null;
  if (/^adobe:/.test(String(n))) {
    const hit = adobeAsset(n);
    if (!hit) fail(`${key}: pick ${n} is not added yet - license it with the Adobe connector, then: node scripts/adobe-stock.mjs add ${String(n).slice(6)} <url>`);
    return hit;
  }
  return rv.candidates.find((c) => c.n === Number(n) || c.id === n)?.hit ?? null;
};
const pickedBy = new Map();
const replaced = new Set();
for (const [i, scene] of project.scenes.entries()) {
  const { id, shots } = shotsOf(scene, i);
  for (const [k, sh] of shots.entries()) {
    const kw = sh.kw;
    const hit = kw && pickFor(`${id}-${k + 1}`, kw);
    if (!hit) continue;
    if (!pickedBy.has(hit.id)) pickedBy.set(hit.id, `${id}-${k + 1}`);
    if (previous[id]?.[k]?.assetId && previous[id][k].assetId !== hit.id) replaced.add(previous[id][k].assetId);
  }
}
for (const p of Object.values(previous).flat()) if (p.assetId && !replaced.has(p.assetId)) used.add(p.assetId);
// A graphic beat with "kw" plays that footage behind the graphic (dimmed), so a fact
// or number never sits on an empty background. Filled in after the downloads.
const backdrops = [];
for (const pid of pickedBy.keys()) used.add(pid);

const plan = {};
const jobs = [];
for (const [i, scene] of project.scenes.entries()) {
  const { id, shots } = shotsOf(scene, i);
  plan[id] = [];
  status({ progress: (i / project.scenes.length) * 0.5, doing: `Searching footage: scene ${i + 1} of ${project.scenes.length}` });
  for (const [k, sh] of shots.entries()) {
    const kw = sh.kw;
    const shotSec = sh.sec;
    const label = `${id} shot ${k + 1} "${kw}"`;
    if (sh.graphic && scene.visual !== "kinetic") {
      const gshot = { type: "graphic", graphic: await resolveGraphic(sh.graphic, `${id} shot ${k + 1}`), ...(sh.credit ? { credit: sh.credit } : {}) };
      if (!kw || gshot.graphic.bg) { plan[id].push(gshot); continue; }
      backdrops.push({ id, idx: plan[id].length, gshot, sec: shotSec }); // the footage shot planned next goes behind it
    }
    if (kw?.startsWith("adobe:")) {
      const hit = adobeAsset(kw);
      if (!hit) fail(`${label}: not added yet - license it with the Adobe connector, then: node scripts/adobe-stock.mjs add ${kw.slice(6)} <url>`);
      const shot = { ...shotFromHit(hit, kw), picked: true };
      plan[id].push(shot);
      jobs.push({ shot, hit, kw, shotSec, label, picked: true });
      continue;
    }
    if (scene.visual === "kinetic" || !kw) {
      plan[id].push({ type: "kinetic" });
      continue;
    }
    if (kw.startsWith("file:")) {
      const ref = parseFileRef(kw.slice(5));
      let src = ref.file;
      const abs = path.join(PUBLIC, src);
      if (!fs.existsSync(abs)) throw new Error(`${id}: ${src} not found in public/`);
      const isVideo = VIDEO_EXT.test(src);
      if (ref.from !== null) {
        // Cut the part once (re-encoded, so it starts exactly there); the edit then treats it like any clip.
        const total = probeDuration(abs);
        if (!isVideo || ref.to <= ref.from || (total && ref.to > total + 0.05)) fail(`${label}: range ${ref.from}-${ref.to}s doesn't fit ${src}${total ? ` (${total.toFixed(1)}s long)` : ""}`);
        const cut = `broll/clip-${path.basename(src).replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_")}-${ref.from}-${ref.to}.mp4`;
        if (!fs.existsSync(path.join(PUBLIC, cut))) {
          fs.mkdirSync(path.join(PUBLIC, "broll"), { recursive: true });
          const r = ffmpeg(["-ss", String(ref.from), "-i", abs, "-t", String(ref.to - ref.from), "-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", path.join(PUBLIC, cut)]);
          if (r.status !== 0) fail(`${label}: could not cut ${src}`);
        }
        src = cut;
      }
      plan[id].push({ type: isVideo ? "video" : "image", src, duration: isVideo ? probeDuration(path.join(PUBLIC, src)) : null, keyword: kw,
        ...(sh.credit ? { credit: sh.credit } : {}) });
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
    const best = picked ? { hit: picked, query: kw } : await bestFor(kw, shotSec, sh.alts);
    if (!best) {
      log("broll", `${label}: no footage that matches "${sh.words}" -> kinetic. Use a more literal keyword, photo:/archive:, or pick in --review`);
      fellBack++;
      plan[id].push({ type: "kinetic" });
      continue;
    }
    const { hit, query } = best;
    used.add(hit.id);
    const shot = shotFromHit(hit, kw, query);
    if (picked) shot.picked = true;
    plan[id].push(shot);
    jobs.push({ shot, hit, kw, query, alts: sh.alts, shotSec, label, picked: !!picked });
  }
}

// ---------- 2. download (12 at a time: owner wants footage collected 3x faster) ----------
const queue = [...jobs];
let downloaded = 0;
await Promise.all(
  Array.from({ length: 12 }, async () => {
    for (let job; (job = queue.shift()); ) {
      try {
        await fetchJob(job);
      } catch (e) {
        log("broll", `${job.label}: ${e.message} -> kinetic`);
        Object.assign(job.shot, { type: "kinetic", src: undefined, duration: undefined, assetId: undefined, credit: undefined });
        fellBack++;
      }
      downloaded++;
      status({ progress: 0.5 + (downloaded / Math.max(1, jobs.length)) * 0.5, doing: `Downloading and checking footage: ${downloaded} of ${jobs.length}` });
    }
  }),
);

for (const { id, idx, gshot, sec } of backdrops) {
  const s = plan[id][idx];
  if (!(s && (s.type === "video" || s.type === "image") && s.src)) { plan[id][idx] = gshot; continue; }
  const isVid = s.type === "video";
  // Never let the footage run out under the graphic: slow it down to fit.
  const speed = isVid && s.duration ? Math.min(1, Math.max(0.5, s.duration / (sec + 0.6))) : 1;
  const bg = { [isVid ? "video" : "image"]: s.src, dim: 0.6, scrim: "center", glow: true, ...(speed < 1 ? { speed: +speed.toFixed(3) } : {}), ...(gshot.graphic.bgOpts ?? {}) };
  plan[id][idx] = { ...gshot, graphic: { ...gshot.graphic, bg }, credit: [...new Set([gshot.credit, s.credit].filter(Boolean))].join(" | ") || undefined,
    assetId: s.assetId, keyword: s.keyword, bgShot: s };
}

// Internal cuts of every clip (cached in broll.json with the shot).
for (const sh of Object.values(plan).flat()) {
  if (sh.type === "video" && sh.src && !sh.cuts && fs.existsSync(path.join(PUBLIC, sh.src))) sh.cuts = detectCuts(path.join(PUBLIC, sh.src));
}

// Named shots (a real car, company, place, year) get a frame sheet for a check by eye: CLIP sees "a sports
// car", not "a 1993 Supra MK4". build/verify/<shot>.jpg = 3 frames; build/verify.json = what the voice says
// over it. Claude looks at each and sets "ok": true/false (false -> change the keyword or pick, re-run).
{
  const vfile = path.join(BUILD, "verify.json"), prevV = readJson(vfile, {}), vdir = path.join(BUILD, "verify"), out = {};
  fs.mkdirSync(vdir, { recursive: true });
  for (const [i, scene] of project.scenes.entries()) {
    const id = sceneId(i);
    let shots; try { shots = shotsOf(scene, i).shots; } catch { continue; }
    for (const [k, sh] of (plan[id] ?? []).entries()) {
      const kw = sh.keyword ?? "", key = `${id}-${k + 1}`;
      if (!sh.src || !["video", "image"].includes(sh.type) || !(/^(archive|yt):/.test(kw) || factual(kw.replace(/^\w+:/, "")))) continue;
      const file = path.join(PUBLIC, sh.src), sheet = path.join(vdir, `${key}.jpg`);
      if (prevV[key]?.src !== sh.src || !fs.existsSync(sheet)) {
        if (sh.type === "video") {
          const d = sh.duration ?? probeDuration(file) ?? 3;
          ffmpeg(["-i", file, "-vf", `fps=${(3 / d).toFixed(4)},scale=-2:240,tile=3x1:padding=6:color=white`, "-frames:v", "1", sheet]);
        } else ffmpeg(["-i", file, "-vf", "scale=-2:240", "-frames:v", "1", sheet]);
      }
      out[key] = { keyword: kw, words: shots[k]?.words ?? "", line: scene.text, src: sh.src, vision: sh.vision ?? null, credit: sh.credit ?? null,
        sheet: `build/verify/${key}.jpg`, ok: prevV[key]?.src === sh.src ? prevV[key].ok ?? null : null };
    }
  }
  writeJson(vfile, out);
  const todo = Object.values(out).filter((v) => v.ok == null).length, bad = Object.entries(out).filter(([, v]) => v.ok === false).map(([k]) => k);
  if (todo) log("broll", `${todo} named shots to check by eye: build/verify/*.jpg against "words" in build/verify.json (set "ok": true / false)`);
  if (bad.length) log("broll", `marked wrong in build/verify.json: ${bad.join(", ")} - change their keyword or pick and re-run`);
}
clearVisionTmp();

writeJson(path.join(BUILD, "broll.json"), plan);
const all = Object.values(plan).flat();
const credits = [...new Set(all.map((s) => s.credit).filter(Boolean))];
// Delete downloads no shot uses any more (changed keywords, earlier picks).
const keep = new Set(all.flatMap((s) => [s.src, s.bgShot?.src]).filter(Boolean).map((s) => path.basename(s)));
const brollDir = path.join(PUBLIC, "broll");
if (fs.existsSync(brollDir)) {
  for (const f of fs.readdirSync(brollDir)) {
    if ((/^(pexels|pixabay|coverr|dvids|wikimedia|nasa|youtube|clip|archiveorg|openverse|unsplash|flickr|smithsonian|europeana|artic|cleveland|svs|wellcome|inat)-/.test(f) || /^adobe-.*\.t\d+\.mp4$/.test(f)) && !keep.has(f) && !f.endsWith(".part")) fs.rmSync(path.join(brollDir, f));
  }
}
fs.writeFileSync(path.join(BUILD, "credits.txt"), credits.join("\n") + "\n");
log("broll", `done: ${all.filter((s) => s.type !== "kinetic").length}/${all.length} shots have footage, ${searches} new searches`);
{
  const prev = readJson(path.join(BUILD, "status.json"), {});
  const missing = Object.entries(plan).flatMap(([sid, list]) => list.map((s, k) => (s.type === "kinetic" ? `${sid}-${k + 1}: no matching footage (title card for now)` : null))).filter(Boolean);
  status({ stats: { ...(prev.stats ?? {}), "shots": all.length, "with footage": all.filter((s) => s.type === "video" || s.type === "image").length,
    "graphics": all.filter((s) => s.type === "graphic").length, "no footage yet": missing.length },
    issues: [...(prev.issues ?? []).filter((x) => !/no matching footage/.test(x)), ...missing] });
}
const bySource = {};
for (const s of all) if (s.assetId) bySource[s.assetId.split("-")[0]] = (bySource[s.assetId.split("-")[0]] ?? 0) + 1;
if (Object.keys(bySource).length) log("broll", `sources: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(", ")}`);
if (credits.some((c) => /CC BY/i.test(c))) log("broll", "CC BY / BY-SA images used: paste build/credits.txt into the video description (required).");
if (ytWanted.size) log("broll", `youtube: ${ytWanted.size} good Creative Commons matches wait for the maker's file or a license check - build/yt/wanted.json (node scripts/yt-engine.mjs source / import / approve), then re-run`);
if (credits.some((c) => /^AI-generated/.test(c))) log("broll", "AI images used: if they look real, tick YouTube's altered/synthetic content disclosure.");
if (exhausted.size && fellBack) {
  log("broll", `${fellBack} shots fell back because ${[...exhausted].join(", ")} hit a rate limit. ` +
    "Re-run `node scripts/auto.mjs --from=broll` later: finished searches and downloads are cached.");
}
