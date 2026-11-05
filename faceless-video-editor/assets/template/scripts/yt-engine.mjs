// Falcon Motion YouTube Engine: script in, licensed Creative Commons footage package out.
//
//   1 analyze  <script.txt|project.json>   sentences + footage keywords   -> build/yt/script.json
//   2 search   [--per=8] [--only=L003] [--hd]  YouTube Data API, Creative Commons only -> build/yt/videos.json
//   3 match    [--top=3]                    scene, timestamp, confidence  -> build/yt/matches.json + matches.md
//   4 verify                                CC BY, attribution, commercial use, uploader red flags -> build/yt/licenses.json
//   5 download                              only from an authorized source (see below)  -> build/yt/raw/
//   6 extract  [--auto] [--keep-audio] [--min=0.45]  ffmpeg cuts, renamed and ordered -> build/yt/package/clips/
//   7 package                               editor package: clips, sources, license records -> build/yt/package/
//   run <script>                            1-4 in one go (stops before downloading)
//
// Helpers between the steps:
//   pick <L003> <videoId> <start> [end]     choose the clip for a sentence (times in s or m:ss)
//   scenes <videoId>                        contact sheet + internal cut times of a downloaded video
//                                           (build/yt/review/<id>.jpg) to set an exact timestamp
//   approve <videoId> --note="..."          a person checked the uploader made the footage
//   reject  <videoId> --note="..."          never use this video
//   source  <videoId> <url>                 the maker's own file (their site, Internet Archive, Wikimedia, Vimeo download)
//   import  <videoId> <file>                a file you got from the maker / with permission
//   authorize <videoId> --type=own-channel|written-permission|download-button --note="..."
//   status                                  where every sentence stands
//
// Download rule (YouTube's terms forbid downloaders unless YouTube shows a download
// option or the rights holder lets you): a video is fetched only if its license
// record passes AND one of these exists - an official file URL (`source`), a file
// you imported (`import`), or a recorded authorization (`authorize`, which allows
// yt-dlp). A Creative Commons label alone never triggers yt-dlp.
//
// Env: YOUTUBE_API_KEY, or the channel sign-in from `node scripts/youtube.mjs --auth`.
// Quota: search costs 100 units (10,000 free a day): about 2 keywords x 40 sentences a day.
import fs from "node:fs";
import path from "node:path";
import { BUILD, ffmpeg, fail, log, probeDuration, readJson, relevance, writeJson } from "./lib.mjs";
import { mismatch } from "./match-rules.mjs";
import { bestMoment, clearVisionTmp, scoreImages } from "./vision.mjs";
import { CC_BY, NOT_REAL, QuotaError, authorizedSource, fetchRaw, licenseFor, loadLicenses, loadSources, noteWanted, parseTime, rawFile, saveLicenses,
  saveSources, searchCC, usable, videoDetails, windowFor, ytUrl } from "./yt-lib.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a) => !a.startsWith("--"));
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

const DIR = path.join(BUILD, "yt");
const F = {
  script: path.join(DIR, "script.json"), videos: path.join(DIR, "videos.json"), cache: path.join(DIR, "search-cache.json"),
  matches: path.join(DIR, "matches.json"), picks: path.join(DIR, "picks.json"), raw: path.join(DIR, "raw"), review: path.join(DIR, "review"), pkg: path.join(DIR, "package"),
};
const load = (k, fb) => readJson(F[k], fb);
const save = (k, d) => writeJson(F[k], d);

