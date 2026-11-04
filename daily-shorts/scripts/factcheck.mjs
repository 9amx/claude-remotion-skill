// Fact gate: nothing goes out that build/facts.json does not back up.
//   node <daily-shorts>/scripts/factcheck.mjs          (in today's project folder)
// Exit 0 = pass, 1 = fail. Report: build/factcheck.json.
//
// build/facts.json (written during research):
// {
//   "event": "one line: what this Short is about",
//   "asOf": "2026-11-04T01:30:00Z",                 // when the facts were last checked
//   "facts": [
//     { "id": "f1", "kind": "event",                 // event | number | name | date | time | place | casualties | cause | status
//       "claim": "Delta Flight 2210, a Boeing 737-800, left Atlanta at 9:05 p.m. on Nov. 2.",
//       "sources": [
//         { "url": "https://www.ntsb.gov/...", "publisher": "NTSB", "quote": "a sentence copied word for word from that page" },
//         { "url": "https://apnews.com/...",   "publisher": "AP",   "quote": "..." } ] }
//   ],
//   "places": [ { "name": "Atlanta", "lat": 33.6407, "lon": -84.4277, "source": "https://..." } ]
// }
//
// Checks:
//  - every fact has 2+ sources on 2+ different sites, and at least one source whose page
//    could be opened and actually contains the quoted sentence (catches dead or made-up links
//    and misquotes); "cause" needs an official source (agency/investigator), "casualties" an
//    official source or 3 different sites
//  - every number, name and acronym in the voice script, on-screen text, graphics and the
//    YouTube title appears in the facts (spelled-out numbers count: "two" = 2)
//  - every map/globe place is in "places" with coordinates (within ~30 km)
//  - casualty and status facts are less than 24 hours old
import fs from "node:fs";
import path from "node:path";
import { BUILD, cleanText, fail, fetchText, htmlToText, isOfficial, log, readJson, readProject, siteOf, squash, words, writeJson } from "./daily-lib.mjs";

const facts = readJson(path.join(BUILD, "facts.json"), null);
if (!facts) fail("No build/facts.json. Write the verified facts with their sources first (see the header of this script).");
const project = readProject();
const fails = [], warns = [];
const bad = (m) => fails.push(m), warn = (m) => warns.push(m);

