// The editor view: a local page that shows the whole edit like an editing app -
// preview, multi-track timeline, inspector, transcript and the live status -
// and follows the pipeline as it runs.
//   node scripts/editor.mjs [--port=3100] [--open]
// Then open http://localhost:3100. The preview plays the real edit live from the
// timeline (scripts/editor-player.tsx), so it can be checked before any render.
// Rendered videos can be picked too, and say so when they are an older cut.
// Comments sit on a frame, like Frame.io: build/comments.json, read with scripts/comments.mjs.
// Only serves this project folder and the footage bank's sheets, only on localhost.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream";
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
    const p = spawn(process.execPath, steps[i], { cwd: ROOT, stdio: detached ? "ignore" : ["ignore", "ignore", "pipe"], env: process.env, detached });
    if (detached) { p.unref(); job.running = false; return; }
    // Keep what the step says when it fails, so the page can show the real reason.
    let errors = "";
    p.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-4000); });
    p.on("close", (code) => {
      if (code) {
        const lines = errors.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
        const said = (lines.find((l) => /^\[error\]|^\w*Error:/.test(l)) ?? lines.find((l) => !/^(Node\.js v|at |node:|\^)/.test(l)))?.replace(/^\[error\]\s*/, "");
        job.running = false; job.failed = said || `${path.basename(steps[i][0])} stopped with an error`;
        return;
      }
      next(i + 1);
    });
  };
  next(0);
  return true;
};
const runNow = (stepArgs) => new Promise((resolve) => spawn(process.execPath, stepArgs, { cwd: ROOT, stdio: "ignore", env: process.env }).on("exit", resolve));
const body = (req) => new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } }); });
const sendJson = (res, code, data) => res.writeHead(code, { "Content-Type": TYPES[".json"], "Cache-Control": "no-cache" }).end(JSON.stringify(data));
const busy = () => {
  if (job?.running) return `Wait a moment: ${job.name} is still running`;
  const st = readJson(path.join(BUILD, "status.json"));
  const rendering = ["render", "master", "check"].includes(st?.step) && !st.finished && !st.failed && Date.now() - (st.updated ?? 0) < 20 * 60 * 1000;
  return rendering ? "The video is rendering, so edits wait until it finishes. Comments still work." : null;
};
const validShot = (k) => /^s\d{3}-\d+$/.test(String(k ?? ""));

