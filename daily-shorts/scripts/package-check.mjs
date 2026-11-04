// Packaging and retention gate for a daily Short (run before upload, after factcheck).
//   node <daily-shorts>/scripts/package-check.mjs           check project.json + the render
//   node <daily-shorts>/scripts/package-check.mjs --slot    print the next publish slot (US peak time)
// Exit 1 on a failure. Report: build/package-check.json.
//
// Retention: hook under 15 words with something concrete, picture from the first frame, on-screen
// hook text for muted viewers, 25-58 seconds, a tight loop ending.
// Packaging: honest searchable title (no tragedy bait), description with sources, hashtags,
// AI-voice disclosure, privacy matching the mode, publish time in US prime hours.
// Learning: project.daily.format / category / topic must be set, so yt-stats can tell what works.
import fs from "node:fs";
import path from "node:path";
import { BUILD, ROOT, cleanText, fail, flag, log, readJson, readProject, writeJson } from "./daily-lib.mjs";

export const FORMATS = ["breaking", "minute-by-minute", "mystery", "what-went-wrong", "on-this-day", "by-the-numbers"];
const PEAK = process.env.DAILY_PUBLISH_ET || "12:00"; // America/New_York

function nextSlot(hhmm = PEAK, minLeadMin = 60) {
  const [hh, mm] = hhmm.split(":").map(Number);
  for (let d = 0; d < 3; d++) {
    const day = new Date(Date.now() + d * 86400e3);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
    const off = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).formatToParts(day).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
    const iso = `${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${off}`;
    if (new Date(iso).getTime() > Date.now() + minLeadMin * 60e3) return iso;
  }
  return null;
}
if (flag("slot")) { console.log(nextSlot()); process.exit(0); }

const p = readProject();
const mode = (process.env.DAILY_MODE || "approval").toLowerCase();
const fails = [], warns = [];
const bad = (m) => fails.push(m), warn = (m) => warns.push(m);
const yt = p.youtube || {};
const facts = readJson(path.join(BUILD, "facts.json"), { facts: [], places: [] });

// ---------- learning tags ----------
const d = p.daily || {};
if (!FORMATS.includes(d.format)) bad(`set project.daily.format to one of: ${FORMATS.join(", ")}`);
if (!d.category) bad('set project.daily.category (e.g. "aviation", "missing-aircraft", "hurricane", "earthquake", "wildfire", "flood", "tornado")');
if (!d.topic) bad("set project.daily.topic (one line: the event)");

// ---------- hook and pacing ----------
const scenes = p.scenes.map((s) => cleanText(s.text));
const allWords = scenes.join(" ").split(/\s+/).filter(Boolean);
const hookSentence = scenes[0].split(/(?<=[.!?])\s/)[0];
const hookWords = hookSentence.split(/\s+/).length;
if (hookWords > 14) bad(`hook is ${hookWords} words - cut it to 14 or fewer ("${hookSentence}")`);
if (!/\d|\?|[A-Z][a-z]+\s+[A-Z0-9]/.test(hookSentence) && !/\b(never|vanished|disappeared|seconds|minutes|only|last)\b/i.test(hookSentence)) warn(`hook has nothing concrete (a number, a name, a question, a stake): "${hookSentence}"`);
if (allWords.length > 150) bad(`script is ${allWords.length} words - too long for a Short; cut to 110-140`);
else if (allWords.length < 70) warn(`script is only ${allWords.length} words - the story may feel thin`);
const vo = p.scenes.map((_, i) => readJson(path.join(BUILD, "vo", `s${String(i + 1).padStart(3, "0")}.json`), null));
const voiced = vo.every(Boolean);
const seconds = voiced ? vo.reduce((a, v) => a + (v.durationMs || 0), 0) / 1000 + (p.outroMs ?? 900) / 1000 : null;
if (seconds != null && seconds > 58) bad(`voice runs ${seconds.toFixed(1)} s - Shorts that finish under 58 s get watched to the end; cut words`);
if (seconds != null && seconds < 22) warn(`only ${seconds.toFixed(1)} s - very short`);
if (p.loop !== true) warn('set "loop": true and write the last line so it flows back into the first (replays count as views)');
if ((p.outroMs ?? 900) > 400) warn(`outroMs is ${p.outroMs ?? 900} ms - set it to 250-400 so the loop is seamless`);
const s1 = p.scenes[0];
const firstBeat = (s1.broll || []).find((b) => typeof b === "object");
const hookOnScreen = s1.emphasis || (s1.callouts || []).length || firstBeat?.graphic?.title || ["statement", "counter"].includes(firstBeat?.graphic?.type);
if (!hookOnScreen) warn("no on-screen hook text in scene 1 (emphasis, a text pop, or a titled graphic) - many viewers scroll with the sound off");
const tl = readJson(path.join(ROOT, "public", "timeline.json"), null);
if (tl?.scenes?.[0]?.shots?.[0]?.type === "kinetic") bad("the very first shot has no picture (kinetic fallback) - the first frame must show the subject");

