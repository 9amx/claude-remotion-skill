// Shared helpers for the pipeline scripts. No dependencies beyond Node 18+.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC = path.join(ROOT, "public");
export const BUILD = path.join(ROOT, "build");

// Remotion's CLI run through node directly: `npx` is a .cmd file on Windows,
// which newer Node versions refuse to spawn without a shell.
export const REMOTION = [process.execPath, path.join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js")];
export const remotionCmd = (args) => [REMOTION[0], [REMOTION[1], ...args]];
// "python3" on macOS/Linux, usually "python" (or the "py" launcher) on Windows.
export const PYTHON = ["python3", "python", "py"].find((c) => spawnSync(c, ["--version"], { encoding: "utf8" }).status === 0) ?? "python3";

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
  p.format = p.format || "shorts";
  if (!FORMATS[p.format]) fail(`Unknown format "${p.format}". Use: ${Object.keys(FORMATS).join(", ")}`);
  p.music = { volume: 0.12, mood: "calm", ...(p.music || {}) };
  // Long form: "chapters": [{ "title", "mood", "broll", "scenes": [...] }]. Flattened
  // into p.scenes (each scene knows its chapter) so every step treats both shapes alike.
  if (Array.isArray(p.chapters)) {
    if (p.scenes) fail('Use either "scenes" or "chapters" in project.json, not both.');
    p.scenes = p.chapters.flatMap((ch, c) =>
      (ch.scenes || []).map((s, k) => ({ ...s, broll: s.broll?.length ? s.broll : ch.broll, look: s.look ?? ch.look, chapter: c, chapterStart: k === 0 })),
    );
  } else {
    p.chapters = [{ title: p.title ?? "" }];
    p.scenes = (p.scenes || []).map((s, k) => ({ ...s, chapter: 0, chapterStart: k === 0 }));
  }
  p.chapters = p.chapters.map((ch) => ({ title: ch.title ?? "", mood: ch.mood ?? p.music.mood, music: ch.music ?? null }));
  if (p.scenes.length === 0) fail("project.json needs a non-empty scenes (or chapters[].scenes) array.");
  const long = p.format !== "shorts";
  p.fps = p.fps || 30;
  // Edit style bundles pacing, transitions, zooms and SFX density. Anything set
  // explicitly in project.json wins over the preset.
  p.editStyle = p.editStyle || (long ? "story" : "viral");
  const es = EDIT_STYLES[p.editStyle];
  if (!es) fail(`Unknown editStyle "${p.editStyle}". Use: ${Object.keys(EDIT_STYLES).join(", ")}`);
  p.style = p.style || es.style || (long ? "documentary" : "bold");
  p.voice = { provider: "edge", ...(p.voice || {}) };
  const capStyle = long ? "subtitle" : es.captions;
  p.captions = { style: capStyle, maxWords: capStyle === "subtitle" ? 8 : 3, ...(p.captions || {}) };
  p.maxShotSeconds = p.maxShotSeconds || es.shot[long ? 1 : 0];
  // Where transitions happen: every scene (Shorts) or only at chapters (long form).
  p.transitions = p.transitions || (p.chapters.length > 1 ? "chapter" : "scene");
  p.transitionStyle = p.transitionStyle || es.transition;
  p.punchIns = p.punchIns ?? es.punchIns;
  p.hookShake = p.hookShake ?? es.hookShake;
  p.sfxLevel = p.sfx === false ? 0 : (p.sfxLevel ?? es.sfx);
  return p;
}

// Edit styles: how the video is cut, independent of its colors (style).
//   shot: [Shorts, long form] seconds per B-roll shot
//   transition: auto cycles whip/zoom/glitch/flash; or one of whip|zoom|glitch|flash|dip|fade|cut
export const EDIT_STYLES = {
  viral: { shot: [2.2, 3.5], transition: "auto", punchIns: true, hookShake: true, sfx: 1, captions: "pop" },
  story: { shot: [3.5, 5], transition: "dip", punchIns: false, hookShake: false, sfx: 0.7, captions: "karaoke", style: "documentary" },
  explainer: { shot: [3, 4.5], transition: "zoom", punchIns: true, hookShake: false, sfx: 0.8, captions: "boxed", style: "minimal" },
  calm: { shot: [3.8, 6], transition: "fade", punchIns: false, hookShake: false, sfx: 0.4, captions: "karaoke", style: "documentary" },
};

export const TRANSITIONS = ["whip", "zoom", "glitch", "flash", "dip", "fade", "cut"];
export const LOOKS = ["normal", "flashback", "dramatic", "night", "vhs", "dream"];
export const FX = ["shake", "freeze", "reveal", "punch"];

// Sound you supply (e.g. downloaded from Epidemic Sound) always wins over the
// synthesized kit. Drop files in public/sfx/ named after the slot, with optional
// variants that rotate so repeated cuts don't sound identical:
//   public/sfx/whoosh-1.mp3, whoosh-2.mp3, hit.wav, riser.mp3, ...
export const SFX_NAMES = ["hit", "whoosh", "pop", "riser", "scratch", "glitch", "tick"];
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i;
export function userSfx() {
  const dir = path.join(PUBLIC, "sfx");
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^([a-z]+)(-\d+)?\.[a-z0-9]+$/i.exec(f);
    if (m && AUDIO_EXT.test(f) && SFX_NAMES.includes(m[1].toLowerCase())) (out[m[1].toLowerCase()] ??= []).push(f);
  }
  return out;
}
// Normalized copies of user sound live in public/audio/user/ (built by gen-audio).
export const stem = (f) => path.basename(f).replace(/\.[^.]+$/, "");
export const userSfxPath = (file) => `audio/user/sfx-${stem(file)}.wav`;
export const userMusicPath = (file) => `audio/user/music-${stem(file)}.m4a`;

