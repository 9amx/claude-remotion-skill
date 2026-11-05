// YouTube Creative Commons footage: shared by yt-engine.mjs (the Falcon Motion engine) and
// fetch-broll.mjs (YouTube CC as one more footage source). One set of rules for both:
// search CC only, verify the license, download only from an authorized source.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILD, readJson, relevance, writeJson } from "./lib.mjs";
import { NOT_REAL } from "./match-rules.mjs";

export const YT = path.join(BUILD, "yt");
export const YT_RAW = path.join(YT, "raw");
const LICENSES = path.join(YT, "licenses.json"), SOURCES = path.join(YT, "sources.json");
export const loadLicenses = () => readJson(LICENSES, {});
export const saveLicenses = (l) => writeJson(LICENSES, l);
export const loadSources = () => readJson(SOURCES, {});
export const saveSources = (s) => writeJson(SOURCES, s);
export const ytUrl = (id, t) => `https://www.youtube.com/watch?v=${id}${t ? `&t=${Math.floor(t)}s` : ""}`;
export const CC_BY = { name: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" };

export const parseTime = (s) => {
  if (s == null) return null;
  if (/^\d+(\.\d+)?$/.test(String(s))) return Number(s);
  const p = String(s).split(":").map(Number);
  return p.some((n) => !Number.isFinite(n)) ? null : p.reduce((a, n) => a * 60 + n, 0);
};
export const isoSec = (d) => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || ""); return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0; };

// ---------- API access (same sign-in as scripts/youtube.mjs) ----------
const CONFIG = process.env.YOUTUBE_CONFIG_DIR
  || (process.platform === "win32" ? path.join(process.env.APPDATA || os.homedir(), "faceless-video") : path.join(os.homedir(), ".config", "faceless-video"));
function clientSecret() {
  if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) return { client_id: process.env.YOUTUBE_CLIENT_ID.trim(), client_secret: process.env.YOUTUBE_CLIENT_SECRET.trim() };
  for (const f of [process.env.YOUTUBE_CLIENT_SECRET_FILE, path.join(CONFIG, "client_secret.json")].filter(Boolean)) {
    const j = readJson(f, null);
    const c = j && (j.installed ?? Object.values(j).find((v) => v?.client_id));
    if (c?.client_id) return c;
  }
  return null;
}
const tokenFile = () => path.join(CONFIG, `youtube-token-${(process.env.YOUTUBE_ACCOUNT || "default").replace(/[^\w.-]/g, "_")}.json`);
// Is there any way to call the API? (no network call)
export const ytAvailable = () => !!process.env.YOUTUBE_API_KEY || (!!readJson(tokenFile(), null)?.refresh_token && !!clientSecret());
let auth = null;
async function youtubeAuth() {
  if (auth) return auth;
  if (process.env.YOUTUBE_API_KEY) return (auth = { key: process.env.YOUTUBE_API_KEY.trim() });
  const tok = readJson(tokenFile(), null), client = clientSecret();
  if (tok?.refresh_token && client) {
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: tok.refresh_token, grant_type: "refresh_token" }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) return (auth = { bearer: j.access_token });
  }
  throw new Error("No YouTube access: set YOUTUBE_API_KEY (Google Cloud -> YouTube Data API v3 -> API key) or run node scripts/youtube.mjs --auth");
}
export class QuotaError extends Error {}
export async function ytGet(endpoint, params) {
  const a = await youtubeAuth();
  const q = new URLSearchParams({ ...params, ...(a.key ? { key: a.key } : {}) });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${q}`, { headers: a.bearer ? { Authorization: `Bearer ${a.bearer}` } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = `YouTube ${endpoint}: ${j.error?.message || r.status}`;
    throw /quota/i.test(msg) ? new QuotaError(msg) : new Error(msg);
  }
  return j;
}
// Creative Commons search: video ids. 100 quota units per call.
export async function searchCC(q, { max = 8, hd = false } = {}) {
  const r = await ytGet("search", { part: "snippet", q, type: "video", videoLicense: "creativeCommon", maxResults: String(max), safeSearch: "moderate", ...(hd ? { videoDefinition: "high" } : {}) });
  return (r.items ?? []).map((it) => it.id.videoId).filter(Boolean);
}
// Full details for up to 50 ids per call (1 unit): the fields the license check and matching need.
export async function videoDetails(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await ytGet("videos", { part: "snippet,status,contentDetails,statistics", id: ids.slice(i, i + 50).join(",") });
    for (const v of r.items ?? []) out[v.id] = {
      id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, channelId: v.snippet.channelId, publishedAt: v.snippet.publishedAt,
      description: v.snippet.description ?? "", tags: v.snippet.tags ?? [], duration: isoSec(v.contentDetails.duration),
      definition: v.contentDetails.definition, licensedContent: !!v.contentDetails.licensedContent, license: v.status.license,
      embeddable: v.status.embeddable, madeForKids: !!v.status.madeForKids, views: Number(v.statistics?.viewCount || 0),
      thumb: v.snippet.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`, fetchedAt: new Date().toISOString(),
    };
  }
  return out;
}

