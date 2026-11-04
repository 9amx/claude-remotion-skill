// How much do people watch this topic on YouTube right now?
//   node <daily-shorts>/scripts/yt-demand.mjs "delta flight 2210" "tampa hurricane" ...
//   node <daily-shorts>/scripts/yt-demand.mjs --file=build/candidates.json   ([{ "id": "c1", "query": "..." }, ...])
// For each search: videos from the last 7 days (US, English), their views and views per hour,
// how many of them are Shorts, and the top titles (to learn what packaging works - never copy them).
// Scores: demand 1-5 (how hot), crowding 1-5 (how many strong Shorts already exist).
// Writes build/demand.json. Uses the channel sign-in (node scripts/youtube.mjs --auth) or YOUTUBE_API_KEY.
// Quota: about 101 units per search (10,000 a day are free).
import path from "node:path";
import { BUILD, args, fail, isoDurationSec, log, opt, readJson, writeJson, ytGet } from "./daily-lib.mjs";

const fromFile = opt("file") ? readJson(path.resolve(opt("file")), null) : null;
const queries = fromFile ? fromFile.map((c) => ({ id: c.id, query: c.query })) : args.filter((a) => !a.startsWith("--")).map((q, i) => ({ id: `q${i + 1}`, query: q }));
if (!queries.length) fail('Give search phrases: node yt-demand.mjs "phrase one" "phrase two"');
const days = Number(opt("days") || 7);

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const score = (v, steps) => 1 + steps.filter((s) => v >= s).length;
const out = [];
for (const q of queries) {
  try {
    const after = new Date(Date.now() - days * 86400e3).toISOString();
    const s = await ytGet("search", { part: "snippet", q: q.query, type: "video", order: "viewCount", publishedAfter: after,
      maxResults: "15", relevanceLanguage: "en", regionCode: "US", safeSearch: "none" });
    const ids = (s.items || []).map((it) => it.id.videoId).filter(Boolean);
    const v = ids.length ? await ytGet("videos", { part: "statistics,contentDetails,snippet", id: ids.join(",") }) : { items: [] };
    const vids = (v.items || []).map((it) => {
      const hours = Math.max(1, (Date.now() - new Date(it.snippet.publishedAt).getTime()) / 3600e3);
      const views = Number(it.statistics.viewCount || 0);
      return { title: it.snippet.title, channel: it.snippet.channelTitle, views, perHour: Math.round(views / hours), hours: Math.round(hours),
        short: isoDurationSec(it.contentDetails.duration) <= 180 };
    });
    const shorts = vids.filter((x) => x.short);
    const med = median(vids.map((x) => x.perHour));
    const strongShorts = shorts.filter((x) => x.views >= 100000).length;
    const r = {
      id: q.id, query: q.query, videos: vids.length, shorts: shorts.length,
      topViews: Math.max(0, ...vids.map((x) => x.views)), medianViewsPerHour: med,
      demand: score(med, [20, 100, 500, 2000]), crowding: score(strongShorts, [1, 3, 6, 10]),
      topTitles: vids.slice(0, 5).map((x) => `${x.title} - ${x.views.toLocaleString("en-US")} views, ${x.hours} h${x.short ? ", Short" : ""}`),
    };
    out.push(r);
    log("demand", `${q.query}: demand ${r.demand}/5 (median ${med} views/h over ${vids.length} videos), crowding ${r.crowding}/5 (${strongShorts} Shorts over 100k)`);
  } catch (e) {
    out.push({ id: q.id, query: q.query, error: e.message });
    log("demand", `${q.query}: ${e.message}`);
  }
}
writeJson(path.join(BUILD, "demand.json"), { at: new Date().toISOString(), days, results: out });
log("demand", "build/demand.json written - high demand with low crowding is the sweet spot; high demand with high crowding needs a fresher angle");
