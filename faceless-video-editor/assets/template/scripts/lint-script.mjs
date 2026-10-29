// Script gate: checks the hook, pacing budget, emphasis/highlight use, B-roll
// keywords and the ending BEFORE any voice or render time is spent.
// Usage: node scripts/lint-script.mjs [--strict]   (--strict exits 1 on errors)
// The rules are practitioner defaults (see references/editing-playbook.md), not
// laws: fix errors, read warnings, and override with judgement when the story needs it.
import fs from "node:fs";
import path from "node:path";
import { PUBLIC, SFX_NAMES, brollEntries, findPhrase, log, planShots, readProject, stripMarkup } from "./lib.mjs";

const strict = process.argv.includes("--strict");
const p = readProject();
const shorts = p.format === "shorts";
const errors = [], warnings = [], notes = [];
const words = (t) => stripMarkup(t).trim().split(/\s+/).filter(Boolean);
const lower = (t) => stripMarkup(t).toLowerCase();

// Indic scripts are spoken a little slower per word.
const allText = p.scenes.map((s) => s.text).join(" ");
const indic = /[ঀ-৿ऀ-ॿ]/.test(allText);
const rate = parseFloat(String(p.voice.rate ?? "+0%")) || 0;
const wps = (indic ? 2.2 : 2.3) * (1 + rate / 100) * (p.voice.provider === "file" ? 1.05 : 1);
const est = p.scenes.map((s) => words(s.text).length / wps);
const starts = est.reduce((a, d, i) => [...a, (a[i] ?? 0) + d], [0]);
const total = starts[starts.length - 1];
const at = (i) => `scene ${i + 1} (~${Math.round(starts[i])}s)`;

// ---------- hook ----------
const BANNED = [
  "did you know", "in this video", "hey guys", "hi guys", "hello everyone", "hi everyone", "welcome back", "welcome to",
  "have you ever wondered", "today we", "today i", "today, we", "let's talk about", "let me tell you", "before we start",
  "before we begin", "don't forget to", "make sure to subscribe", "in today's video", "so today",
  "আজকে আমরা", "আজ আমরা", "এই ভিডিওতে", "হ্যালো", "বন্ধুরা", "আসসালামু আলাইকুম",
  "आज हम", "इस वीडियो में", "दोस्तों", "नमस्ते",
];
const hookScene = p.scenes[0];
const firstSentence = stripMarkup(hookScene.text).split(/(?<=[.!?।])\s+/)[0];
const hookLower = lower(firstSentence);
const banned = BANNED.find((b) => hookLower.startsWith(b) || hookLower.includes(` ${b}`) && hookLower.indexOf(b) < 12);
if (banned) errors.push(`hook opens with "${banned}" - viewers swipe on warm-ups. Start with the claim, the stakes or the question.`);
const hookLen = words(firstSentence).length;
const hookMax = shorts ? 14 : 24;
if (hookLen > hookMax) errors.push(`hook sentence is ${hookLen} words (max ${hookMax}): it must land in ~${shorts ? 3 : 6}s. Cut it.`);
const TENSION = /\d|\?|\b(you|your|never|nobody|no one|secret|mistake|wrong|actually|why|how|stop|worst|only|until|but|truth|hidden|lie|dead|died|lost|million|billion)\b/i;
if (!indic && !TENSION.test(firstSentence)) warnings.push("hook has no tension signal (a number, 'you', a contrast, a question, a stake). Flat hooks lose the swipe test.");
if (shorts && !hookScene.emphasis) warnings.push("scene 1 has no emphasis: Shorts need readable hook text on frame 0 (muted autoplay).");
if (hookScene.emphasis && words(hookScene.emphasis).length > 5) warnings.push("hook emphasis over 5 words - it has to be readable in under a second.");
if (hookScene.visual === "kinetic" && shorts) warnings.push("hook scene uses the kinetic fallback - give it the most striking footage you have.");

// ---------- budget & scene sizes ----------
if (p.targetSeconds) {
  const off = (total - p.targetSeconds) / p.targetSeconds;
  if (Math.abs(off) > 0.15) warnings.push(`estimated ${Math.round(total)}s vs targetSeconds ${p.targetSeconds} (${off > 0 ? "+" : ""}${Math.round(off * 100)}%): ${off > 0 ? "cut" : "add"} ~${Math.abs(Math.round((total - p.targetSeconds) * wps))} words.`);
}
if (shorts && total > 60) warnings.push(`estimated ${Math.round(total)}s - over 60s for a Short. 30-45s is the sweet spot.`);
p.scenes.forEach((s, i) => {
  const n = words(s.text).length;
  if (n > (shorts ? 28 : 55)) warnings.push(`${at(i)}: ${n} words in one scene - split it so the picture and captions can change.`);
  for (const sent of stripMarkup(s.text).split(/(?<=[.!?।])\s+/)) {
    if (words(sent).length > 26) warnings.push(`${at(i)}: a ${words(sent).length}-word sentence - written for reading, not listening. Break it up.`);
  }
});

