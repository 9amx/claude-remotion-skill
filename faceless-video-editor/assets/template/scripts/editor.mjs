// The editor view: a local page that shows the whole edit like an editing app -
// preview, multi-track timeline, inspector, transcript and the live status -
// and follows the pipeline as it runs.
//   node scripts/editor.mjs [--port=3100] [--open]
// Then open http://localhost:3100. Before the render the preview is an animatic
// (the storyboard frame of each shot over the real voice); once out/final.mp4
// (or out/video.mp4 / out/preview.mp4) exists it plays the rendered video.
// Only serves this project folder, only on localhost.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD, PUBLIC, ROOT, ffmpeg, log } from "./lib.mjs";

const args = process.argv.slice(2);
const port = Number(args.find((a) => a.startsWith("--port="))?.slice(7)) || 3100;
const page = path.join(path.dirname(fileURLToPath(import.meta.url)), "editor.html");

const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".txt": "text/plain; charset=utf-8" };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

// ---------- edits from the editor ----------
// One job at a time (a pick, a new keyword, the render); each runs the same
// pipeline scripts as a normal run, so the status page and timeline follow it.
let job = null;
const runSteps = (name, steps, detached = false) => {
  if (job?.running) return false;
  job = { name, running: true, started: Date.now() };
  const next = (i) => {
    if (i >= steps.length) { job.running = false; job.ended = Date.now(); return; }
    const p = spawn(process.execPath, steps[i], { cwd: ROOT, stdio: "ignore", env: process.env, detached });
    if (detached) { p.unref(); job.running = false; return; }
    p.on("exit", (code) => { if (code) { job.running = false; job.failed = `${steps[i].join(" ")} exited ${code}`; return; } next(i + 1); });
  };
  next(0);
  return true;
};
const runNow = (stepArgs) => new Promise((resolve) => spawn(process.execPath, stepArgs, { cwd: ROOT, stdio: "ignore", env: process.env }).on("exit", resolve));
const body = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } }); });
const sendJson = (res, code, data) => res.writeHead(code, { "Content-Type": TYPES[".json"], "Cache-Control": "no-cache" }).end(JSON.stringify(data));
const validShot = (k) => /^s\d{3}-\d+$/.test(String(k ?? ""));

async function candidates(shot) {
  await runNow(["scripts/fetch-broll.mjs", "--review", `--shot=${shot}`]);
  return readJson(path.join(BUILD, "review.json"))?.[shot] ?? null;
}

// Swap a keyword inside the scene's beats: "city night" -> "Dhaka traffic night".
function replaceKeyword(shot, oldKw, newKw) {
  const file = path.join(ROOT, "project.json");
  const p = readJson(file);
  const idx = Number(shot.slice(1, 4)) - 1;
  const scenes = p?.chapters ? p.chapters.flatMap((c) => c.scenes) : p?.scenes;
  const sc = scenes?.[idx];
  if (!sc?.broll) return false;
  let done = false;
  sc.broll = sc.broll.map((e) => {
    if (done) return e;
    if (typeof e === "string") { if (e === oldKw) { done = true; return newKw; } return e; }
    const kw = [].concat(e.kw ?? []);
    const i = kw.indexOf(oldKw);
    if (i < 0) return e;
    done = true; kw[i] = newKw;
    return { ...e, kw };
  });
  if (done) fs.writeFileSync(file, JSON.stringify(p, null, 2));
  return done;
}

function state() {
  const video = ["out/final.mp4", "out/video.mp4", "out/preview.mp4"].find((f) => fs.existsSync(path.join(ROOT, f))) ?? null;
  const tilesDir = path.join(BUILD, "storyboard", "tiles");
  const tiles = fs.existsSync(tilesDir) ? fs.readdirSync(tilesDir).filter((f) => /^\d{4}\.jpg$/.test(f)).length : 0;
  return {
    timeline: readJson(path.join(PUBLIC, "timeline.json")),
    status: readJson(path.join(BUILD, "status.json")) ?? {},
    project: readJson(path.join(ROOT, "project.json"))?.title ?? null,
    video, videoTime: video ? mtime(path.join(ROOT, video)) : 0,
    tiles, tilesTime: mtime(tilesDir),
    picks: readJson(path.join(BUILD, "picks.json")) ?? {},
    job,
  };
}

