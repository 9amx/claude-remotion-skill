// Shared helpers for the pipeline scripts. No dependencies beyond Node 18+.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC = path.join(ROOT, "public");
export const BUILD = path.join(ROOT, "build");

export const FORMATS = {
  shorts: { width: 1080, height: 1920, orientation: "portrait" },
  landscape: { width: 1920, height: 1080, orientation: "landscape" },
  square: { width: 1080, height: 1080, orientation: "square" },
};

export function readProject() {
  const file = process.env.PROJECT || path.join(ROOT, "project.json");
  if (!fs.existsSync(file)) {
    fail(`No project.json found at ${file}. Copy project.example.json and write your script into it.`);
  }
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(p.scenes) || p.scenes.length === 0) fail("project.json needs a non-empty scenes array.");
  p.format = p.format || "shorts";
  if (!FORMATS[p.format]) fail(`Unknown format "${p.format}". Use: ${Object.keys(FORMATS).join(", ")}`);
  p.fps = p.fps || 30;
  p.style = p.style || "bold";
  p.voice = { provider: "edge", ...(p.voice || {}) };
  p.music = { volume: 0.12, mood: "calm", ...(p.music || {}) };
  p.captions = { style: "pop", maxWords: 3, ...(p.captions || {}) };
  p.maxShotSeconds = p.maxShotSeconds || (p.format === "shorts" ? 2.8 : 4.5);
  return p;
}

export const sceneId = (i) => `s${String(i + 1).padStart(2, "0")}`;

export function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Media duration in seconds. Uses system ffprobe, falls back to Remotion's bundled one.
export function probeDuration(file) {
  const args = ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file];
  let r = spawnSync("ffprobe", args, { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) {
    r = spawnSync("npx", ["remotion", "ffprobe", ...args], { encoding: "utf8", cwd: ROOT });
  }
  const d = parseFloat((r.stdout || "").trim().split("\n").pop());
  return Number.isFinite(d) ? d : null;
}

export function hasCommand(cmd) {
  return spawnSync(cmd, ["-version"], { encoding: "utf8" }).status === 0;
}

export function log(step, msg) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}

export function fail(msg) {
  console.error(`\x1b[31m[error]\x1b[0m ${msg}`);
  process.exit(1);
}
