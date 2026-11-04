// What worked? Pull current numbers for every Short in history.json.
//   node <daily-shorts>/scripts/yt-stats.mjs            (run from a project folder or with DAILY_ROOT set)
// Adds to each history entry: views, likes, comments, and snapshots at about 24 h, 72 h and 7 days,
// then prints which formats and topics do best. The run reads this before picking today's topic.
import { DAILY_ROOT, HISTORY, log, readJson, writeJson, ytGet } from "./daily-lib.mjs";

const hist = readJson(HISTORY, { videos: [] });
const withId = hist.videos.filter((v) => v.videoId);
if (!withId.length) { log("stats", `no uploaded Shorts in ${HISTORY} yet`); process.exit(0); }

try {
  for (let i = 0; i < withId.length; i += 50) {
    const batch = withId.slice(i, i + 50);
    const r = await ytGet("videos", { part: "statistics,snippet,status", id: batch.map((v) => v.videoId).join(",") });
    const byId = Object.fromEntries((r.items || []).map((it) => [it.id, it]));
    for (const v of batch) {
      const it = byId[v.videoId];
      if (!it) { v.removed = true; continue; }
      const s = it.statistics;
      v.views = Number(s.viewCount || 0); v.likes = Number(s.likeCount || 0); v.comments = Number(s.commentCount || 0);
      v.privacy = it.status.privacyStatus;
      const published = new Date(it.snippet.publishedAt || v.uploadedAt || Date.now());
      const ageH = (Date.now() - published.getTime()) / 3600e3;
      v.snapshots = v.snapshots || {};
      for (const [label, h] of [["24h", 24], ["72h", 72], ["7d", 168]]) if (!v.snapshots[label] && ageH >= h) v.snapshots[label] = v.views;
      v.statsAt = new Date().toISOString();
    }
  }
} catch (e) {
  log("stats", `could not read YouTube stats: ${e.message}`);
  process.exit(0); // never block the day's run on stats
}
writeJson(HISTORY, hist);

// What works: average views at 72 h (or latest) by format and by category
const pub = withId.filter((v) => v.privacy === "public" && !v.removed);
const val = (v) => v.snapshots?.["72h"] ?? v.views ?? 0;
const group = (key) => {
  const g = {};
  for (const v of pub) { const k = v[key] || "?"; (g[k] ||= []).push(val(v)); }
  return Object.entries(g).map(([k, a]) => ({ [key]: k, videos: a.length, avgViews: Math.round(a.reduce((x, y) => x + y, 0) / a.length) })).sort((a, b) => b.avgViews - a.avgViews);
};
const summary = { at: new Date().toISOString(), public: pub.length, byFormat: group("format"), byCategory: group("category"),
  best: [...pub].sort((a, b) => val(b) - val(a)).slice(0, 5).map((v) => ({ title: v.title, format: v.format, category: v.category, views: v.views })) };
writeJson(`${DAILY_ROOT}/performance.json`, summary);
log("stats", `${pub.length} public Shorts. Best formats: ${summary.byFormat.slice(0, 3).map((f) => `${f.format} (${f.avgViews} avg)`).join(", ") || "not enough data yet"}`);