// Undo: every edit first saves project.json, picks.json and edits.json.
const HIST = path.join(BUILD, "history");
const EDITABLE = [["project.json", ROOT], ["picks.json", BUILD], ["edits.json", BUILD]];
function snapshot(label) {
  const dir = path.join(HIST, `${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, base] of EDITABLE) if (fs.existsSync(path.join(base, name))) fs.copyFileSync(path.join(base, name), path.join(dir, name));
  fs.writeFileSync(path.join(dir, "label.txt"), label);
  const all = fs.readdirSync(HIST).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 50))) fs.rmSync(path.join(HIST, old), { recursive: true, force: true });
}
function undo() {
  const all = fs.existsSync(HIST) ? fs.readdirSync(HIST).sort() : [];
  const last = all.pop();
  if (!last) return null;
  const dir = path.join(HIST, last);
  for (const [name, base] of EDITABLE) {
    const saved = path.join(dir, name), live = path.join(base, name);
    if (fs.existsSync(saved)) fs.copyFileSync(saved, live); else fs.rmSync(live, { force: true });
  }
  const label = fs.existsSync(path.join(dir, "label.txt")) ? fs.readFileSync(path.join(dir, "label.txt"), "utf8") : "edit";
  fs.rmSync(dir, { recursive: true, force: true });
  return label;
}
const editsFile = path.join(BUILD, "edits.json");
const readEdits = () => ({ cuts: {}, text: {}, ...(readJson(editsFile) ?? {}) });
const REBUILD = [["scripts/build-timeline.mjs"], ["scripts/storyboard.mjs"]];

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

// Every rendered version in out/. A render older than the timeline is an older cut.
function renders() {
  const dir = path.join(ROOT, "out");
  if (!fs.existsSync(dir)) return [];
  const edited = mtime(path.join(PUBLIC, "timeline.json"));
  const all = fs.readdirSync(dir).filter((f) => /\.mp4$/i.test(f));
  return all.filter((f) => !(f === "video.mp4" && all.includes("final.mp4")))
    .map((f) => ({ name: f, path: `out/${f}`, time: mtime(path.join(dir, f)), stale: mtime(path.join(dir, f)) < edited }))
    .sort((a, b) => b.time - a.time);
}

// The Deliver page: the thumbnail and what goes on YouTube. A pasted-ready description wins.
function deliverInfo() {
  const yt = readJson(path.join(ROOT, "project.json"))?.youtube ?? {};
  const ready = path.join(ROOT, "youtube-description.txt");
  const description = fs.existsSync(ready) ? fs.readFileSync(ready, "utf8").trim() : [yt.description, (yt.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
  return { thumbnail: mtime(path.join(ROOT, "out", "thumbnail.jpg")) || null, title: yt.title ?? null, description: description || null, tags: (yt.tags ?? []).join(", ") || null };
}

function state() {
  const videos = renders();
  const video = videos.find((v) => v.name === "final.mp4")?.path ?? videos[0]?.path ?? null;
  const tilesDir = path.join(BUILD, "storyboard", "tiles");
  const tiles = fs.existsSync(tilesDir) ? fs.readdirSync(tilesDir).filter((f) => /^\d{4}\.jpg$/.test(f)).length : 0;
  return {
    timelineTime: mtime(path.join(PUBLIC, "timeline.json")),
    videos, openComments: readComments().filter((c) => !c.resolved).length,
    deliver: deliverInfo(),
    status: readJson(path.join(BUILD, "status.json")) ?? {},
    project: readJson(path.join(ROOT, "project.json"))?.title ?? null,
    video, videoTime: video ? mtime(path.join(ROOT, video)) : 0,
    tiles, tilesTime: mtime(tilesDir),
    picks: readJson(path.join(BUILD, "picks.json")) ?? {},
    edits: readJson(path.join(BUILD, "edits.json")) ?? {},
    undo: fs.existsSync(HIST) ? fs.readdirSync(HIST).length : 0,
    job,
  };
}

// Static files, with byte ranges so the video can seek.
function serveFile(req, res, rel, base = ROOT) {
  let file;
  try { file = path.resolve(base, decodeURIComponent(rel)); } catch { res.writeHead(400).end("bad path"); return; }
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start < 0 || start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }).end(); return; }
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": "no-cache" });
    pipeline(fs.createReadStream(file, { start, end }), res, () => {});
  } else {
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
    pipeline(fs.createReadStream(file), res, () => {});
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

// ---------- comments on a frame ----------
const commentsFile = path.join(BUILD, "comments.json");
function readComments() { return readJson(commentsFile)?.comments ?? []; }
function writeComments(comments) {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.writeFileSync(commentsFile + ".tmp", JSON.stringify({ comments }, null, 2));
  fs.renameSync(commentsFile + ".tmp", commentsFile);
}
const short = (v, n) => String(v ?? "").trim().slice(0, n);

// ---------- footage bank: every shot it holds, and which are already in the edit ----------
const bankDir = () => {
  const cfg = readJson(path.join(BUILD, "bank-themes.json"));
  return cfg ? path.resolve(ROOT, cfg.dir ?? "../bank") : null;
};
function usedMedia() {
  const used = new Map();
  for (const sc of readJson(path.join(PUBLIC, "timeline.json"))?.scenes ?? []) {
    for (const sh of sc.shots ?? []) {
      if (!sh.src) continue;
      const m = path.basename(sh.src).match(/^bank-(\d+)-(\d+)-/);
      used.set(m ? `bank:${m[1]}:${m[2]}` : sh.src, sc.id);
    }
  }
  return used;
}
function bankShots() {
  const dir = bankDir();
  if (!dir) return null;
  const tiles = readJson(path.join(dir, "tiles.json")) ?? {};
  const clips = readJson(path.join(dir, "index.json"))?.clips ?? {};
  const used = usedMedia();
  return Object.entries(tiles).map(([id, t]) => {
    const [theme, num] = id.split(":");
    const n = Number(num) - 1;
    return { id, theme, page: Math.floor(n / 36) + 1, col: n % 6, row: Math.floor(n / 6) % 6, in: t.in, out: t.out, file: clips[t.clip]?.file ?? null,
      title: clips[t.clip]?.title ?? "", usedIn: used.get(`bank:${t.clip.slice(6)}:${Math.round(t.in * 10)}`) ?? null };
  });
}
function photos() {
  const dir = path.join(PUBLIC, "stills");
  if (!fs.existsSync(dir)) return [];
  const used = usedMedia();
  return fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => ({ src: `stills/${f}`, usedIn: used.get(`stills/${f}`) ?? null }));
}
const projectScene = (p, shot) => (p?.chapters ? p.chapters.flatMap((c) => c.scenes) : p?.scenes)?.[Number(shot.slice(1, 4)) - 1];
function editProject(mutate) {
  const file = path.join(ROOT, "project.json");
  const p = readJson(file);
  if (!p || !mutate(p)) return false;
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
  return true;
}

// ---------- live preview ----------
// The real composition, bundled for the browser. Rebuilt only when the source changes.
let playerBuild = null, playerStamp = 0;
const newestIn = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newestIn(path.join(dir, e.name)) : mtime(path.join(dir, e.name))), 0);
async function buildPlayer() {
  const entry = path.join(path.dirname(page), "editor-player.tsx");
  const stamp = Math.max(newestIn(path.join(ROOT, "src")), mtime(entry));
  const out = path.join(BUILD, "editor-cache", "player.js");
  if (playerBuild && stamp === playerStamp) return playerBuild;
  playerStamp = stamp;
  playerBuild = (async () => {
    if (mtime(out) > stamp) return out;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const { build } = await import("esbuild");
    await build({ entryPoints: [entry], outfile: out, bundle: true, format: "iife", platform: "browser", target: "chrome100", minify: true, jsx: "automatic",
      absWorkingDir: ROOT, logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' }, banner: { js: "window.process=window.process||{env:{}};" },
      loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl" } });
    return out;
  })();
  playerBuild.catch(() => { playerBuild = null; });
  return playerBuild;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api/wave") {
    wave(res, url.searchParams.get("src") ?? "", Math.min(4000, Math.max(100, Number(url.searchParams.get("w")) || 1200)), (url.searchParams.get("c") || "#9fe2bf").replace(/[^#0-9a-fA-F]/g, ""));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" }).end(fs.readFileSync(page));
  } else if (url.pathname === "/favicon.ico") {
    res.writeHead(204).end();
  } else if (url.pathname === "/api/timeline") {
    serveFile(req, res, "public/timeline.json");
  } else if (url.pathname === "/player.js") {
    buildPlayer().then((file) => { res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-cache" }).end(fs.readFileSync(file)); })
      .catch((e) => { log("editor", `live preview could not be built: ${e.message}`); res.writeHead(500).end(String(e.message)); });
  } else if (url.pathname === "/api/comments" && req.method === "GET") {
    sendJson(res, 200, { comments: readComments() });
  } else if (url.pathname === "/api/comments" && req.method === "POST") {
    body(req).then((b) => {
      const text = short(b.text, 2000), frame = Math.round(Number(b.frame));
      if (!text || !Number.isFinite(frame) || frame < 0) return sendJson(res, 400, { error: "a comment needs words and a frame" });
      const comments = readComments();
      const c = { id: `c${Date.now()}`, frame, time: short(b.time, 16), text, author: "Owner", created: new Date().toISOString(), resolved: false, replies: [],
        shot: short(b.shot, 16), shotNumber: Number(b.shotNumber) || null, words: short(b.words, 300), media: short(b.media, 200), watching: short(b.watching, 120),
        ...(Array.isArray(b.drawing) && b.drawing.length ? { drawing: b.drawing.slice(0, 40) } : {}) };
      comments.push(c);
      writeComments(comments);
      sendJson(res, 200, { comment: c });
    });
  } else if (url.pathname === "/api/comments/update" && req.method === "POST") {
    body(req).then((b) => {
      let comments = readComments();
      const c = comments.find((x) => x.id === b.id);
      if (!c) return sendJson(res, 404, { error: "that comment is gone" });
      if (b.delete) comments = comments.filter((x) => x !== c);
      if (typeof b.resolved === "boolean") c.resolved = b.resolved;
      if (short(b.text, 2000)) c.text = short(b.text, 2000);
      if (short(b.reply, 2000)) c.replies.push({ author: "Owner", text: short(b.reply, 2000), created: new Date().toISOString() });
      writeComments(comments);
      sendJson(res, 200, { ok: true });
    });
  } else if (url.pathname === "/api/bank") {
    sendJson(res, 200, { shots: bankShots(), photos: photos() });
  } else if (url.pathname.startsWith("/bank/")) {
    const dir = bankDir();
    if (!dir) { res.writeHead(404).end(); return; }
    serveFile(req, res, url.pathname.slice(6), dir);
  } else if (req.method === "POST" && url.pathname === "/api/swap") {
    // Replace one shot with a bank shot or a photo, keeping the other shots of its beat.
    body(req).then((b) => {
      if (!validShot(b.shot) || !b.old || (!b.tile && !b.photo)) return sendJson(res, 400, { error: "bad swap" });
      if (busy()) return sendJson(res, 409, { error: busy() });
      const hasOld = projectScene(readJson(path.join(ROOT, "project.json")), b.shot)?.broll?.some((e) => [].concat(e?.kw ?? e).includes(b.old));
      if (!hasOld) return sendJson(res, 404, { error: "this shot isn't in the project any more - reload the page" });
      if (b.photo) {
        const photo = String(b.photo);
        if (!/^stills\/[^/\\]+$/.test(photo) || !fs.existsSync(path.join(PUBLIC, photo))) return sendJson(res, 400, { error: "no such photo" });
        snapshot(`swap ${b.shot}`);
        replaceKeyword(b.shot, String(b.old), `file:${photo}`);
        runSteps(`Swapping ${b.shot}`, [["scripts/fetch-broll.mjs"], ...REBUILD]);
      } else {
        if (!bankShots()?.some((x) => x.id === String(b.tile))) return sendJson(res, 404, { error: "that shot isn't in the footage bank" });
        snapshot(`swap ${b.shot}`);
        fs.writeFileSync(path.join(BUILD, "studio-swap.json"), JSON.stringify({ scene: Number(b.shot.slice(1, 4)), old: String(b.old), tile: String(b.tile) }));
        runSteps(`Swapping ${b.shot}`, [["scripts/footage-bank.mjs", "--swap=build/studio-swap.json"], ["scripts/fetch-broll.mjs"], ...REBUILD]);
      }
      sendJson(res, 200, { ok: true });
    });
  } else if (req.method === "POST" && url.pathname === "/api/overlay") {
    // Text on a shot: reworded or removed in project.json, found by what it says now.
    body(req).then((b) => {
      if (!validShot(b.shot) || typeof b.from !== "string" || typeof b.text !== "string") return sendJson(res, 400, { error: "bad text edit" });
      if (busy()) return sendJson(res, 409, { error: busy() });
      const text = b.text.trim().slice(0, 160);
      const known = projectScene(readJson(path.join(ROOT, "project.json")), b.shot)?.broll?.some((beat) => beat?.overlays?.some((o) => o.text === b.from));
      if (!known) return sendJson(res, 404, { error: "that text isn't in this scene any more" });
      snapshot(`text ${b.shot}`);
      const ok = editProject((p) => {
        for (const beat of projectScene(p, b.shot)?.broll ?? []) {
          const i = (beat?.overlays ?? []).findIndex((o) => o.text === b.from);
          if (i < 0) continue;
          if (text) beat.overlays[i].text = text; else beat.overlays.splice(i, 1);
          return true;
        }
        return false;
      });
      if (!ok) return sendJson(res, 404, { error: "that text isn't in this scene any more" });
      runSteps("Updating text", REBUILD);
      sendJson(res, 200, { ok: true });
    });
  } else if (req.method === "POST" && url.pathname === "/api/candidates") {
    body(req).then(async (b) => {
      if (!validShot(b.shot)) return sendJson(res, 400, { error: "bad shot" });
      if (busy()) return sendJson(res, 409, { error: busy() });
      sendJson(res, 200, { review: await candidates(b.shot) });
    });
  } else if (req.method === "POST" && url.pathname === "/api/pick") {
    body(req).then((b) => {
      if (!validShot(b.shot) || !(Number(b.n) >= 1)) return sendJson(res, 400, { error: "bad pick" });
      if (busy()) return sendJson(res, 409, { error: busy() });
      const file = path.join(BUILD, "picks.json");
      snapshot(`swap ${b.shot}`);
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
      if (busy()) return sendJson(res, 409, { error: busy() });
      snapshot(`keyword ${b.shot}`);
      if (!replaceKeyword(b.shot, String(b.old), kw)) return sendJson(res, 404, { error: "that keyword is not in this scene's beats" });
      sendJson(res, 200, { review: await candidates(b.shot) });
    });
  } else if (req.method === "POST" && url.pathname === "/api/cut") {
    body(req).then((b) => {
      const d = Math.round(Number(b.delta));
      if (!validShot(b.shot) || !Number.isFinite(d) || !d) return sendJson(res, 400, { error: "bad cut" });
      if (busy()) return sendJson(res, 409, { error: busy() });
      snapshot(`move cut ${b.shot}`);
      const e = readEdits();
      e.cuts[b.shot] = Math.max(-150, Math.min(150, (Number(e.cuts[b.shot]) || 0) + d));
      fs.writeFileSync(editsFile, JSON.stringify(e, null, 2));
      runSteps(`Moving cut ${b.shot}`, REBUILD);
      sendJson(res, 200, { ok: true });
    });
  } else if (req.method === "POST" && url.pathname === "/api/text") {
    body(req).then((b) => {
      if (!/^s\d{3}:(emphasis|badge|lowerThird|callout:\d+)$/.test(String(b.key ?? "")) || typeof b.text !== "string") return sendJson(res, 400, { error: "bad text edit" });
      if (busy()) return sendJson(res, 409, { error: busy() });
      snapshot(`text ${b.key}`);
      const e = readEdits();
      e.text[b.key] = b.text.trim().slice(0, 120);
      fs.writeFileSync(editsFile, JSON.stringify(e, null, 2));
      runSteps(`Updating text`, REBUILD);
      sendJson(res, 200, { ok: true });
    });
  } else if (req.method === "POST" && url.pathname === "/api/undo") {
    if (busy()) return sendJson(res, 409, { error: busy() });
    const label = undo();
    if (!label) return sendJson(res, 404, { error: "nothing to undo" });
    runSteps(`Undo ${label}`, [["scripts/fetch-broll.mjs"], ...REBUILD]);
    sendJson(res, 200, { undone: label });
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