// ---------- time helpers ----------
const mmss = (t) => { const s = Math.max(0, Math.round(t)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const fileTime = (t) => mmss(t).replace(/:/g, "m").replace(/m(\d\d)$/, "m$1s");
const slug = (s, n = 32) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, n).replace(/-$/, "") || "clip";

// ---------- 1. Script analyzer ----------
const STOP = new Set(("a an the and or but if then so of to in on at by for with from into over under about as is are was were be been being it its this that these those " +
  "he she they we you i his her their our your my me him them us not no yes do does did done have has had can could would should will just very really " +
  "more most less much many some any all every each one two also than too only even still there here what which who whom whose when where why how because " +
  "while after before again once ever never always now today said says say like get got make made going").split(" "));
const NUMWORD = /^(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|first|second|third|last|next)$/i;
const TIMEWORD = /^(days?|weeks?|months?|years?|hours?|minutes?|seconds?|later|earlier|ago|through|every|tons?)$/i;
function keywordsFor(sentence) {
  const clean = sentence.replace(/["“”‘’()[\]]/g, " ");
  // Proper names with their numbers ("Apollo 11", "Saturn V", "Boeing 737"); leading stop / number words dropped.
  const names = [...clean.matchAll(/\b[A-Z][\p{L}\d-]*(?:\s+(?:(?:of|de|the|and)\s+)?(?:[A-Z][\p{L}\d-]*|\d+[A-Za-z]?\b))*/gu)]
    .map((m) => m[0].split(/\s+/)).map((w) => { while (w.length && (STOP.has(w[0].toLowerCase()) || NUMWORD.test(w[0]))) w.shift(); return w.join(" "); })
    .filter((n) => n.length > 1 && !/^\d+$/.test(n));
  const years = clean.match(/\b(1[89]\d\d|20\d\d)\b/g) ?? [];
  const words = clean.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !STOP.has(w) && !NUMWORD.test(w) && !TIMEWORD.test(w));
  const content = [...new Set(words)].slice(0, 4).join(" ");
  const kws = [];
  if (names.length) kws.push([...new Set([...names.slice(0, 2), ...years.slice(0, 1)])].join(" "));
  if (content) kws.push(content);
  return [...new Set(kws)].slice(0, 3);
}
function analyze(file) {
  if (!file || !fs.existsSync(file)) fail("Give the script: node scripts/yt-engine.mjs analyze script.txt (or project.json)");
  let texts;
  if (file.endsWith(".json")) {
    const p = readJson(file, {});
    texts = (p.scenes ?? []).map((s) => String(s.text ?? s.narration ?? "")).join(" ");
  } else texts = fs.readFileSync(file, "utf8");
  const sentences = texts.replace(/\s+/g, " ").split(/(?<=[.!?।])\s+/u).map((s) => s.replace(/\*/g, "").trim()).filter((s) => s.length > 2);
  const old = Object.fromEntries((load("script", { sentences: [] }).sentences).map((s) => [s.text, s]));
  const out = sentences.map((text, i) => {
    const id = `L${String(i + 1).padStart(3, "0")}`;
    const words = text.split(/\s+/).length;
    const keep = old[text]; // keywords Claude already refined survive a re-run
    return { id, text, seconds: Math.min(10, Math.max(3, +(words / 2.6).toFixed(1))), keywords: keep?.keywords ?? keywordsFor(text), refined: keep?.refined ?? false };
  });
  save("script", { source: path.resolve(file), at: new Date().toISOString(), sentences: out });
  const latin = out.filter((s) => /[a-z]/i.test(s.text)).length;
  log("analyze", `${out.length} sentences -> build/yt/script.json`);
  log("analyze", latin < out.length / 2
    ? "Script is not in English: write English footage keywords for every sentence (keywords[], set refined: true) - YouTube CC footage is searched in English"
    : "Draft keywords are heuristic: rewrite each sentence's keywords as 1-3 filmable search phrases (subject + action + place, real names, years) and set refined: true");
}

// ---------- 2. YouTube search (Creative Commons only) ----------
async function search() {
  const sc = load("script", null) ?? fail("Run analyze first");
  const videos = load("videos", {}), cache = load("cache", {});
  const per = Number(opt("per") || 8), only = opt("only"), maxKw = Number(opt("keywords") || 2);
  const unrefined = sc.sentences.filter((s) => !s.refined).length;
  if (unrefined) log("search", `${unrefined} sentences still have draft keywords (refined: false) - results will be weaker`);
  let calls = 0;
  for (const s of sc.sentences) {
    if (only && s.id !== only) continue;
    s.results = [];
    for (const kw of s.keywords.slice(0, maxKw)) {
      const ck = `${kw}|${per}|${flag("hd")}`;
      if (!cache[ck]) {
        try { cache[ck] = await searchCC(kw, { max: per, hd: flag("hd") }); calls++; }
        catch (e) {
          log("search", `${s.id} "${kw}": ${e.message}`);
          if (e instanceof QuotaError) { save("cache", cache); save("videos", videos); save("script", sc); fail("Daily quota used up - continue tomorrow or with another key"); }
          continue;
        }
      }
      s.results.push({ kw, ids: cache[ck] });
    }
    const missing = [...new Set(s.results.flatMap((r) => r.ids))].filter((id) => !videos[id]);
    if (missing.length) Object.assign(videos, await videoDetails(missing));
    log("search", `${s.id}: ${[...new Set(s.results.flatMap((r) => r.ids))].length} CC videos`);
  }
  save("cache", cache); save("videos", videos); save("script", sc);
  log("search", `${calls} searches (~${calls * 100} quota units) -> build/yt/videos.json (${Object.keys(videos).length} videos)`);
}

// ---------- 3. Scene matching ----------
function scoreVideo(s, v, lic) {
  const meta = `${v.title} ${v.tags.join(" ")} ${v.description.slice(0, 600)}`;
  const kwRel = Math.max(0, ...s.keywords.map((k) => relevance(k, meta)));
  const titleRel = Math.max(0, ...s.keywords.map((k) => relevance(k, `${v.title} ${v.tags.join(" ")}`)));
  const w = windowFor(v, s.keywords, s.seconds);
  const lic01 = lic?.status === "ok" || lic?.status === "approved" ? 1 : 0; // unchecked / review / rejected never outrank a pass on license
  // A model, toy or game matches the words but isn't the thing: unless the line asks for one.
  const fake = NOT_REAL.test(`${v.title} ${v.tags.join(" ")}`) && !s.keywords.some((k) => NOT_REAL.test(k));
  const confidence = +((0.45 * kwRel + 0.15 * titleRel + 0.2 * w.chapterRel + 0.1 * (v.definition === "hd" ? 1 : 0) + 0.1 * lic01) * (fake ? 0.4 : 1)).toFixed(2);
  return { videoId: v.id, title: v.title, channel: v.channel, start: w.start, end: w.end, confidence, timestamp: w.chapter ? "chapter" : "estimated",
    why: `${Math.round(kwRel * 100)}% keyword match, ${w.chapter ? `chapter "${w.chapter}"` : "no chapter: estimated, confirm with scenes"}, ${v.definition}${fake ? ", looks like a model / toy / game" : ""}` };
}
async function match() {
  const sc = load("script", null) ?? fail("Run analyze + search first");
  const videos = load("videos", {}), lic = loadLicenses(), top = Number(opt("top") || 3);
  const out = {};
  for (const s of sc.sentences) {
    const ids = [...new Set((s.results ?? []).flatMap((r) => r.ids))].filter((id) => videos[id] && videos[id].duration >= 3);
    // Wrong generation / era / a toy or game / an excluded "-word": out before scoring (match-rules.mjs).
    const fit = ids.filter((id) => !s.keywords.length || s.keywords.some((k) => !mismatch(k, `${videos[id].title} ${videos[id].tags.join(" ")} ${videos[id].description.slice(0, 600)}`)));
    let ms = fit.map((id) => scoreVideo(s, videos[id], lic[id])).filter((m) => lic[m.videoId]?.status !== "rejected");
    // The picture: CLIP on each video's thumbnail (vision.mjs). A quarter of the confidence; a thumbnail
    // that clearly shows something else is marked.
    if (ms.length && s.keywords[0] && !flag("no-vision")) {
      const dir = path.join(DIR, "thumbs"); fs.mkdirSync(dir, { recursive: true });
      const files = [];
      for (const m of ms) {
        const f = path.join(dir, `${m.videoId}.jpg`);
        if (!fs.existsSync(f)) { const r = await fetch(`https://i.ytimg.com/vi/${m.videoId}/hqdefault.jpg`).catch(() => null); if (r?.ok) fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
        files.push(fs.existsSync(f) ? f : null);
      }
      const sc2 = await scoreImages(files.filter(Boolean), s.keywords[0]);
      if (sc2) {
        let k = 0;
        for (const [i, m] of ms.entries()) {
          const v = files[i] ? sc2[k++] : null;
          if (!v) continue;
          m.vision = v.match;
          m.confidence = +(0.75 * m.confidence + 0.25 * v.match).toFixed(2);
          m.why += `, thumbnail ${Math.round(v.match * 100)}%${v.match < 0.25 ? ` (looks like ${v.junk})` : ""}`;
        }
      }
    }
    out[s.id] = ms.sort((a, b) => b.confidence - a.confidence).slice(0, top);
  }
  // No two sentences on the same stretch of one video: move a later window past the earlier one, or rank it down.
  const used = {};
  for (const s of sc.sentences) {
    for (const m of out[s.id]) {
      const len = m.end - m.start, dur = videos[m.videoId].duration;
      for (const [a, b] of used[m.videoId] ?? []) if (m.start < b && m.end > a) {
        if (b + 0.5 + len <= dur) { m.start = +(b + 0.5).toFixed(1); m.end = +(m.start + len).toFixed(1); m.why += ", moved past footage another line uses"; }
        else { m.confidence = +(m.confidence - 0.2).toFixed(2); m.why += ", same footage as another line"; }
      }
    }
    out[s.id].sort((a, b) => b.confidence - a.confidence);
    const best = out[s.id][0];
    if (best) (used[best.videoId] ??= []).push([best.start, best.end]);
  }
  save("matches", out);
  const md = ["# Scene matches", "", "Confidence 0-1. `estimated` timestamps need `scenes <id>` after download; set the clip with `pick`.", ""];
  for (const s of sc.sentences) {
    md.push(`## ${s.id} - ${s.text}`, `keywords: ${s.keywords.join(" | ")}`, "");
    if (!out[s.id].length) md.push("- no Creative Commons match: use stock / archive / a graphic for this line", "");
    for (const m of out[s.id]) md.push(`- **${m.confidence}** [${m.title}](${ytUrl(m.videoId, m.start)}) - ${m.channel} - ${mmss(m.start)}-${mmss(m.end)} (${m.timestamp}) - ${m.why}`);
    md.push("");
  }
  fs.writeFileSync(path.join(DIR, "matches.md"), md.join("\n"));
  const hit = Object.values(out).filter((m) => m[0]?.confidence >= 0.45).length;
  log("match", `${hit}/${sc.sentences.length} sentences have a match >= 0.45 -> build/yt/matches.md`);
}

// ---------- 4. License verification (rules in yt-lib.mjs, shared with fetch-broll) ----------
function verify() {
  // Every search result, not only the current top matches: re-ranking after a rejection must never surface an unchecked video.
  const videos = load("videos", {}), sc = load("script", { sentences: [] }), lic = loadLicenses();
  const ids = [...new Set(sc.sentences.flatMap((s) => (s.results ?? []).flatMap((r) => r.ids)))];
  const counts = { ok: 0, review: 0, rejected: 0 };
  for (const id of ids) {
    if (!videos[id]) continue;
    lic[id] = licenseFor(videos[id], lic[id]);
    counts[lic[id].status === "approved" ? "ok" : lic[id].status]++;
  }
  saveLicenses(lic);
  log("verify", `${counts.ok} pass, ${counts.review} need a person to check the uploader (approve/reject), ${counts.rejected} rejected -> build/yt/licenses.json`);
  for (const l of Object.values(lic).filter((x) => x.status === "review")) log("verify", `  review ${l.videoId} "${l.title}" (${l.channel}): ${l.flags.join("; ")}`);
}
function human(decision) {
  const [id] = pos; const lic = loadLicenses();
  if (!lic[id]) fail(`${id} has no license record - run verify (or fetch-broll) first`);
  lic[id].human = { decision, note: opt("note") ?? "", at: new Date().toISOString() };
  lic[id].status = decision === "approve" ? (lic[id].checks.creativeCommons ? "approved" : "rejected") : "rejected";
  lic[id].checks.sourcePermission = decision === "approve";
  saveLicenses(lic);
  log("verify", `${id}: ${lic[id].status}${opt("note") ? ` (${opt("note")})` : ""}`);
}

// ---------- picks ----------
function pick() {
  const [sid, vid, a, b] = pos;
  const sc = load("script", null) ?? fail("Run analyze first");
  const s = sc.sentences.find((x) => x.id === sid) ?? fail(`No sentence ${sid}`);
  const start = parseTime(a); if (start == null) fail("pick <L003> <videoId> <start> [end]");
  const end = b != null ? parseTime(b) : start + s.seconds;
  const picks = load("picks", {}); picks[sid] = { videoId: vid, start, end, at: new Date().toISOString() }; save("picks", picks);
  log("pick", `${sid} -> ${vid} ${mmss(start)}-${mmss(end)}`);
}
// The pick for every sentence: an explicit pick, else (with --auto) the best match above --min.
const picksManual = (c) => !c.auto; // a pick made with `pick` is exact by definition
function chosen() {
  const sc = load("script", { sentences: [] }), picks = load("picks", {}), matches = load("matches", {}), min = Number(opt("min") || 0.45);
  return sc.sentences.map((s, i) => {
    const m = matches[s.id]?.[0];
    const p = picks[s.id] ?? (flag("auto") && m && m.confidence >= min ? { videoId: m.videoId, start: m.start, end: m.end, auto: true } : null);
    return p ? { ...p, sentence: s, order: i + 1, match: (matches[s.id] ?? []).find((x) => x.videoId === p.videoId) } : null;
  }).filter(Boolean);
}

// ---------- 5. Authorized download (rules in yt-lib.mjs) ----------
function setSource() {
  const [id, url] = pos; if (!id || !/^https?:\/\//.test(url ?? "")) fail("source <videoId> <https://maker's file>");
  const src = loadSources(); src[id] = { ...src[id], official: url, at: new Date().toISOString() }; saveSources(src);
  log("source", `${id}: official file ${url}`);
}
function authorize() {
  const [id] = pos, type = opt("type");
  if (!id || !["own-channel", "written-permission", "download-button"].includes(type)) fail("authorize <videoId> --type=own-channel|written-permission|download-button --note=\"who / where it is written\"");
  if (type === "written-permission" && !opt("note")) fail("written-permission needs --note= naming who gave it and where it is kept");
  const src = loadSources(); src[id] = { ...src[id], authorization: { type, note: opt("note") ?? "", at: new Date().toISOString() } }; saveSources(src);
  log("authorize", `${id}: ${type} recorded - download may use yt-dlp`);
}
function importFile() {
  const [id, file] = pos; if (!id || !file || !fs.existsSync(file)) fail("import <videoId> <file>");
  fs.mkdirSync(F.raw, { recursive: true });
  fs.copyFileSync(file, path.join(F.raw, `${id}${path.extname(file) || ".mp4"}`));
  const src = loadSources(); src[id] = { ...src[id], imported: path.resolve(file), at: new Date().toISOString() }; saveSources(src);
  log("import", `${id}: ${file} -> build/yt/raw/`);
}
async function download() {
  const lic = loadLicenses(), src = loadSources(), videos = load("videos", {});
  const list = chosen();
  const ids = [...new Set(list.map((c) => c.videoId))];
  if (!ids.length) fail("Nothing picked: pick <L003> <videoId> <start>, or run with --auto");
  const blocked = [];
  for (const id of ids) {
    if (rawFile(id)) { log("download", `${id}: already here`); continue; }
    const l = lic[id];
    if (!usable(l)) { blocked.push(`${id}: license ${l?.status ?? "not verified"} - run verify / approve first`); continue; }
    if (!authorizedSource(id, src)) {
      if (videos[id]) noteWanted(videos[id], "no authorized source", list.filter((c) => c.videoId === id).map((c) => c.sentence.id).join(","));
      blocked.push(`${id} "${videos[id]?.title}": no authorized source. Get the file from ${videos[id]?.channel} (links in build/yt/wanted.json), then \`source\`, \`import\` or \`authorize\``);
      continue;
    }
    try { await fetchRaw(id, src); log("download", `${id}: ready (${authorizedSource(id, src)})`); }
    catch (e) { blocked.push(`${id}: ${e.message}`); }
  }
  for (const b of blocked) log("download", `  blocked ${b}`);
  log("download", `${ids.length - blocked.length}/${ids.length} source videos ready in build/yt/raw/`);
}

// ---------- scene review of a downloaded video ----------
function cutsOf(file) {
  const r = ffmpeg(["-i", file, "-vf", "select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"], { capture: true });
  return [...(r.stderr ?? "").matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
}
function scenes() {
  const [id] = pos; const file = rawFile(id) ?? fail(`${id} is not downloaded`);
  const dur = probeDuration(file) ?? 60, n = 24, step = dur / n;
  fs.mkdirSync(F.review, { recursive: true });
  ffmpeg(["-i", file, "-vf", `fps=1/${step.toFixed(3)},scale=320:-2,tile=6x4:padding=4`, "-frames:v", "1", path.join(F.review, `${id}.jpg`)]);
  const cuts = cutsOf(file);
  const v = load("videos", {}); v[id] = { ...v[id], cuts }; save("videos", v);
  log("scenes", `build/yt/review/${id}.jpg: tile k (1-24, left to right) is at ${Array.from({ length: n }, (_, k) => `${k + 1}=${mmss(k * step)}`).join(" ")}`);
  log("scenes", `internal cuts: ${cuts.map(mmss).join(" ") || "none"} - keep a clip between two cuts`);
}

// ---------- 6. FFmpeg clip extractor ----------
async function extract() {
  const lic = loadLicenses(), videos = load("videos", {});
  const list = chosen();
  if (!list.length) fail("Nothing picked: pick <L003> <videoId> <start>, or extract --auto");
  const clips = path.join(F.pkg, "clips"); fs.mkdirSync(clips, { recursive: true });
  for (const f of fs.readdirSync(clips)) fs.unlinkSync(path.join(clips, f)); // the folder always mirrors the current picks
  const made = [];
  for (const c of list) {
    const id = c.videoId, l = lic[id];
    if (!usable(l)) { log("extract", `${c.sentence.id}: ${id} license ${l?.status ?? "unverified"} - skipped`); continue; }
    const file = rawFile(id); if (!file) { log("extract", `${c.sentence.id}: ${id} not downloaded - skipped`); continue; }
    const dur = probeDuration(file) ?? videos[id]?.duration ?? 0;
    let start = Math.max(0, Math.min(c.start, dur - 1)), end = Math.min(c.end, dur);
    // No chapter and no manual pick: CLIP scans the whole video for the stretch that shows the keyword.
    if (!picksManual(c) && c.match?.timestamp !== "chapter" && !flag("no-vision")) {
      const bm = await bestMoment(file, c.sentence.keywords[0] ?? c.sentence.text, end - start, { duration: dur });
      if (bm && bm.score >= 0.4) { const len = end - start; start = bm.start; end = Math.min(dur, start + len); log("extract", `${c.sentence.id}: best moment ${mmss(start)} (vision ${bm.score}, ${bm.scanned} frames)`); }
    }
    const cuts = videos[id]?.cuts ?? cutsOf(file); // no internal cut inside a clip
    const inside = cuts.find((t) => t > start + 0.3 && t < end - 0.3);
    if (inside != null) { if (inside - start >= 2) end = inside - 0.05; else start = inside + 0.05; }
    if (end - start < 1) { log("extract", `${c.sentence.id}: clip under 1 s after cut detection - pick another time`); continue; }
    const name = `${String(c.order).padStart(3, "0")}_${c.sentence.id}_${slug(c.sentence.keywords[0] ?? c.sentence.text)}_${id}_${fileTime(start)}-${fileTime(end)}.mp4`;
    const r = ffmpeg(["-ss", start.toFixed(2), "-to", end.toFixed(2), "-i", file,
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      ...(flag("keep-audio") ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]), "-movflags", "+faststart", path.join(clips, name)]);
    if (r.status !== 0) { log("extract", `${c.sentence.id}: ffmpeg failed`); continue; }
    made.push({ ...c, start, end, file: `clips/${name}` });
    log("extract", `${name}`);
  }
  writeJson(path.join(F.pkg, ".extracted.json"), made.map(({ sentence, ...m }) => ({ ...m, sentenceId: sentence.id })));
  log("extract", `${made.length}/${list.length} clips in build/yt/package/clips/${flag("keep-audio") ? "" : " (silent: original audio dropped, it may hold third-party music)"}`);
}

// ---------- 7. Final editing package ----------
function pack() {
  const sc = load("script", { sentences: [] }), lic = loadLicenses(), src = loadSources();
  const made = readJson(path.join(F.pkg, ".extracted.json"), null) ?? fail("Run extract first");
  const byId = Object.fromEntries(sc.sentences.map((s) => [s.id, s]));
  const rows = made.map((m) => {
    const l = lic[m.videoId], s = src[m.videoId] ?? {};
    return { order: m.order, sentence: m.sentenceId, text: byId[m.sentenceId]?.text, clip: m.file, seconds: +(m.end - m.start).toFixed(2),
      videoId: m.videoId, title: l.title, channel: l.channel, sourceUrl: ytUrl(m.videoId, m.start), start: mmss(m.start), end: mmss(m.end),
      confidence: m.match?.confidence ?? null, picked: m.auto ? "auto" : "manual", license: l.checks.licenseName, licenseStatus: l.status,
      obtainedFrom: s.official ? `official file ${s.official}` : s.imported ? "file from the maker (imported)" : s.authorization ? `yt-dlp, ${s.authorization.type}: ${s.authorization.note}` : "unknown",
      attribution: l.attribution };
  });
  writeJson(path.join(F.pkg, "manifest.json"), { createdAt: new Date().toISOString(), script: sc.source, clips: rows });
  const csv = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const cols = ["order", "sentence", "clip", "start", "end", "seconds", "confidence", "title", "channel", "sourceUrl", "license", "licenseStatus", "obtainedFrom", "text"];
  fs.writeFileSync(path.join(F.pkg, "sources.csv"), "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csv(r[c])).join(","))].join("\r\n"));
  const used = [...new Set(rows.map((r) => r.videoId))];
  const lines = ["# License records", "", `Generated ${new Date().toISOString()}. One record per source video; keep this file with the project.`, ""];
  for (const id of used) {
    const l = lic[id], s = src[id] ?? {};
    lines.push(`## ${l.title}`, "", `- Video: ${l.url}`, `- Uploader: ${l.channel} (${l.channelUrl}), published ${l.publishedAt?.slice(0, 10)}`,
      `- License: ${l.checks.licenseName} - ${CC_BY.url}`, `- Commercial use: ${l.checks.commercialUse ? "allowed" : "NO"} | Changes: ${l.checks.derivatives ? "allowed" : "NO"} | Attribution: required`,
      `- Uploader made it: ${l.human ? `${l.human.decision} by a person on ${l.human.at.slice(0, 10)}${l.human.note ? ` - ${l.human.note}` : ""}` : l.checks.sourcePermission}`,
      `- Red flags: ${l.flags.join("; ") || "none"}`, ...(l.notes.length ? [`- Notes: ${l.notes.join("; ")}`] : []),
      `- File obtained: ${s.official ? `official file ${s.official}` : s.imported ? "from the maker, imported" : s.authorization ? `${s.authorization.type} - ${s.authorization.note}` : "unknown"}`,
      `- Checked: ${l.evidence.checkedAt} (YouTube API: license=${l.evidence.license}, licensedContent=${l.evidence.licensedContent})`,
      `- Clips: ${rows.filter((r) => r.videoId === id).map((r) => `${r.clip} (${r.start}-${r.end})`).join(", ")}`, "");
  }
  fs.writeFileSync(path.join(F.pkg, "LICENSES.md"), lines.join("\n"));
  fs.writeFileSync(path.join(F.pkg, "ATTRIBUTION.txt"), ["Footage (Creative Commons Attribution):", ...used.map((id) => `- ${lic[id].attribution}`)].join("\n") + "\n");
  // Beats for project.json: copy clips/ into public/clips/ and paste these into the scenes.
  const beats = rows.map((r) => ({ sentence: r.sentence, beat: { on: String(r.text ?? "").split(/\s+/).slice(0, 4).join(" "), kw: [`file:${r.clip}`], credit: r.attribution } }));
  writeJson(path.join(F.pkg, "beats.json"), beats);
  const missing = sc.sentences.filter((s) => !rows.some((r) => r.sentence === s.id)).map((s) => s.id);
  fs.writeFileSync(path.join(F.pkg, "README.txt"), [
    "Falcon Motion editing package", "",
    "clips/          footage, numbered in script order: <order>_<sentence>_<keyword>_<videoId>_<start>-<end>.mp4 (1080p30 H.264)",
    "manifest.json   every clip with its sentence, source link at the exact second, confidence and license",
    "sources.csv     the same as a spreadsheet",
    "LICENSES.md     one license record per source video (what was checked, when, how the file was obtained)",
    "ATTRIBUTION.txt paste into the video description - CC BY requires it",
    "beats.json      project.json beats (file: + credit) for the faceless-video-editor pipeline", "",
    missing.length ? `Sentences without a CC clip (cover with stock, archive or a graphic): ${missing.join(", ")}` : "Every sentence has a clip.", "",
  ].join("\n"));
  log("package", `build/yt/package/: ${rows.length} clips from ${used.length} videos, manifest, sources.csv, LICENSES.md, ATTRIBUTION.txt${missing.length ? ` - ${missing.length} sentences uncovered` : ""}`);
}

function statusCmd() {
  const sc = load("script", { sentences: [] }), m = load("matches", {}), lic = loadLicenses(), picks = load("picks", {});
  for (const s of sc.sentences) {
    const p = picks[s.id], best = m[s.id]?.[0], id = p?.videoId ?? best?.videoId;
    console.log(`${s.id} ${s.refined ? " " : "*"} ${p ? "picked" : best ? `best ${best.confidence}` : "no match"}${id ? ` ${id} [${lic[id]?.status ?? "unverified"}]${rawFile(id) ? " downloaded" : ""}` : ""}  ${s.text.slice(0, 60)}`);
  }
  console.log("* = draft keywords");
}

const run = {
  analyze: () => analyze(pos[0]), search, match, verify, download, extract, package: pack, pick, scenes, source: setSource, import: importFile, authorize,
  approve: () => human("approve"), reject: () => human("reject"), status: statusCmd,
  run: async () => { analyze(pos[0]); await search(); await match(); verify(); await match(); log("run", "Next: review build/yt/matches.md, pick, then download -> extract -> package"); },
}[cmd];
if (!run) { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); process.exit(cmd ? 1 : 0); }
await run();
clearVisionTmp();
