// What works on a channel: every upload's title, length, views, likes and
// date through the YouTube Data API, ranked. The autopilot takes TOPICS from
// it; scripts are always written new (never copied or paraphrased from the
// videos: that is reused content and gets a channel demonetized).
//   node channel-research.mjs @handle [--max=300]     (or a channel id UC...)
// Writes research/<handle>.json and prints the top videos and the channel's pattern.
// Auth (public data): YOUTUBE_API_KEY, or YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET +
// YOUTUBE_REFRESH_TOKEN (the uploader's sign-in). Quota: about 1 unit per 50 videos.
import fs from "node:fs";
import path from "node:path";

const API = "https://www.googleapis.com/youtube/v3";
const [target, ...rest] = process.argv.slice(2);
const max = Number(rest.find((a) => a.startsWith("--max="))?.slice(6) ?? 300);
const log = (m) => console.log(`\x1b[36m[research]\x1b[0m ${m}`);
const fail = (m) => {
  console.error(`\x1b[31m[error]\x1b[0m ${m}`);
  process.exit(1);
};
if (!target) fail("usage: node channel-research.mjs @handle [--max=300]");

let auth = null;
async function authorize() {
  if (process.env.YOUTUBE_API_KEY) return (auth = { key: process.env.YOUTUBE_API_KEY.trim() });
  const { YOUTUBE_CLIENT_ID: id, YOUTUBE_CLIENT_SECRET: secret, YOUTUBE_REFRESH_TOKEN: refresh } = process.env;
  if (!(id && secret && refresh)) fail("Set YOUTUBE_API_KEY, or YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET + YOUTUBE_REFRESH_TOKEN, in the environment.");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(`Google sign-in failed: ${j.error_description || j.error || r.status}`);
  return (auth = { bearer: j.access_token });
}

async function get(endpoint, params) {
  const q = new URLSearchParams({ ...params, ...(auth.key ? { key: auth.key } : {}) });
  const r = await fetch(`${API}/${endpoint}?${q}`, { headers: auth.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(`YouTube API ${endpoint}: ${j.error?.errors?.[0]?.reason ?? r.status} ${j.error?.message ?? ""}`);
  return j;
}

// ISO 8601 duration (PT1H2M3S) -> seconds
const seconds = (iso) => {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? "") ?? [];
  return (Number(m[1] ?? 0) * 86400) + (Number(m[2] ?? 0) * 3600) + (Number(m[3] ?? 0) * 60) + Number(m[4] ?? 0);
};
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

await authorize();
const byId = /^UC[\w-]{22}$/.test(target);
const ch = (await get("channels", { part: "snippet,contentDetails,statistics", ...(byId ? { id: target } : { forHandle: target.startsWith("@") ? target : `@${target}` }) })).items?.[0];
if (!ch) fail(`No channel ${target}. Use the @handle from the channel's page, or its UC... id.`);
const uploads = ch.contentDetails.relatedPlaylists.uploads;

const ids = [];
for (let page; ids.length < max; ) {
  const j = await get("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "50", ...(page ? { pageToken: page } : {}) });
  ids.push(...j.items.map((i) => i.contentDetails.videoId));
  if (!(page = j.nextPageToken)) break;
}
const videos = [];
for (let i = 0; i < Math.min(ids.length, max); i += 50) {
  const j = await get("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(",") });
  for (const v of j.items) {
    const dur = seconds(v.contentDetails.duration);
    videos.push({
      id: v.id, url: `https://youtu.be/${v.id}`, title: v.snippet.title, publishedAt: v.snippet.publishedAt,
      views: Number(v.statistics.viewCount ?? 0), likes: Number(v.statistics.likeCount ?? 0), comments: Number(v.statistics.commentCount ?? 0),
      seconds: dur, short: dur <= 180 && (v.snippet.title + v.snippet.description).toLowerCase().includes("#short") || dur <= 60,
      tags: v.snippet.tags ?? [], language: v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage ?? null,
      description: (v.snippet.description ?? "").slice(0, 300),
    });
  }
}
videos.sort((a, b) => b.views - a.views);

const now = Date.now();
const recent = videos.filter((v) => now - Date.parse(v.publishedAt) < 90 * 864e5);
const summary = {
  videos: videos.length,
  shortsShare: Math.round((videos.filter((v) => v.short).length / Math.max(1, videos.length)) * 100) / 100,
  medianViews: median(videos.map((v) => v.views)),
  medianSeconds: median(videos.map((v) => v.seconds)),
  uploadsPerWeekLast90Days: Math.round((recent.length / (90 / 7)) * 10) / 10,
  medianTitleWords: median(videos.map((v) => v.title.split(/\s+/).length)),
};
const handle = (ch.snippet.customUrl ?? target).replace(/^@/, "").replace(/[^\w.-]/g, "_");
const out = path.join("research", `${handle}.json`);
fs.mkdirSync("research", { recursive: true });
fs.writeFileSync(out, JSON.stringify({
  channel: { id: ch.id, title: ch.snippet.title, handle: ch.snippet.customUrl, subscribers: Number(ch.statistics.subscriberCount ?? 0), videos: Number(ch.statistics.videoCount ?? 0) },
  fetchedAt: new Date().toISOString(), summary, videos,
}, null, 2));

log(`${ch.snippet.title}: ${videos.length} videos, ${Math.round(summary.shortsShare * 100)}% Shorts, median ${summary.medianViews.toLocaleString("en-US")} views, ` +
  `median ${summary.medianSeconds}s, ${summary.uploadsPerWeekLast90Days}/week lately -> ${out}`);
log("top 15 by views (topics to make your OWN video about):");
for (const v of videos.slice(0, 15)) console.log(`  ${v.views.toLocaleString("en-US").padStart(12)}  ${String(v.seconds).padStart(5)}s  ${v.title}`);
