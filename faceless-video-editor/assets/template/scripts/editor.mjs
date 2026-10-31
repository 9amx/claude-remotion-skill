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
import { BUILD, PUBLIC, ROOT, log } from "./lib.mjs";

const args = process.argv.slice(2);
const port = Number(args.find((a) => a.startsWith("--port="))?.slice(7)) || 3100;
const page = path.join(path.dirname(fileURLToPath(import.meta.url)), "editor.html");

const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".txt": "text/plain; charset=utf-8" };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-cache" }).end(fs.readFileSync(page));
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
