// Render progress in the terminal, read from the newest build/*render*.log.
//   node scripts/progress.mjs           one snapshot
//   node scripts/progress.mjs --watch   redraws every 2 s until the render is done (Ctrl+C to stop)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
const watch = process.argv.includes("--watch");
const bar = (p, w = 30) => { const n = Math.round(Math.max(0, Math.min(1, p)) * w); return "[" + "█".repeat(n) + "·".repeat(w - n) + "]"; };
const pct = (p) => String(Math.floor(Math.max(0, Math.min(1, p)) * 100)).padStart(3) + "%";

function newestLog() {
  const logs = fs.readdirSync(BUILD).filter((n) => /render.*\.log$/.test(n) && !/\.err\./.test(n)).map((n) => path.join(BUILD, n));
  return logs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

// Render speed: frames per second measured between redraws (smoothed over ~20 s),
// plus the average the renderer itself reports after each finished part.
let last = null;
const speeds = [];
function speed(fr) {
  if (!fr) return null;
  const now = Date.now(), done = +fr[1], key = fr[2];
  if (last && last.key === key && done > last.done) speeds.push((done - last.done) / ((now - last.t) / 1000));
  else if (last && (last.key !== key || done < last.done)) speeds.length = 0;
  last = { done, t: now, key };
  while (speeds.length > 10) speeds.shift();
  return speeds.length ? speeds.reduce((a, b) => a + b) / speeds.length : null;
}

function draw() {
  const file = newestLog();
  if (!file) return { text: "No render log in build/.", done: true };
  const L = fs.readFileSync(file, "utf8").replace(/\x1b\[[0-9;]*m/g, "").split(/\r\n|\r|\n/).map((s) => s.trim()).filter(Boolean);
  const parts = {};
  let total = 5;
  for (const l of L) {
    const m = l.match(/^\[render\] part (\d+)\/(\d+) \(([^)]+)\)(.*)/);
    if (m) { total = +m[2]; parts[m[1]] = { range: m[3], state: /skipped/.test(m[4]) ? "reused" : /done/.test(m[4]) ? "done" : "run" }; }
  }
  const fr = [...L].reverse().map((l) => l.match(/Rendered (\d+)\/(\d+)(?:, time remaining: (.+))?/)).find(Boolean);
  const has = (re) => L.some((l) => re.test(l));
  const audio = has(/audio \(whole video/), joined = has(/\[render\] out\/video\.mp4/), master = has(/--- master ---/), check = has(/--- check ---/), done = has(/\[auto\] done/);
  const failed = L.find((l) => /^\[error\]|Error:/.test(l));
  const out = [];
  let partsSum = 0;
  for (let i = 1; i <= total; i++) {
    const p = parts[i];
    let f = 0, st = "waiting";
    if (p && p.state !== "run") { f = 1; st = p.state === "reused" ? "done (reused)" : "done"; }
    else if (p && audio) { f = 1; st = "done"; }
    else if (p) { f = fr ? fr[1] / fr[2] : 0; st = `rendering ${fr ? `${fr[1]}/${fr[2]} frames` : ""}${fr?.[3] ? `, ~${fr[3]} left` : ""}`; }
    partsSum += f;
    out.push(`Part ${i}`.padEnd(13) + bar(f) + " " + pct(f) + "  " + (p?.range ?? "").padEnd(12) + st);
  }
  const af = joined || master ? 1 : audio && fr ? fr[1] / fr[2] : 0;
  out.push("Audio track".padEnd(13) + bar(af) + " " + pct(af) + "  " + "".padEnd(12) + (joined || master ? "done" : audio ? `mixing ${fr ? `${fr[1]}/${fr[2]}` : ""}` : "waiting"));
  out.push("Finish".padEnd(13) + (done ? "done → out/final.mp4" : check ? "checking + thumbnail" : master ? "mastering to -14 LUFS" : joined ? "joining parts" : "waiting"));
  const overall = done ? 1 : (partsSum / total) * 0.62 + af * 0.3 + (master ? 0.04 : 0) + (check ? 0.02 : 0);
  out.push("", "OVERALL".padEnd(13) + bar(overall, 40) + " " + pct(overall));
  // Speed: live (between redraws) and the renderer's own average for the finished parts.
  const live = done || master ? null : speed(fr);
  const avg = [...L].reverse().map((l) => l.match(/done in \d+s - ([\d.]+) frames\/s/)).find(Boolean);
  out.push("SPEED".padEnd(13) + (live != null ? `${live.toFixed(1)} fps now` : watch && !done && !master ? "measuring…" : "-") + (avg ? `   ·   ${avg[1]} fps average (finished parts)` : ""));
  out.push("", `${path.basename(file)} · ${new Date().toLocaleTimeString()}`);
  if (failed && !done) out.push(`!! ${failed}`);
  return { text: out.join("\n"), done };
}

if (!watch) console.log(draw().text);
else {
  const tick = () => {
    const { text, done } = draw();
    process.stdout.write("\x1b[2J\x1b[H" + text + "\n\n(Ctrl+C to stop watching - the render keeps going)\n");
    if (done) process.exit(0);
  };
  tick();
  setInterval(tick, 2000);
}