// ---------- matching ----------
// Chapters from the description ("0:00 Intro", "1:23 - Takeoff").
export function chaptersOf(v) {
  const ch = [...(v.description ?? "").matchAll(/^\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–:|]?\s*(.+)$/gm)].map((m) => ({ t: parseTime(m[1]), title: m[2].trim() }))
    .filter((c) => c.t != null && c.t < v.duration).sort((a, b) => a.t - b.t);
  return ch.map((c, i) => ({ ...c, end: ch[i + 1]?.t ?? v.duration }));
}
// Where in the video the keywords are: the best-matching chapter, else an estimate.
export function windowFor(v, keywords, seconds) {
  let best = { rel: 0 };
  for (const c of chaptersOf(v)) {
    const rel = Math.max(0, ...keywords.map((k) => relevance(k, c.title)));
    if (rel > best.rel) best = { rel, chapter: c };
  }
  const len = Math.min(seconds, Math.max(2, v.duration - 1));
  let start = best.chapter ? best.chapter.t + Math.min(3, (best.chapter.end - best.chapter.t) / 4)
    : v.duration > 60 ? Math.min(v.duration * 0.25, v.duration - len - 1) : Math.max(0, (v.duration - len) / 2);
  start = Math.max(0, Math.min(start, v.duration - len));
  return { start: +start.toFixed(1), end: +(start + len).toFixed(1), chapterRel: best.rel, chapter: best.chapter?.title ?? null };
}

