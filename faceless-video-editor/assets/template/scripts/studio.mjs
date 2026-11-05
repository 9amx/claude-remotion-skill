// Studio: the editing app. node scripts/studio.mjs [--port=3300] [--open]
// Live preview of the real composition, multi-track timeline, inspector (motion,
// transitions, looks, color, speed, text, footage swap), mixer, render queue.
// Edits live in build/edits.json and are laid over the timeline by
// studio-overrides.mjs - in the page for instant preview, in build-timeline for
// the render - so nothing is lost when make-project.mjs rebuilds project.json.
// Live: one Server-Sent-Events stream pushes status, timeline and render changes.
// Localhost only; serves only this project's public/, build/ and out/ files.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { BUILD, PUBLIC, ROOT, log } from "./lib.mjs";

const args = process.argv.slice(2);
const port = Number(args.find((a) => a.startsWith("--port="))?.slice(7)) || 3300;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "out");
const CACHE = path.join(BUILD, "studio-cache");
fs.mkdirSync(CACHE, { recursive: true });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".txt": "text/plain; charset=utf-8" };
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + ".tmp", JSON.stringify(v, null, 2)); fs.renameSync(f + ".tmp", f); };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const sendJson = (res, code, data) => res.writeHead(code, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" }).end(JSON.stringify(data));
const body = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } }); });
const validShot = (k) => /^s\d{3}-\d+$/.test(String(k ?? ""));
const inside = (base, rel) => { try { const f = path.resolve(base, decodeURIComponent(rel)); return f.startsWith(base + path.sep) ? f : null; } catch { return null; } };

// ---------- files ----------
function serveFile(req, res, file, cache = "no-cache") {
  if (res.destroyed || res.writableEnded) return; // the page gave up on this request
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end("not found");
  const size = fs.statSync(file).size, type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start < 0 || start > end) return res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": cache });
    return pipeline(fs.createReadStream(file, { start, end }), res, () => {});
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": cache });
  pipeline(fs.createReadStream(file), res, () => {});
}

// ffmpeg off the main thread, 4 at a time, so the live feed never stalls.
const queue = [];
let running = 0;
const pending = new Map();
function ff(out, a) {
  if (pending.has(out)) return pending.get(out);
  const p = new Promise((resolve) => { queue.push({ a: ["-y", "-v", "error", ...a], resolve }); pump(); }).finally(() => pending.delete(out));
  pending.set(out, p);
  return p;
}
function pump() {
  while (running < 4 && queue.length) {
    const { a, resolve } = queue.shift();
    running++;
    spawn("ffmpeg", a, { stdio: "ignore", windowsHide: true }).on("error", () => {}).on("close", () => { running--; resolve(); pump(); });
  }
}

// Thumbnail of a picture or clip (at a second), 320 wide, cached.
async function thumb(req, res, rel, at) {
  const file = inside(PUBLIC, rel);
  if (!file || !fs.existsSync(file)) return res.writeHead(404).end();
  const vid = /.(mp4|mov|webm|mkv)$/i.test(file);
  if (!vid) at = 0;
  const out = path.join(CACHE, `t-${Buffer.from(rel).toString("base64url").slice(-90)}-${Math.round(at * 2)}-${Math.round(mtime(file))}.jpg`);
  if (!fs.existsSync(out)) {
    const vf = ["-frames:v", "1", "-vf", "scale=320:180:force_original_aspect_ratio=increase,crop=320:180", "-q:v", "5", out];
    await ff(out, [...(vid ? ["-ss", String(at)] : []), "-i", file, ...vf]);
    if (vid && !fs.existsSync(out)) await ff(out + "0", ["-i", file, ...vf]);
  }
  serveFile(req, res, fs.existsSync(out) ? out : null, "max-age=86400");
}

// Audio waveform PNG, cached.
async function wave(req, res, rel, w, color) {
  const file = inside(PUBLIC, rel);
  if (!file || !fs.existsSync(file)) return res.writeHead(404).end();
  const out = path.join(CACHE, `w-${Buffer.from(rel).toString("base64url").slice(-80)}-${w}-${color.slice(1)}-${Math.round(mtime(file))}.png`);
  if (!fs.existsSync(out)) await ff(out, ["-i", file, "-filter_complex", `aformat=channel_layouts=mono,showwavespic=s=${w}x80:colors=${color}:scale=sqrt`, "-frames:v", "1", out]);
  serveFile(req, res, fs.existsSync(out) ? out : null, "max-age=86400");
}