// ---------- 1. the facts themselves ----------
if (!Array.isArray(facts.facts) || !facts.facts.length) bad("facts.json has no facts");
const cacheFile = path.join(BUILD, "factcheck-cache.json");
const cache = readJson(cacheFile, {});
async function page(url) {
  const hit = cache[url];
  if (hit && Date.now() - hit.at < 12 * 3600e3) return hit;
  const r = await fetchText(url);
  const text = r.ok ? (/html|xml|text\/plain|json/i.test(r.type) ? htmlToText(r.text) : "") : "";
  const out = { at: Date.now(), status: r.status, error: r.error, text: squash(text).slice(0, 400000) };
  cache[url] = out;
  return out;
}
let verifiedSources = 0;
for (const f of facts.facts || []) {
  const id = f.id || f.claim?.slice(0, 40);
  if (!f.claim) { bad(`${id}: no "claim"`); continue; }
  const srcs = (f.sources || []).filter((s) => /^https?:\/\//.test(s.url || ""));
  const sites = new Set(srcs.map((s) => siteOf(s.url)).filter(Boolean));
  if (srcs.length < 2 || sites.size < 2) bad(`${id}: needs 2+ sources on 2+ different sites (has ${srcs.length} on ${sites.size}) - "${f.claim}"`);
  if (f.kind === "cause" && !srcs.some((s) => isOfficial(s.url))) bad(`${id}: a cause needs an official source (investigators/agency), not only news - "${f.claim}"`);
  if (f.kind === "casualties" && !srcs.some((s) => isOfficial(s.url)) && sites.size < 3) bad(`${id}: casualty numbers need an official source or 3+ different sites - "${f.claim}"`);
  let verified = 0;
  for (const s of srcs) {
    const p = await page(s.url);
    if (p.status === 404 || p.status === 410 || p.error === "ENOTFOUND") { bad(`${id}: dead link ${s.url} (${p.status || p.error})`); continue; }
    if (!p.status || p.status >= 400) { warn(`${id}: could not open ${s.url} (${p.status || p.error}) - not counted as verified`); continue; }
    if (!s.quote) { warn(`${id}: no "quote" for ${s.url} - copy the sentence that supports the claim`); continue; }
    if (p.text.length < 1500) { warn(`${id}: ${s.url} has almost no readable text (script-built page) - not counted as verified`); continue; }
    const q = squash(s.quote);
    const probe = q.length > 160 ? q.slice(0, 160).replace(/\s\S*$/, "") : q;
    if (p.text.includes(probe)) verified++;
    else bad(`${id}: the quote is not on ${s.url} - copy it word for word from the page ("${s.quote.slice(0, 80)}...")`);
  }
  verifiedSources += verified;
  if (srcs.length && !verified) bad(`${id}: no source could be confirmed (page opened and quote found) - add one that can be read, e.g. the agency page or AP`);
}
writeJson(cacheFile, cache);

// Fresh enough?
const ageH = facts.asOf ? (Date.now() - new Date(facts.asOf).getTime()) / 3600e3 : null;
if (ageH == null || !Number.isFinite(ageH)) bad('facts.json needs "asOf" (when the facts were checked, ISO time)');
else if ((facts.facts || []).some((f) => ["casualties", "status"].includes(f.kind)) && ageH > 24) bad(`casualty/status facts were checked ${Math.round(ageH)} h ago - check them again (they change) and update asOf`);
else if (ageH > 12) warn(`facts were checked ${Math.round(ageH)} h ago - re-check anything that may have changed`);

// ---------- 2. everything said or shown is covered ----------
const factText = squash([
  ...(facts.facts || []).flatMap((f) => [f.claim, ...(f.sources || []).map((s) => s.quote || "")]),
  ...(facts.places || []).map((p) => p.name),
].join(" ").replace(/(\d),(\d{3})/g, "$1$2"));
const factWords = new Set([...factText.split(" "), ...words(factText)]);

const shown = [];
const add = (where, t) => { if (t != null && String(t).trim()) shown.push({ where, text: cleanText(String(t)) }); };
project.scenes.forEach((sc, i) => {
  const s = `scene ${i + 1}`;
  add(`${s} voice`, sc.text);
  add(`${s} title`, sc.emphasis);
  (sc.callouts || []).forEach((c) => add(`${s} text pop`, c.text ?? c));
  if (sc.lowerThird) { add(`${s} name tag`, sc.lowerThird.title); add(`${s} name tag`, sc.lowerThird.subtitle); }
  add(`${s} label`, sc.badge);
  for (const b of sc.broll || []) {
    const g = typeof b === "object" ? b.graphic : null;
    if (!g) continue;
    const gw = `${s} ${g.type}`;
    for (const k of ["title", "label", "prefix", "suffix", "text", "kicker", "by", "caption"]) add(gw, g[k]);
    if (g.type === "counter") add(gw, g.value);
    (g.data || []).forEach((r) => add(gw, Array.isArray(r) ? r.join(" ") : r));
    (g.events || []).forEach((e) => add(gw, Array.isArray(e) ? e.join(" ") : e));
    (g.items || []).forEach((it) => add(gw, typeof it === "string" ? it : it.text));
    for (const side of [g.left, g.right]) if (side) { add(gw, side.label); (side.items || []).forEach((it) => add(gw, typeof it === "string" ? it : it.text)); }
    (g.places || []).forEach((p) => add(gw, typeof p === "string" ? p : p.label ?? p.name));
  }
});
add("YouTube title", project.youtube?.title ?? project.title);

const COMMON = new Set("I A An The This That These Those It Its He She They We You Our Your His Her Their And But Or So Then Now Here There When Where Why How What Who Which If In On At By For From To Of With Without After Before During Inside Over Under Into Out Up Down Just Only Even Still Yet No Not Nobody Nothing Every Everyone Some Someone Today Tonight Yesterday Tomorrow Minutes Hours Seconds Later Moments Seconds".split(" "));
const missing = new Map();
for (const { where, text } of shown) {
  const sentences = text.split(/(?<=[.!?:])\s+/);
  for (const sent of sentences) {
    const toks = sent.split(/\s+/).filter(Boolean);
    toks.forEach((raw, k) => {
      const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%]+$/gu, "");
      if (!w) return;
      const isNum = /\d/.test(w);
      const isAcr = /^[A-Z0-9]{2,}$/.test(w) && /[A-Z]/.test(w);
      const isName = /^\p{Lu}/u.test(w) && k > 0 && !COMMON.has(w);
      const spelled = !isNum && /^(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)$/i.test(w);
      if (!isNum && !isAcr && !isName && !spelled) return;
      // Whole tokens only: "10" must not pass because "2210" is in the facts.
      const parts = isNum ? w.replace(/,(\d{3})/g, "$1").split(/\D+/).filter(Boolean) : words(w);
      const ok = parts.every((p) => factWords.has(p.toLowerCase()));
      if (!ok) missing.set(`${w}|${where}`, { token: w, where });
    });
  }
}
for (const { token, where } of missing.values()) bad(`"${token}" (${where}) is not in facts.json - back it with a sourced fact, or take it out`);

// ---------- 3. map and globe places ----------
const known = (facts.places || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
for (const p of facts.places || []) if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !p.source) bad(`place "${p.name}" in facts.json needs lat, lon and a source`);
project.scenes.forEach((sc, i) => (sc.broll || []).forEach((b) => {
  const g = typeof b === "object" ? b.graphic : null;
  if (!g || !["map", "globe"].includes(g.type)) return;
  for (const p of g.places || []) {
    const name = typeof p === "string" ? p : p.name;
    if (typeof p !== "object" || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) { bad(`scene ${i + 1} ${g.type}: give "${name}" exact lat/lon (never geocode a name in a news Short)`); continue; }
    const k = known.find((x) => squash(x.name).startsWith(squash(name)) || squash(name).startsWith(squash(x.name)));
    if (!k) bad(`scene ${i + 1} ${g.type}: "${name}" is not in facts.json "places"`);
    else if (Math.abs(k.lat - p.lat) > 0.3 || Math.abs(k.lon - p.lon) > 0.3) bad(`scene ${i + 1} ${g.type}: "${name}" is at ${p.lat},${p.lon} but facts.json says ${k.lat},${k.lon}`);
  }
}));

// ---------- report ----------
const report = { pass: fails.length === 0, fails, warns, facts: (facts.facts || []).length, verifiedSources, checked: shown.length, at: new Date().toISOString() };
writeJson(path.join(BUILD, "factcheck.json"), report);
for (const f of fails) console.log(`  \x1b[31m✗ ${f}\x1b[0m`);
for (const w of warns) console.log(`  \x1b[33m! ${w}\x1b[0m`);
log("factcheck", report.pass ? `PASS - ${report.facts} facts, ${verifiedSources} source quotes confirmed on their pages` : `FAIL: ${fails.length} problem(s)`);
process.exit(report.pass ? 0 : 1);