// ---------- emphasis & highlights ----------
const emph = p.scenes.filter((s) => s.emphasis).length;
if (emph > Math.ceil(p.scenes.length / (shorts ? 2.5 : 4))) warnings.push(`${emph}/${p.scenes.length} scenes have emphasis - when everything is big, nothing is. Keep it for numbers, reveals and the CTA.`);
p.scenes.forEach((s, i) => {
  if (s.emphasis && words(s.emphasis).length > 5) warnings.push(`${at(i)}: emphasis "${s.emphasis}" is over 5 words.`);
  if (i > 0 && s.emphasis && p.scenes[i - 1].emphasis && !s.badge) warnings.push(`${at(i)}: emphasis on back-to-back scenes - space them out.`);
  const marks = (s.text.match(/\*[^*]+\*/g) ?? []).length;
  if (marks > Math.max(2, words(s.text).length / 6)) warnings.push(`${at(i)}: ${marks} *highlights* - one or two per scene, on the words that carry the point.`);
});
const hlTotal = (allText.match(/\*[^*]+\*/g) ?? []).length;
if (!hlTotal && p.punchIns) notes.push("no *highlighted* words: mark 1-2 power words per scene (*never*, *$4,000*) to get accent captions and punch-in zooms.");

// ---------- B-roll keywords ----------
const ABSTRACT = /^(success|motivation|happiness|love|life|time|money|business|freedom|power|growth|mindset|future|idea|ideas|thinking|concept|problem|solution|change|truth|fear|hope|dream|dreams|goal|goals|wealth|knowledge|history|science|technology)$/i;
const kwCount = new Map();
let plainScenes = 0;
p.scenes.forEach((s, i) => {
  if (s.visual === "kinetic") return;
  if (!s.broll?.length) warnings.push(`${at(i)}: no broll keywords - this scene will be the kinetic fallback.`);
  const entries = brollEntries(s);
  const toks = words(s.text);
  // Beats: each "on" phrase must be in the line, in order, so the shot can start on it.
  let from = 0;
  for (const [k, e] of entries.entries()) {
    if (!e.kw.length) errors.push(`${at(i)}: beat ${k + 1} has no "kw".`);
    if (e.on == null) continue;
    const idx = findPhrase(toks, e.on, from, true);
    if (idx < 0) {
      errors.push(findPhrase(toks, e.on, 0, true) >= 0
        ? `${at(i)}: beat "${e.on}" is out of order - beats follow the line.`
        : `${at(i)}: beat "${e.on}" is not in the line word for word - copy the words exactly.`);
    } else from = idx + 1;
    if (e.sfx) {
      const f = typeof e.sfx === "string" ? e.sfx : e.sfx.file;
      if (!SFX_NAMES.includes(f) && !fs.existsSync(path.join(PUBLIC, f ?? ""))) warnings.push(`${at(i)}: beat "${e.on}" sfx ${f} is not in public/ yet - download it before the timeline step.`);
    }
  }
  if (entries.length > 1 && s.layout !== "split" && entries.some((e) => e.on == null)) {
    plainScenes++;
    if (indic) warnings.push(`${at(i)}: English keywords can't be matched to the words of this line - give every beat an "on" phrase from the line.`);
  }
  // Rough timing from reading speed: beats that would flash by.
  if (s.layout !== "split" && entries.length > 1) {
    const est = toks.map((w, j) => ({ text: w, startMs: (j / wps) * 1000, endMs: ((j + 0.8) / wps) * 1000 }));
    for (const n of planShots(s, { durationMs: (toks.length / wps) * 1000, words: est }, p.maxShotSeconds).notes) warnings.push(`${at(i)}: ${n} (estimated)`);
  }
  const amb = typeof s.ambience === "string" ? s.ambience : s.ambience?.file;
  if (amb && amb !== "none" && !fs.existsSync(path.join(PUBLIC, amb))) warnings.push(`${at(i)}: ambience ${amb} is not in public/ yet.`);
  for (const k of entries.flatMap((e) => e.kw)) {
    if (k.startsWith("file:")) continue;
    const q = k.replace(/^photo:/, "").trim();
    kwCount.set(q, (kwCount.get(q) ?? 0) + 1);
    if (q.split(/\s+/).length === 1) warnings.push(`${at(i)}: keyword "${q}" is one word - add subject + action + setting ("${q} close up night").`);
    else if (q.split(/\s+/).every((w) => ABSTRACT.test(w))) warnings.push(`${at(i)}: keyword "${q}" is abstract - stock search needs something filmable.`);
  }
  if (s.layout === "split" && (s.broll?.length ?? 0) < 2) warnings.push(`${at(i)}: split layout needs two broll entries (left/top and right/bottom).`);
});
if (plainScenes) notes.push(`${plainScenes} scene(s) use plain keyword strings: they are matched to the line automatically, but beats ({"on": "words from the line", "kw": [...]}) put each shot exactly on its words.`);
if (p.voice.provider === "openai") warnings.push('voice.provider "openai" has no word timestamps (they are estimated), so shots and captions can drift off the words. Use edge or elevenlabs for exact sync.');
const allKw = p.scenes.flatMap((sc) => brollEntries(sc).flatMap((e) => e.kw));
const aiShots = allKw.filter((k) => k.startsWith("ai:")).length;
if (aiShots) notes.push(`${aiShots} ai: images: fine for illustration; never to depict a real event or person. Tick YouTube's altered/synthetic disclosure if they look real.`);
const realNoArchive = allKw.filter((k) => !/^(archive|photo|file|ai):/.test(k) && (/\b(1[5-9]\d\d|20\d\d)\b/.test(k) || /\s[A-Z][a-z]/.test(k)));
if (realNoArchive.length) notes.push(`keywords naming real things (${realNoArchive.slice(0, 3).map((k) => `"${k}"`).join(", ")}): consider archive: for accurate imagery (Wikimedia/NASA).`);
for (const [k, n] of kwCount) if (n > (shorts ? 3 : 8)) warnings.push(`keyword "${k}" used ${n} times - viewers notice repeated footage. Vary it.`);