// ---------- the live preview bundle (the real composition) ----------
let playerBuild = null;
const newestIn = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newestIn(path.join(dir, e.name)) : mtime(path.join(dir, e.name))), 0);
async function buildPlayer() {
  const entry = path.join(HERE, "editor-player.tsx");
  const stamp = Math.max(newestIn(path.join(ROOT, "src")), mtime(entry));
  const out = path.join(BUILD, "studio-cache", "player.js");
  if (mtime(out) > stamp) return out;
  playerBuild ??= (async () => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const { build } = await import("esbuild");
    await build({ entryPoints: [entry], outfile: out, bundle: true, format: "iife", platform: "browser", target: "chrome100", minify: true, jsx: "automatic",
      absWorkingDir: ROOT, logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' }, banner: { js: "window.process=window.process||{env:{}};" },
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl" },
      // @remotion/three ships its own nested remotion; two copies crash the player. One copy for all.
      alias: { remotion: path.join(ROOT, "node_modules", "remotion") } });
    return out;
  })().finally(() => { playerBuild = null; });
  return playerBuild;
}

// ---------- edits + history ----------
const EDITS = path.join(BUILD, "edits.json");
const HIST = path.join(BUILD, "studio-history");
const readEdits = () => ({ shots: {}, scenes: {}, global: {}, cuts: {}, text: {}, ...(readJson(EDITS) ?? {}) });
function cleanEdits(e) {
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const out = { shots: {}, scenes: {}, global: obj(e.global), cuts: {}, text: {}, splits: {}, swaps: [] };
  const key = (k) => /^s\d{3}-\d+b?$/.test(String(k ?? ""));
  for (const [k, v] of Object.entries(obj(e.shots))) if (key(k) && Object.keys(obj(v)).length) out.shots[k] = v;
  for (const [k, v] of Object.entries(obj(e.splits))) if (validShot(k) && Number(v) >= 6) out.splits[k] = Math.round(Number(v));
  if (Array.isArray(e.swaps)) out.swaps = e.swaps.filter((p) => Array.isArray(p) && p.length === 2 && key(p[0]) && key(p[1]) && p[0].slice(0, 4) === p[1].slice(0, 4)).slice(0, 500);
  for (const [k, v] of Object.entries(obj(e.scenes))) if (/^s\d{3}$/.test(k) && Object.keys(obj(v)).length) out.scenes[k] = v;
  for (const [k, v] of Object.entries(obj(e.cuts))) if (validShot(k) && Number(v)) out.cuts[k] = Math.max(-150, Math.min(150, Math.round(Number(v))));
  for (const [k, v] of Object.entries(obj(e.text))) if (/^s\d{3}:(emphasis|badge|lowerThird|callout:\d+)$/.test(k) && typeof v === "string") out.text[k] = v.slice(0, 160);
  return out;
}
function saveEdits(next) {
  fs.mkdirSync(HIST, { recursive: true });
  if (fs.existsSync(EDITS)) fs.copyFileSync(EDITS, path.join(HIST, `${Date.now()}.json`));
  const all = fs.readdirSync(HIST).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 200))) fs.rmSync(path.join(HIST, old), { force: true });
  writeJson(EDITS, next);
}