// ---------- visuals: explain, don't fill ----------
if (tl) {
  const shots = tl.scenes.flatMap((sc) => sc.shots);
  const stock = (sh) => (sh.type === "video" || sh.type === "image") && /^(pixabay|coverr|pexels)/.test(sh.assetId ?? "");
  const graphics = shots.filter((sh) => sh.type === "graphic");
  const sec = tl.durationInFrames / tl.fps;
  if (sec >= 25 && graphics.length < 2) warn(`only ${graphics.length} explainer graphic(s) - use globe/map, radar, profile, aircraft, timeline or counter where footage can't show it (references/visuals.md)`);
  let run = 0, maxRun = 0;
  for (const sh of shots) { run = stock(sh) ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
  if (maxRun > 3) warn(`${maxRun} stock clips in a row - break them with an explainer or real footage`);
  for (let i = 1; i < graphics.length; i++) {
    const a = shots.indexOf(graphics[i - 1]), b = shots.indexOf(graphics[i]);
    if (b === a + 1 && graphics[i].graphic?.type === graphics[i - 1].graphic?.type) warn(`two ${graphics[i].graphic.type} graphics back to back - vary them`);
  }
  if (stock(shots[0] ?? {})) warn("the Short opens on generic stock footage - open on the globe, a map or real footage of the event");
  const kinetic = shots.filter((sh) => sh.type === "kinetic").length;
  if (kinetic) bad(`${kinetic} shot(s) have no picture (kinetic fallback) - give them footage or an explainer graphic`);
}

// ---------- title ----------
const title = yt.title ?? p.title ?? "";
if (!title) bad('no "youtube.title"');
if (title.length > 70) bad(`title is ${title.length} characters - keep it under 60`);
else if (title.length > 60) warn(`title is ${title.length} characters - under 60 shows in full`);
const BAIT = /\b(shocking|insane|you won'?t believe|gruesome|horrific|horrifying|graphic|disturbing|caught on camera|leaked|terrifying final|r\.?i\.?p)\b/i;
if (BAIT.test(title)) bad(`title uses tragedy bait ("${title.match(BAIT)[0]}") - YouTube limits ads and reach on these; use the concrete fact instead`);
const shout = (title.match(/\b[A-Z]{6,}\b/g) || []);
if (shout.length) warn(`title shouts (${shout.join(", ")}) - one capitalised word at most, or none`);
const factWords = new Set(JSON.stringify(facts).toLowerCase().match(/[a-z0-9]+/g) || []);
const titleNames = (title.match(/\b[A-Z][A-Za-z0-9-]+|\b\d[\d,]*/g) || []).slice(1);
if (titleNames.length && !titleNames.some((w) => factWords.has(w.toLowerCase().replace(/,/g, "")))) warn("title has no searchable name from the facts (place, airline, aircraft, storm name)");

// ---------- description, tags, disclosure ----------
const desc = String(yt.description || "");
const urls = desc.match(/https?:\/\/\S+/g) || [];
const factUrls = new Set((facts.facts || []).flatMap((f) => (f.sources || []).map((s) => s.url)));
if (!/sources?:/i.test(desc) || urls.filter((u) => factUrls.has(u.replace(/[).,]+$/, ""))).length < 2) bad('description needs a "Sources:" list with 2+ of the URLs from facts.json');
const firstLine = desc.split("\n")[0];
if (!firstLine || firstLine.length > 150) warn("description should open with one plain sentence about the event (it shows under the title)");
const tags = (yt.hashtags || []).map((h) => String(h).replace(/^#/, "").toLowerCase());
if (!tags.includes("shorts")) warn('add "shorts" to youtube.hashtags');
if (tags.length > 5) warn(`${tags.length} hashtags - 3 to 5 work better`);
if (!(yt.tags || []).length) warn("no youtube.tags - add 5-10 search terms (place, airline, aircraft type, event type)");
if (yt.syntheticMedia !== true) bad('set "youtube.syntheticMedia": true - the voice is AI and the video shows real events');
if (yt.madeForKids === true) bad("madeForKids must be false for news about accidents");

// ---------- privacy and timing ----------
if (mode === "approval" && (yt.privacy ?? "private") !== "private") bad(`approval mode: youtube.privacy must be "private" (is "${yt.privacy}")`);
if (mode === "auto") {
  if (!yt.publishAt && yt.privacy !== "public") bad('auto mode: set youtube.privacy "public", or "private" with youtube.publishAt (next slot: run with --slot)');
  if (yt.publishAt) {
    const t = new Date(yt.publishAt);
    if (!(t > new Date())) bad(`publishAt ${yt.publishAt} is not in the future`);
    const etHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(t));
    if (etHour < 10 || etHour > 21) warn(`publishAt is ${etHour}:00 New York time - US viewers are most active 11:00-21:00`);
  }
}

const report = { pass: fails.length === 0, fails, warns, words: allWords.length, seconds, hookWords, nextSlot: nextSlot(), at: new Date().toISOString() };
writeJson(path.join(BUILD, "package-check.json"), report);
for (const f of fails) console.log(`  \x1b[31m✗ ${f}\x1b[0m`);
for (const w of warns) console.log(`  \x1b[33m! ${w}\x1b[0m`);
log("package", report.pass ? `PASS${warns.length ? ` with ${warns.length} warning(s) - fix them unless there is a reason` : ""}` : `FAIL: ${fails.length} problem(s)`);
if (!fs.existsSync(path.join(ROOT, "out", "final.mp4"))) log("package", "note: no out/final.mp4 yet - run this again after the render");
process.exit(report.pass ? 0 : 1);