// Static files from the project, with byte ranges so the video can seek.
function serveFile(req, res, rel) {
  const file = path.resolve(ROOT, decodeURIComponent(rel));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": "no-cache" });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  }
}

// Audio waveform as a PNG (for the audio tracks), drawn once per file and cached.
function wave(res, rel, w, color) {
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const dir = path.join(BUILD, "editor-cache");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${Buffer.from(rel).toString("base64url").slice(-80)}-${w}-${Math.round(mtime(file))}.png`);
  if (!fs.existsSync(out)) {
    ffmpeg(["-i", file, "-filter_complex", `aformat=channel_layouts=mono,showwavespic=s=${w}x96:colors=${color}:scale=sqrt`, "-frames:v", "1", out]);
  }
  if (!fs.existsSync(out)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=3600" }).end(fs.readFileSync(out));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/wave") {
    wave(res, url.searchParams.get("src") ?? "", Math.min(4000, Math.max(100, Number(url.searchParams.get("w")) || 1200)), (url.searchParams.get("c") || "#9fe2bf").replace(/[^#0-9a-fA-F]/g, ""));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" }).end(fs.readFileSync(page));
  } else if (req.method === "POST" && url.pathname === "/api/candidates") {
    body(req).then(async (b) => {
      if (!validShot(b.shot)) return sendJson(res, 400, { error: "bad shot" });
      if (job?.running) return sendJson(res, 409, { error: `busy: ${job.name}` });
      sendJson(res, 200, { review: await candidates(b.shot) });
    });
  } else if (req.method === "POST" && url.pathname === "/api/pick") {
    body(req).then((b) => {
      if (!validShot(b.shot) || !(Number(b.n) >= 1)) return sendJson(res, 400, { error: "bad pick" });
      if (job?.running) return sendJson(res, 409, { error: `busy: ${job.name}` });
      const file = path.join(BUILD, "picks.json");
      const picks = readJson(file) ?? {};
      picks[b.shot] = Number(b.n);
      fs.writeFileSync(file, JSON.stringify(picks, null, 2));
      runSteps(`Swapping ${b.shot}`, [["scripts/fetch-broll.mjs"], ["scripts/build-timeline.mjs"], ["scripts/storyboard.mjs"]]);
      sendJson(res, 200, { ok: true });
    });
  } else if (req.method === "POST" && url.pathname === "/api/keyword") {
    body(req).then(async (b) => {
      const kw = String(b.keyword ?? "").trim().slice(0, 120);
      if (!validShot(b.shot) || !kw || !b.old) return sendJson(res, 400, { error: "bad keyword" });
      if (job?.running) return sendJson(res, 409, { error: `busy: ${job.name}` });
      if (!replaceKeyword(b.shot, String(b.old), kw)) return sendJson(res, 404, { error: "that keyword is not in this scene's beats" });
      sendJson(res, 200, { review: await candidates(b.shot) });
    });
  } else if (req.method === "POST" && url.pathname === "/api/approve") {
    // The render runs on its own: closing the editor doesn't stop it.
    const ok = runSteps("Render", [["scripts/auto.mjs", "--from=broll", "--no-editor"]], true);
    sendJson(res, ok ? 200 : 409, ok ? { ok: true } : { error: `busy: ${job.name}` });
  } else if (url.pathname === "/api/state") {
    res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-cache" }).end(JSON.stringify(state()));
  } else if (url.pathname.startsWith("/files/")) {
    serveFile(req, res, url.pathname.slice(7));
  } else {
    res.writeHead(404).end("not found");
  }
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") log("editor", `already running at http://localhost:${port}`);
  else log("editor", `could not start: ${e.message}`);
  process.exit(0);
});
server.listen(port, "127.0.0.1", () => {
  log("editor", `editor view: http://localhost:${port}  (preview, timeline, inspector, live status - Ctrl+C to stop)`);
  if (args.includes("--open")) {
    const url = `http://localhost:${port}`;
    const [cmd, cmdArgs] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  }
});