// ---------- pattern interrupts ----------
// Something bigger than a cut: emphasis, badge, lower third, fx, split, look change, chapter.
const interrupt = (s, i) => s.emphasis || s.badge || s.lowerThird || s.fx || s.layout === "split" || s.chapterStart ||
  (i > 0 && (s.look ?? "normal") !== (p.scenes[i - 1].look ?? "normal")) || /\*/.test(s.text);
const gapMax = shorts ? 12 : 90;
let lastI = 0;
p.scenes.forEach((s, i) => {
  if (i > 0 && interrupt(s, i)) {
    if (starts[i] - starts[lastI] > gapMax) warnings.push(`~${Math.round(starts[lastI])}s-${Math.round(starts[i])}s: ${Math.round(starts[i] - starts[lastI])}s without a pattern interrupt (max ~${gapMax}s). Add an emphasis, badge, lower third, look change or fx.`);
    lastI = i;
  }
});
if (total - starts[lastI] > gapMax) warnings.push(`~${Math.round(starts[lastI])}s-end: ${Math.round(total - starts[lastI])}s without a pattern interrupt.`);

// ---------- long form structure ----------
if (!shorts) {
  if (p.chapters.length < 3 && total > 300) warnings.push("fewer than 3 chapters - YouTube needs 3+ for chapter markers, and chapters give viewers a reason to stay.");
  const ch0 = p.scenes.reduce((n, s, i) => (s.chapter === 0 ? n + est[i] : n), 0);
  if (ch0 > 90) warnings.push(`first chapter (cold open) is ~${Math.round(ch0)}s - keep it under 60-90s and end it on an open question.`);
  const rehook = p.scenes.some((s, i) => [].concat(s.fx ?? []).includes("reveal") && starts[i] / total > 0.3 && starts[i] / total < 0.7);
  if (total > 240 && !rehook) warnings.push('no rehook in the middle (30-70% of runtime): add fx "reveal" on the scene that raises the stakes ("but that was not the strangest part...").');
}

// ---------- ending ----------
const endText = lower(p.scenes[p.scenes.length - 1].text);
if (/(thanks for watching|thank you for watching|see you (next time|in the next)|that's it for today|ধন্যবাদ সবাইকে)/.test(endText)) {
  warnings.push("ending says goodbye - viewers leave on the outro. End on the payoff, a loop line, or one CTA.");
}
if (shorts && !/(follow|subscribe|part 2|comment|\?)/.test(endText) && !p.loop) notes.push('Shorts end: add a CTA or write the last line to flow back into the first (set "loop": true to silence this).');

// ---------- report ----------
log("lint", `${p.scenes.length} scenes, ~${Math.round(total)}s at ~${(wps * 60).toFixed(0)} wpm, edit style ${p.editStyle}, hook: "${firstSentence.slice(0, 70)}"`);
for (const e of errors) console.log(`  \x1b[31mx ${e}\x1b[0m`);
for (const w of warnings) console.log(`  \x1b[33m! ${w}\x1b[0m`);
for (const n of notes) console.log(`  \x1b[36m- ${n}\x1b[0m`);
if (!errors.length && !warnings.length) log("lint", "script passes all checks");
if (strict && errors.length) process.exit(1);
