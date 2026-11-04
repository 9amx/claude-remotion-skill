// Voice gate: did the voice say exactly the script? (ElevenLabs v3 can skip, repeat or garble words.)
//   node <daily-shorts>/scripts/voicecheck.mjs          (in the project folder, after the voice step)
// Transcribes every scene's clip (public/vo/sNNN.mp3) with ElevenLabs Speech-to-Text and lines
// the words up with the scene text. Exit 1 when a scene drops or adds 2+ words in a row,
// misses a number, or more than 8% of a scene (6% overall) differs. Re-voice failed scenes
// (change the wording or seed slightly, delete build/vo/sNNN.json, run the voice step again).
// Report: build/voicecheck.json (per scene: what was said, every difference).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BUILD, ROOT, cleanText, fail, log, readJson, readProject, words, writeJson } from "./daily-lib.mjs";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) fail("ELEVENLABS_API_KEY is not set - the voice check transcribes with ElevenLabs Speech-to-Text.");
const project = readProject();
const cacheFile = path.join(BUILD, "voicecheck-cache.json");
const cache = readJson(cacheFile, {});

async function transcribe(file) {
  const buf = fs.readFileSync(file);
  const id = createHash("sha1").update(buf).digest("hex");
  if (cache[id]) return cache[id];
  const form = new FormData();
  form.append("model_id", "scribe_v1");
  form.append("language_code", project.voice?.language || "en");
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([buf], { type: "audio/mpeg" }), path.basename(file));
  for (let attempt = 1; ; attempt++) {
    const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body: form });
    if (r.ok) { const j = await r.json(); return (cache[id] = j.text || ""); }
    if (attempt >= 3 || (r.status < 500 && r.status !== 429)) fail(`ElevenLabs Speech-to-Text failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
  }
}

// Word alignment (Levenshtein with backtrace): equal / sub / del (in script, not said) / ins (said, not in script)
function align(a, b) {
  const n = a.length, m = b.length, d = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)]);
  for (let j = 1; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { ops.push({ op: a[i - 1] === b[j - 1] ? "eq" : "sub", want: a[i - 1], got: b[j - 1] }); i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { ops.push({ op: "del", want: a[i - 1] }); i--; }
    else { ops.push({ op: "ins", got: b[j - 1] }); j--; }
  }
  return ops.reverse();
}
// Same word written two ways ("p.m." / "pm", "boeing's" / "boeings", "ok" / "okay")
const same = (x, y) => x.replace(/[.']/g, "") === y.replace(/[.']/g, "") || (x === "ok" && y === "okay") || (x === "okay" && y === "ok");

const fails = [], warns = [], scenes = [];
let total = 0, errors = 0;
for (const [i, sc] of project.scenes.entries()) {
  const sid = `s${String(i + 1).padStart(3, "0")}`;
  const meta = readJson(path.join(BUILD, "vo", `${sid}.json`), null);
  const file = meta?.audio ? path.join(ROOT, "public", meta.audio) : null;
  if (!file || !fs.existsSync(file)) { fails.push(`${sid}: no voice clip yet - run the voice step first`); continue; }
  const said = await transcribe(file);
  const want = words(sc.text), got = words(said);
  const ops = align(want, got).map((o) => (o.op === "sub" && same(o.want, o.got) ? { ...o, op: "eq" } : o));
  const diff = ops.filter((o) => o.op !== "eq");
  total += want.length; errors += diff.length;
  const rate = want.length ? diff.length / want.length : 0;
  const where = `${sid} "${cleanText(sc.text).slice(0, 50)}..."`;
  // Runs of 2+ dropped or added words = a skipped phrase or a repeat
  let run = { op: null, n: 0, words: [] };
  const runs = [];
  for (const o of ops) {
    if ((o.op === "del" || o.op === "ins") && o.op === run.op) { run.n++; run.words.push(o.want ?? o.got); }
    else { if (run.n >= 2) runs.push(run); run = { op: o.op, n: 1, words: [o.want ?? o.got] }; }
  }
  if (run.n >= 2) runs.push(run);
  for (const r of runs) fails.push(`${where}: ${r.op === "del" ? "skipped" : "added/repeated"} "${r.words.join(" ")}"`);
  for (const o of diff) {
    if (o.op === "del" && /\d/.test(o.want)) fails.push(`${where}: the number "${o.want}" was not said`);
    else if (o.op === "sub" && (/\d/.test(o.want) || /\d/.test(o.got))) warns.push(`${where}: "${o.want}" heard as "${o.got}" - a number; make sure it is read right (write it the way it should be spoken)`);
    else if (o.op === "sub") warns.push(`${where}: "${o.want}" heard as "${o.got}"`);
  }
  if (rate > 0.08 && want.length >= 6) fails.push(`${where}: ${Math.round(rate * 100)}% of the words differ from the script`);
  scenes.push({ scene: sid, script: cleanText(sc.text), heard: said, differences: diff, rate: +rate.toFixed(3) });
}
writeJson(cacheFile, cache);
const overall = total ? errors / total : 0;
if (overall > 0.06) fails.push(`overall ${Math.round(overall * 100)}% of the words differ from the script`);
const report = { pass: fails.length === 0, fails, warns, overall: +overall.toFixed(3), scenes, at: new Date().toISOString() };
writeJson(path.join(BUILD, "voicecheck.json"), report);
for (const f of fails) console.log(`  \x1b[31m✗ ${f}\x1b[0m`);
for (const w of warns) console.log(`  \x1b[33m! ${w}\x1b[0m`);
log("voicecheck", report.pass ? `PASS - ${total} words, ${Math.round(overall * 1000) / 10}% differ (spelling of the transcript)` : `FAIL: ${fails.length} problem(s) - re-voice those scenes`);
process.exit(report.pass ? 0 : 1);