// ---------- license verification ----------
// Signs the uploader did not make the footage: a CC label on a re-upload is worthless (it still gets claimed).
const REUPLOAD = [
  [/re-?upload|not (?:my|mine)|i do not own|i don'?t own|no copyright intended|copyright infringement (?:is )?not intended/i, "uploader says it is not theirs"],
  [/all (?:rights|credits?) (?:go|goes|belong|reserved) to|credits? (?:to|goes to)|courtesy of|footage (?:from|by|via)|\bsource:\s*\S/i, "credits someone else's footage"],
  [/fair use|section 107|copyright disclaimer/i, "fair-use disclaimer (not a license)"],
  [/\b(cnn|bbc|fox news|reuters|associated press|ap news|nbc|abc news|cbs|sky news|al jazeera|euronews|dw news|bloomberg|espn|nfl|nba|fifa|uefa)\b/i, "names a broadcaster / league"],
  [/official (?:music )?video|official trailer|full movie|movie clip|tv series|episode \d|full match|highlights/i, "film / TV / music / sports content"],
  [/compilation|best of|top \d+ .*(clips|moments)|try not to/i, "compilation of other clips"],
  // "Race From - @someone", "Edited by", "video by @x", "cc: @x": the footage is credited to another account.
  [/\b(?:race|video|clip|clips|footage|shot|filmed|recorded|original|credit|cc)\s*(?:from|by|:)?\s*[-:–]?\s*@[\w.-]+|\bedit(?:ed)? by\b|\bedits?\b.*#|\bedit(?:s|z)\b/i, "credits / edits another account's footage"],
  [/fast (?:and|&) (?:the )?furious|paul walker|\bthe movie\b|\bfilm (?:scene|clip)\b|\bmovie scene\b|\bnetflix\b|\bmarvel\b/i, "refers to a film / TV show"],
  [/\b(?:ai[- ]?generated|generated (?:footage|video|clip)|free generated|made with (?:ai|sora|runway|veo|kling|pika)|\bsora\b|runway gen|\bveo\b|kling ai|midjourney|cgi\b|3d render|unreal engine|blender)\b/i, "AI-generated / CGI (not real footage)"],
];
// Footage that matches the words but isn't the real thing (models, toys, games): one list, in match-rules.mjs.
export { NOT_REAL };
const MUSIC = /\bmusic\b|song|soundtrack|\bbeat\b|\bremix\b|ncs|epidemic sound|artlist|licensed music/i;
// License record for one video; a person's approve/reject in prev always wins.
export function licenseFor(v, prev) {
  const flags = [], notes = [];
  const text = `${v.title}\n${v.description}`;
  for (const [re, why] of REUPLOAD) if (re.test(text)) flags.push(why);
  if (v.licensedContent) flags.push("YouTube marks it as partner-claimed content (Content ID): check the claimant is the uploader");
  // Shorts / tiny clips with no word about where the footage is from: the usual re-upload shape.
  const about = (v.description ?? "").replace(/#[\p{L}\p{N}_]+/gu, "").replace(/https?:\/\/\S+/g, "").trim();
  if (v.duration <= 60 && about.length < 40) flags.push("short clip with no stated origin");
  // Tags naming other creators' channels (tag stuffing) - e.g. another YouTuber's name in the tags.
  const foreign = (v.tags ?? []).filter((t) => /\\/.test(t)).length;
  if (foreign >= 3) flags.push("tags copied from other videos");
  if (NOT_REAL.test(`${v.title} ${(v.tags ?? []).join(" ")}`)) notes.push("looks like a model / toy / game, not the real thing");
  if (MUSIC.test(text)) notes.push("description mentions music: the soundtrack may be someone else's - clips are used silent");
  if (v.madeForKids) notes.push("made for kids");
  const cc = v.license === "creativeCommon";
  const checks = {
    creativeCommons: cc, licenseName: cc ? CC_BY.name : "Standard YouTube License",
    commercialUse: cc, derivatives: cc, attributionRequired: cc,
    sourcePermission: prev?.human ? prev.human.decision === "approve" : flags.length ? "doubtful" : "no red flags (uploader not proven)",
  };
  let status = !cc ? "rejected" : flags.length ? "review" : "ok";
  if (prev?.human) status = prev.human.decision === "approve" && cc ? "approved" : "rejected";
  return {
    videoId: v.id, url: ytUrl(v.id), title: v.title, channel: v.channel, channelId: v.channelId, channelUrl: `https://www.youtube.com/channel/${v.channelId}`,
    publishedAt: v.publishedAt, status, checks, flags, notes,
    attribution: `"${v.title}" by ${v.channel} (${ytUrl(v.id)}), licensed under ${CC_BY.name} (${CC_BY.url}). Cut and resized.`,
    evidence: { license: v.license, licensedContent: v.licensedContent, embeddable: v.embeddable, checkedAt: new Date().toISOString() },
    ...(prev?.human ? { human: prev.human } : {}),
  };
}
export const usable = (l) => !!l && (l.status === "ok" || l.status === "approved");

// ---------- authorized download ----------
export const rawFile = (id) => {
  if (!fs.existsSync(YT_RAW)) return null;
  const f = fs.readdirSync(YT_RAW).find((x) => x.startsWith(`${id}.`) && !x.endsWith(".part"));
  return f ? path.join(YT_RAW, f) : null;
};
// How the file can be had legitimately, or null: already here, the maker's own file, or a recorded authorization.
export function authorizedSource(id, sources = loadSources()) {
  if (rawFile(id)) return "file";
  const s = sources[id] ?? {};
  return s.official ? "official" : s.authorization ? "authorization" : null;
}
// Get the raw file into build/yt/raw/ (only from an authorized source). Returns its path; throws with the reason.
export async function fetchRaw(id, sources = loadSources()) {
  const have = rawFile(id);
  if (have) return have;
  const s = sources[id] ?? {};
  fs.mkdirSync(YT_RAW, { recursive: true });
  if (s.official) {
    const r = await fetch(s.official);
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !/video|octet-stream/.test(type)) throw new Error(`official URL gave ${r.status} ${type} (not a video file)`);
    const dest = path.join(YT_RAW, `${id}${/webm/.test(type) ? ".webm" : /quicktime/.test(type) ? ".mov" : ".mp4"}`);
    fs.writeFileSync(dest + ".part", Buffer.from(await r.arrayBuffer()));
    fs.renameSync(dest + ".part", dest);
    return dest;
  }
  if (s.authorization) {
    if (spawnSync("yt-dlp", ["--version"]).status !== 0) throw new Error("authorized, but yt-dlp is not installed (winget install yt-dlp)");
    const r = spawnSync("yt-dlp", ["-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]", "--merge-output-format", "mp4", "--no-playlist",
      "-o", path.join(YT_RAW, `${id}.%(ext)s`), ytUrl(id)], { stdio: "inherit" });
    if (r.status !== 0 || !rawFile(id)) throw new Error("yt-dlp failed");
    return rawFile(id);
  }
  throw new Error("no authorized source: use the maker's file (source), a file you were given (import) or a recorded authorization (authorize)");
}
// Good CC matches that are blocked only because the file isn't available yet: build/yt/wanted.json.
const WANTED = path.join(YT, "wanted.json");
export function noteWanted(v, why, forWhat) {
  const w = readJson(WANTED, {});
  const links = [...(v.description ?? "").matchAll(/https?:\/\/[^\s)]+/g)].map((m) => m[0]).filter((u) => !/youtu\.?be|instagram|tiktok|twitter|x\.com|facebook|patreon/i.test(u)).slice(0, 4);
  w[v.id] = { url: ytUrl(v.id), title: v.title, channel: v.channel, why, for: [...new Set([...(w[v.id]?.for ?? []), forWhat])], links, at: new Date().toISOString() };
  writeJson(WANTED, w);
}