// ---------- jobs: one at a time ----------
let job = null;
const statusNow = () => readJson(path.join(BUILD, "status.json"), {});
function renderRunning() {
  const st = statusNow();
  // The audio pass and stitching don't touch status.json, but they keep writing the log.
  const seen = Math.max(st.updated ?? 0, ...fs.readdirSync(BUILD).filter((n) => /render.*.log$/.test(n)).map((n) => mtime(path.join(BUILD, n))));
  return ["timeline", "audio", "render", "master", "check", "thumbnail"].includes(st.step) && !st.finished && !st.failed && Date.now() - seen < 3 * 60 * 1000;
}
const busy = () => (job?.running ? `${job.name} is still running` : renderRunning() ? "The video is rendering - wait for it to finish" : null);
function runSteps(name, steps) {
  job = { name, running: true, started: Date.now(), step: 0, of: steps.length };
  const logFile = path.join(BUILD, "studio-job.log");
  fs.writeFileSync(logFile, `# ${name}\n`);
  const next = (i) => {
    if (i >= steps.length) { job.running = false; job.ended = Date.now(); return; }
    job.step = i + 1;
    const p = spawn(process.execPath, steps[i], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let errors = "";
    p.stdout.on("data", (c) => fs.appendFileSync(logFile, c));
    p.stderr.on("data", (c) => { fs.appendFileSync(logFile, c); errors = (errors + c).slice(-3000); });
    p.on("close", (code) => {
      if (code) {
        const lines = errors.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
        job.running = false; job.failed = lines.find((l) => /error/i.test(l)) ?? lines.at(-1) ?? `${path.basename(steps[i][0])} failed`;
        return;
      }
      next(i + 1);
    });
  };
  next(0);
}
// The full render runs on its own (closing the Studio doesn't stop it). Always --no-remote.
function startRender() {
  const logFile = path.join(BUILD, "studio-render.log");
  const fd = fs.openSync(logFile, "w");
  const p = spawn(process.execPath, ["scripts/auto.mjs", "--from=timeline", "--no-remote", "--no-editor"], { cwd: ROOT, stdio: ["ignore", fd, fd], env: process.env, detached: true });
  p.unref();
  fs.closeSync(fd);
}
const renderLog = () => {
  for (const f of fs.readdirSync(BUILD).filter((n) => /render.*.log$/.test(n)).map((n) => path.join(BUILD, n)).sort((a, b) => mtime(b) - mtime(a))) {
    if (!mtime(f)) continue;
    const fd = fs.openSync(f, "r"), size = fs.fstatSync(fd).size, len = Math.min(3000, size), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    const lines = buf.toString("utf8").replace(/\x1b\[[0-9;]*m/g, "").split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
    const m = [...lines].reverse().map((l) => l.match(/Rendered (\d+)\/(\d+)/)).find(Boolean);
    return m ? { done: +m[1], total: +m[2] } : null;
  }
  return null;
};

// ---------- live state ----------
function renders() {
  if (!fs.existsSync(OUT)) return [];
  const edited = mtime(path.join(PUBLIC, "timeline.json"));
  return fs.readdirSync(OUT).filter((f) => /\.mp4$/i.test(f)).map((f) => ({ name: f, time: mtime(path.join(OUT, f)), stale: mtime(path.join(OUT, f)) < edited })).sort((a, b) => b.time - a.time);
}
function live() {
  const st = statusNow();
  return {
    status: { active: renderRunning(), step: st.step, doing: st.doing, progress: st.progress, etaSec: st.etaSec, done: st.done, steps: st.steps, finished: st.finished, failed: st.failed, updated: st.updated, frames: renderLog() },
    timelineTime: Math.max(mtime(path.join(PUBLIC, "timeline.json")), mtime(path.join(BUILD, "timeline.base.json"))),
    editsTime: mtime(EDITS), builtTime: mtime(path.join(BUILD, "edits.built.json")),
    reviewTime: mtime(path.join(BUILD, "review.json")),
    renders: renders(), job, busy: busy(), now: Date.now(),
  };
}
const clients = new Set();
let lastSent = "";
setInterval(() => {
  if (!clients.size) return;
  const s = JSON.stringify(live());
  const msg = s === lastSent ? ": ping\n\n" : `data: ${s}\n\n`;
  lastSent = s;
  for (const res of clients) res.write(msg);
}, 1000);

function baseTimeline() {
  const base = path.join(BUILD, "timeline.base.json"), built = path.join(PUBLIC, "timeline.json");
  // Before the first Studio build the timeline on disk has no Studio edits in it.
  return mtime(base) >= mtime(built) - 5000 && mtime(base) ? base : built;
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (p === "/" || p === "/index.html") return serveFile(req, res, path.join(HERE, "studio.html"));
    if (p === "/overrides.mjs") return serveFile(req, res, path.join(HERE, "studio-overrides.mjs"));
    if (p === "/favicon.ico") return res.writeHead(204).end();
    if (p === "/player.js") {
      try { return serveFile(req, res, await buildPlayer()); } catch (e) { log("studio", `preview build failed: ${e.message}`); return res.writeHead(500).end(String(e.message)); }
    }
    if (p === "/api/live") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(`data: ${JSON.stringify(live())}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (p === "/api/timeline") return serveFile(req, res, baseTimeline());
    if (p === "/api/project") {
      const pj = readJson(path.join(ROOT, "project.json"), {});
      return sendJson(res, 200, { title: pj.title, youtube: pj.youtube ?? null, credits: fs.existsSync(path.join(BUILD, "credits.txt")) ? fs.readFileSync(path.join(BUILD, "credits.txt"), "utf8") : "" });
    }
    if (p === "/api/edits" && req.method === "GET") return sendJson(res, 200, { edits: readEdits(), built: readJson(path.join(BUILD, "edits.built.json"), {}) });
    if (p === "/api/edits" && req.method === "PUT") {
      const b = await body(req);
      saveEdits(cleanEdits(b.edits ?? {}));
      return sendJson(res, 200, { ok: true, saved: Date.now() });
    }
    if (p === "/api/review") return sendJson(res, 200, readJson(path.join(BUILD, "review.json"), {})[url.searchParams.get("shot")] ?? null);
    if (p === "/api/picks") return sendJson(res, 200, readJson(path.join(BUILD, "picks.json"), {}));
    if (req.method === "POST" && p === "/api/candidates") {
      const b = await body(req);
      if (!validShot(b.shot)) return sendJson(res, 400, { error: "bad shot" });
      if (busy()) return sendJson(res, 409, { error: busy() });
      runSteps(`Finding footage for ${b.shot}`, [["scripts/fetch-broll.mjs", "--review", `--shot=${b.shot}`]]);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/api/pick") {
      const b = await body(req);
      if (!validShot(b.shot) || !(Number(b.n) >= 1 && Number(b.n) <= 12)) return sendJson(res, 400, { error: "bad pick" });
      if (busy()) return sendJson(res, 409, { error: busy() });
      const f = path.join(BUILD, "picks.json"), picks = readJson(f, {});
      fs.mkdirSync(HIST, { recursive: true });
      if (fs.existsSync(f)) fs.copyFileSync(f, path.join(HIST, `picks-${Date.now()}.json`));
      picks[b.shot] = Number(b.n);
      writeJson(f, picks);
      runSteps(`Swapping footage on ${b.shot}`, [["scripts/fetch-broll.mjs"], ["scripts/build-timeline.mjs"], ["scripts/check-repeats.mjs"]]);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/api/rebuild") {
      if (busy()) return sendJson(res, 409, { error: busy() });
      runSteps("Applying edits", [["scripts/build-timeline.mjs"]]);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === "POST" && p === "/api/render") {
      if (busy()) return sendJson(res, 409, { error: busy() });
      startRender();
      return sendJson(res, 200, { ok: true });
    }
    if (p === "/thumb") return thumb(req, res, url.searchParams.get("src") ?? "", Math.max(0, Number(url.searchParams.get("t")) || 0));
    if (p === "/wave") return wave(req, res, url.searchParams.get("src") ?? "", Math.min(6000, Math.max(100, Number(url.searchParams.get("w")) || 1200)), "#" + (url.searchParams.get("c") || "9aa4b8").replace(/[^0-9a-fA-F]/g, "").slice(0, 6));
    if (p.startsWith("/public/")) return serveFile(req, res, inside(PUBLIC, p.slice(8)), "max-age=3600");
    if (p.startsWith("/out/")) return serveFile(req, res, inside(OUT, p.slice(5)));
    if (p.startsWith("/review/")) return serveFile(req, res, inside(path.join(BUILD, "review"), p.slice(8)));
    res.writeHead(404).end("not found");
  } catch (e) {
    log("studio", e.stack);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
  }
});
// A page closing mid-request must never take the Studio down.
process.on("uncaughtException", (e) => log("studio", `kept running after: ${e.message}`));
process.on("unhandledRejection", (e) => log("studio", `kept running after: ${e?.message ?? e}`));
server.on("error", (e) => { log("studio", e.code === "EADDRINUSE" ? `already running at http://localhost:${port}` : `could not start: ${e.message}`); process.exit(0); });
server.listen(port, "127.0.0.1", () => {
  log("studio", `Studio: http://localhost:${port}`);
  if (args.includes("--open")) spawn("cmd", ["/c", "start", "", `http://localhost:${port}`], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
});
