// Live status page: build/status.html, open it in a browser while the pipeline
// runs - it reloads itself every few seconds. Every script reports through
// status() (step, progress, numbers) and every log line lands in it too, so the
// page shows what is happening now, how far along it is, the storyboard pages
// and what still needs fixing.
import fs from "node:fs";
import path from "node:path";

let BUILD = null;
const STEPS = ["lint", "voice", "broll", "timeline", "storyboard", "audio", "render", "master", "check", "thumbnail"];
const NAMES = {
  lint: "Script check", voice: "Voice", broll: "Footage", timeline: "Timeline", storyboard: "Storyboard",
  audio: "Music & SFX", render: "Render", master: "Loudness", check: "Final check", thumbnail: "Thumbnail",
};

export function statusInit(buildDir) {
  BUILD = buildDir;
}

const read = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(BUILD, "status.json"), "utf8"));
  } catch {
    return {};
  }
};

// Merge a patch into build/status.json and redraw build/status.html. Never throws:
// a status page must not be able to break a render.
export function status(patch = {}, logLine = null) {
  if (!BUILD) return;
  try {
    fs.mkdirSync(BUILD, { recursive: true });
    const s = read();
    Object.assign(s, patch, { updated: Date.now() });
    if (logLine) s.log = [...(s.log ?? []).slice(-60), `${new Date().toTimeString().slice(0, 8)}  ${logLine}`];
    fs.writeFileSync(path.join(BUILD, "status.json"), JSON.stringify(s, null, 2));
    fs.writeFileSync(path.join(BUILD, "status.html"), html(s));
  } catch {}
}

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mins = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)}s`);

function html(s) {
  const steps = s.steps ?? STEPS;
  const doneSet = new Set(s.done ?? []);
  const live = !s.finished && !s.failed;
  const pct = s.progress != null ? Math.max(0, Math.min(100, Math.round(s.progress * 100))) : null;
  const stepRows = steps.map((k) => {
    const state = s.failed && s.step === k ? "fail" : doneSet.has(k) ? "done" : s.step === k ? "now" : "todo";
    const icon = { done: "✓", now: "●", fail: "✕", todo: "" }[state];
    return `<li class="${state}"><span class="dot">${icon}</span>${esc(NAMES[k] ?? k)}${state === "now" && pct != null ? ` <b>${pct}%</b>` : ""}</li>`;
  }).join("");
  const stats = Object.entries(s.stats ?? {}).map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
  const boards = (s.storyboard ?? []).map((f) => `<a href="storyboard/${esc(f)}" target="_blank"><img src="storyboard/${esc(f)}?t=${s.updated}" alt="${esc(f)}"></a>`).join("");
  const issues = (s.issues ?? []).map((w) => `<li>${esc(w)}</li>`).join("");
  const log = (s.log ?? []).slice(-25).reverse().map((l) => `<div>${esc(l.replace(/\x1b\[[0-9;]*m/g, ""))}</div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${live ? '<meta http-equiv="refresh" content="4">' : ""}
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(pct != null && live ? `${pct}% · ` : "")}${esc(s.title ?? "Video")} - edit status</title>
<style>
:root { --bg:#0e1015; --card:#171a22; --line:#262b36; --text:#e8eaf0; --muted:#8a93a6; --accent:#f2b544; --ok:#34d399; --bad:#f87171; }
* { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:1100px; margin:0 auto; padding:24px 16px 60px }
h1 { font-size:22px; margin:0 0 4px } .sub { color:var(--muted); margin-bottom:20px }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px }
.now-line { font-size:17px; margin-bottom:10px } .bar { height:10px; background:var(--line); border-radius:99px; overflow:hidden }
.bar i { display:block; height:100%; background:var(--accent); width:${pct ?? 0}%; transition:width .5s }
.eta { color:var(--muted); margin-top:8px; font-size:14px }
ol { list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:8px }
ol li { padding:6px 12px; border-radius:99px; border:1px solid var(--line); color:var(--muted); display:flex; gap:6px; align-items:center; font-size:14px }
ol li.done { color:var(--ok); border-color:#1f4d3d } ol li.now { color:var(--text); border-color:var(--accent); background:#2a2312 } ol li.fail { color:var(--bad); border-color:#5a2424 }
.dot { width:14px; text-align:center } ol li b { color:var(--accent) }
.stats { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px }
.stat { background:#11141b; border:1px solid var(--line); border-radius:10px; padding:10px 12px } .stat b { display:block; font-size:22px } .stat span { color:var(--muted); font-size:13px }
.boards { display:grid; gap:10px } .boards img { width:100%; border-radius:8px; border:1px solid var(--line); display:block }
.issues li { margin-bottom:4px; color:#fcd9a0 } .log { font:12.5px/1.6 ui-monospace, Consolas, monospace; color:#b8c0d0; max-height:340px; overflow:auto; white-space:pre-wrap }
h2 { font-size:15px; margin:0 0 10px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.06em }
.final { color:var(--ok); font-size:17px } .failed { color:var(--bad); font-size:17px }
</style></head><body><main>
<h1>${esc(s.title ?? "Video")}</h1>
<div class="sub">Updated ${esc(new Date(s.updated ?? Date.now()).toLocaleTimeString())}${live ? " · refreshes every 4 seconds" : ""}</div>
<div class="card">
  ${s.finished ? `<div class="final">✓ Finished: ${esc(s.output ?? "out/final.mp4")}</div>` : s.failed ? `<div class="failed">✕ Stopped at ${esc(NAMES[s.step] ?? s.step)}: ${esc(s.failed)}</div>` : `<div class="now-line">${esc(s.doing ?? "Working…")}</div>`}
  ${pct != null && live ? `<div class="bar"><i></i></div>` : ""}
  ${s.etaSec != null && live ? `<div class="eta">About ${esc(mins(s.etaSec))} left in this step</div>` : ""}
</div>
<div class="card"><h2>Steps</h2><ol>${stepRows}</ol></div>
${stats ? `<div class="card"><h2>So far</h2><div class="stats">${stats}</div></div>` : ""}
${issues ? `<div class="card"><h2>Needs fixing</h2><ul class="issues">${issues}</ul></div>` : ""}
${boards ? `<div class="card"><h2>Storyboard: every shot with its words</h2><div class="boards">${boards}</div></div>` : ""}
<div class="card"><h2>Log</h2><div class="log">${log}</div></div>
</main></body></html>`;
}