// Script markup: *word* marks a word to highlight (accent color, punch-in zoom).
// The asterisks never reach the voice.
export const stripMarkup = (text) => text.replace(/\*/g, "");

export const sceneId = (i) => `s${String(i + 1).padStart(3, "0")}`;

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
    r = spawnSync(...remotionCmd(["ffprobe", ...args]), { encoding: "utf8", cwd: ROOT });
  }
  const d = parseFloat((r.stdout || "").trim().split("\n").pop());
  return Number.isFinite(d) ? d : null;
}

export function hasCommand(cmd) {
  return spawnSync(cmd, ["-version"], { encoding: "utf8" }).status === 0;
}

// System ffmpeg if installed, else the one bundled with Remotion.
export function ffmpeg(args, { capture = false } = {}) {
  const ffArgs = ["-y", "-v", capture ? "info" : "error", ...args];
  const [cmd, cmdArgs] = hasCommand("ffmpeg") ? ["ffmpeg", ffArgs] : remotionCmd(["ffmpeg", ...ffArgs]);
  return spawnSync(cmd, cmdArgs, {
    cwd: ROOT, encoding: "utf8", stdio: capture ? "pipe" : "inherit", maxBuffer: 64 * 1024 * 1024,
  });
}

export const sha1 = (s) => createHash("sha1").update(s).digest("hex").slice(0, 12);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const timecode = (sec) => {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const mmss = `${String(m).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
  return h ? `${h}:${mmss}` : mmss;
};

// Split a transcript (words with startMs/endMs) into scenes given each scene's
// script tokens. Script words are aligned to transcribed words greedily with a
// small look-ahead, re-anchoring after long misses (skipped audio, ad-libs), so
// boundaries stay exact over a 40 minute recording. Unmatched boundaries fall
// back to proportional position; estimated (not exactly matched) boundaries
// snap to the longest pause within +-2 words. Returns word indices where each scene starts (+ end).
export function splitIntoScenes(words, sceneTokens) {
  const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
  const script = sceneTokens.flat().map(norm);
  const match = new Array(script.length).fill(null);
  for (let i = 0, j = 0, miss = 0; i < script.length; i++) {
    if (miss > 20) j = Math.max(j, Math.round((i / script.length) * words.length) - 10);
    let hit = false;
    for (let k = j; k < Math.min(j + 8, words.length); k++) {
      if (norm(words[k].text) === script[i]) {
        [match[i], j, hit] = [k, k + 1, true];
        break;
      }
    }
    miss = hit ? 0 : miss + 1;
  }
  const bounds = [0];
  let tok = 0;
  for (let s = 0; s < sceneTokens.length - 1; s++) {
    tok += sceneTokens[s].length;
    let guess = null, exact = false;
    for (let i = tok; i < Math.min(tok + 12, script.length); i++) {
      if (match[i] !== null) {
        [guess, exact] = [match[i] - (i - tok), i === tok];
        break;
      }
    }
    // Never before the previous scene's last matched word (handles skipped audio).
    // With no match inside this scene, count forward from that word instead.
    let floor = bounds[s] + 1;
    for (let i = tok - 1; i >= Math.max(0, tok - 12); i--) {
      if (match[i] !== null) {
        floor = Math.max(floor, match[i] + 1);
        guess ??= match[i] + (tok - i);
        break;
      }
    }
    guess ??= Math.round((tok / script.length) * words.length);
    guess = Math.max(guess, floor);
    if (exact) {
      bounds.push(guess); // the scene's first word was found: trust it
      continue;
    }
    const lo = Math.max(floor, guess - 2), hi = Math.min(words.length - 1, guess + 2);
    let best = Math.min(Math.max(guess, lo), words.length - 1), bestGap = -1;
    for (let k = lo; k <= hi; k++) {
      const gap = words[k].startMs - words[k - 1].endMs;
      if (gap > bestGap) [best, bestGap] = [k, gap];
    }
    bounds.push(best);
  }
  bounds.push(words.length);
  return { bounds, matched: match.filter((m) => m !== null).length };
}

// Jump-cut dead air out of a recording. Given words (absolute ms) inside
// [start, end], keep audio around speech and drop pauses longer than maxPause,
// leaving `pad` ms of breath on each side of a cut. Returns the segments to keep
// and the words re-timed relative to the tightened clip.
export function tightenSegments(words, start, end, maxPause = 400, pad = 140) {
  const first = words[0], last = words[words.length - 1];
  const segs = [[Math.max(start, first.startMs - pad), 0]];
  for (let i = 1; i < words.length; i++) {
    if (words[i].startMs - words[i - 1].endMs > maxPause) {
      segs[segs.length - 1][1] = words[i - 1].endMs + pad;
      segs.push([words[i].startMs - pad, 0]);
    }
  }
  segs[segs.length - 1][1] = Math.min(end, last.endMs + pad * 2);
  const shift = (t) => {
    let out = 0;
    for (const [a, b] of segs) {
      if (t <= a) break;
      out += Math.min(t, b) - a;
    }
    return Math.round(out);
  };
  return {
    segments: segs,
    durationMs: Math.round(segs.reduce((n, [a, b]) => n + b - a, 0)),
    words: words.map((w) => ({ ...w, startMs: shift(w.startMs), endMs: shift(w.endMs) })),
  };
}

export function log(step, msg) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}

export function fail(msg) {
  console.error(`\x1b[31m[error]\x1b[0m ${msg}`);
  process.exit(1);
}
