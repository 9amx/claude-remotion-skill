// Shared helpers for the pipeline scripts. No dependencies beyond Node 18+.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Behind an HTTPS proxy (cloud sandboxes, company networks) Node's fetch ignores
// HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at startup (Node 22.21+ / 24), and
// hosts the network only reaches through the proxy fail with ENOTFOUND. Re-run
// this script once with it set; child scripts inherit it.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --disable-warning=UNDICI-EHPA`.trim(); // "proxy agent is experimental", in every child too
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_OPTIONS } });
  process.exit(r.status ?? 1);
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC = path.join(ROOT, "public");
export const BUILD = path.join(ROOT, "build");

// Remotion's CLI run through node directly: `npx` is a .cmd file on Windows,
// which newer Node versions refuse to spawn without a shell.
export const REMOTION = [process.execPath, path.join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js")];
export const remotionCmd = (args) => [REMOTION[0], [REMOTION[1], ...args]];
// Remotion's CLI gets the environment WITHOUT NODE_USE_ENV_PROXY: through a proxy
// that blocks remotion.media its background check throws and kills the render.
export const remotionEnv = () => { const e = { ...process.env }; delete e.NODE_USE_ENV_PROXY; return e; };
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
      (ch.scenes || []).map((s, k) => ({ ...s, broll: s.broll?.length ? s.broll : ch.broll, look: s.look ?? ch.look, ambience: s.ambience ?? ch.ambience, chapter: c, chapterStart: k === 0 })),
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
// Beat SFX (peak-normalized, onset-aligned) and ambience beds (loudness-normalized).
// "file:clips/talk.mp4#12.5-16" or "#1:05-1:09": a part of your own (or licensed) video.
export function parseFileRef(ref) {
  const m = /^(.*?)#(\d+(?::\d+)?(?:\.\d+)?)-(\d+(?::\d+)?(?:\.\d+)?)$/.exec(ref.trim());
  if (!m) return { file: ref.trim(), from: null, to: null };
  const sec = (t) => t.split(":").reduce((a, v) => a * 60 + parseFloat(v), 0);
  return { file: m[1], from: sec(m[2]), to: sec(m[3]) };
}
export const userSpotPath = (file) => `audio/user/spot-${stem(file)}.wav`;
export const userAmbiencePath = (file) => `audio/user/amb-${stem(file)}.m4a`;

// Script markup: *word* marks a word to highlight (accent color, punch-in zoom).
// The asterisks never reach the voice.
export const stripMarkup = (text) => text.replace(/\*/g, "");

export const sceneId = (i) => `s${String(i + 1).padStart(3, "0")}`;

// ---------- B-roll beats: footage locked to the words ----------
// scene.broll entries are keyword strings or beats:
//   { "on": "slot machine", "kw": ["slot machine lever casino", "slot reels spinning"], "sfx": "sfx/spot/slot.mp3" }
//   { "on": "3.5 million", "graphic": { "type": "counter", "value": 3500000, ... } }   (motion graphic, no search)
// A beat's picture starts on the first word of `on` and runs until the next
// beat starts, so the viewer sees the thing as they hear it. A beat longer than
// ~maxShotSeconds is covered by several shots of the same subject (kw[0], kw[1],
// ... or another clip of kw[0]), cut on word starts. Plain strings are anchored
// to the first word they share with the line (in order), else spread evenly.
export const brollEntries = (scene) =>
  (scene.broll ?? []).map((e) => (typeof e === "string" ? { kw: [e] } : { ...e, kw: [].concat(e.kw ?? []).filter(Boolean) }));
export const GRAPHIC_TYPES = ["counter", "bars", "timeline", "quote", "map", "list", "steps", "compare", "statement", "ui"];
export const entryKeywords = (scene) => brollEntries(scene).flatMap((e) => e.kw);

export const normWord = (w) => String(w).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
const wordStem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s|ly)$/, "") : w);
const loose = (a, b) => a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));

// Index of the word where `phrase` starts in words[] (from `from` on), or -1.
// strict: the whole phrase must match word for word (lint uses it on the script).
export function findPhrase(words, phrase, from = 0, strict = false) {
  const want = String(phrase).split(/\s+/).map(normWord).filter(Boolean);
  const have = words.map((w) => normWord(w.text ?? w));
  if (!want.length) return -1;
  for (let i = from; i <= have.length - want.length; i++) if (want.every((t, j) => have[i + j] === t)) return i;
  if (strict) return -1;
  // Spoken text can differ from the script (numbers read out, a transcription):
  // first two words loosely, then the first word alone.
  for (let i = from; i < have.length; i++) if (loose(have[i], want[0]) && (want.length === 1 || loose(have[i + 1] ?? "", want[1]))) return i;
  for (let i = from; i < have.length; i++) if (loose(have[i], want[0])) return i;
  return -1;
}

const KW_STOP = new Set(["the", "and", "with", "for", "from", "into", "over", "close", "shot", "video", "footage", "photo", "image", "aerial", "slow", "motion", "night", "day", "view", "top", "background"]);
// First word of the line (from `from`) that a keyword names: "phone screen glow" -> "phone's".
// Only words at least minMs in count, so a beat never lands on top of the previous one.
function autoAnchor(words, kw, from, minMs) {
  const toks = kw.replace(/^[a-z]+:/, "").split(/\s+/).map(normWord).filter((t) => t.length >= 3 && !KW_STOP.has(t)).map(wordStem);
  for (let i = from; i < words.length; i++) {
    if (words[i].startMs - LEAD_MS < minMs) continue;
    const w = wordStem(normWord(words[i].text));
    if (w.length >= 3 && toks.some((t) => loose(t, w) && Math.min(t.length, w.length) >= 4 || t === w)) return i;
  }
  return -1;
}

// Stock search ranks loosely: score a result by the share of keyword words its
// tags / title / description contain. Green-screen / mockup / template clips are never usable.
const REL_STOP = new Set(["the", "and", "with", "for", "from", "into", "over", "close", "shot", "video", "footage", "photo", "image"]);
export const BLOCK = /green ?screen|chroma|mock-?up|template|alpha channel|lower third|placeholder/i;
const wordsOf = (q) => q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !REL_STOP.has(w));
export const relevance = (query, text) => {
  const words = wordsOf(query), t = text.toLowerCase();
  return words.length ? words.filter((w) => t.includes(w)).length / words.length : 0;
};

// Adobe Stock clips licensed through the Adobe connector and added with
// scripts/adobe-stock.mjs: build/adobe.json maps the asset id to its local file.
export function adobeAsset(ref) {
  const id = String(ref).replace(/^adobe:/, "").trim();
  const a = readJson(path.join(BUILD, "adobe.json"), {})[id];
  if (!a || !fs.existsSync(path.join(PUBLIC, a.file))) return null;
  return { id: `adobe-${id}`, source: "adobe", kind: a.kind, ext: path.extname(a.file).slice(1), local: true, rel: 1, text: a.title ?? "",
    credit: `Adobe Stock #${id}${a.title ? ` - ${a.title}` : ""} (licensed)` };
}

export const LEAD_MS = 70; // picture cuts ~2 frames before the word: it lands as the word is heard
const MIN_SHOT_MS = 600;

// Shots of one scene: [{ kw, alts, entry, sub, startMs, endMs, words, sfx, on }] covering
// [0, vo.durationMs]. Shared by fetch-broll (what to search) and build-timeline (where to cut).
export function planShots(scene, vo, maxShotSeconds) {
  const total = vo.durationMs;
  const words = vo.words ?? [];
  const entries = brollEntries(scene).filter((e) => e.kw.length || e.graphic);
  const spoken = (a, b) => words.filter((w) => (w.startMs + w.endMs) / 2 >= a && (w.startMs + w.endMs) / 2 < b).map((w) => stripMarkup(w.text)).join(" ");
  if (scene.visual === "kinetic" || !entries.length) return { shots: [{ kw: null, alts: [], entry: -1, sub: 0, startMs: 0, endMs: total, words: spoken(0, total) }], notes: [] };
  if (scene.layout === "split") {
    return { shots: [0, 1].map((k) => ({ kw: entries[k]?.kw[0] ?? null, alts: entries[k]?.kw ?? [], entry: k, sub: 0, startMs: 0, endMs: total,
      words: spoken(0, total), ...(entries[k]?.sfx ? { sfx: entries[k].sfx } : {}), ...(entries[k]?.credit ? { credit: entries[k].credit } : {}) })), notes: [] };
  }
  const notes = [];
  // 1. anchor every beat to a word
  const anchors = [];
  let from = 0;
  entries.forEach((e, k) => {
    // The first beat opens the scene whatever it names: a plain keyword there takes word 0.
    const minMs = (anchors[anchors.length - 1]?.ms ?? 0) + MIN_SHOT_MS;
    let idx = e.on ? findPhrase(words, e.on, from) : k === 0 ? 0 : e.kw.length ? autoAnchor(words, e.kw[0], from, minMs) : -1;
    if (e.on && idx < 0) notes.push(`beat ${k + 1}: "${e.on}" not found in the spoken words - placed by position`);
    if (idx < 0) {
      // Even spread, snapped to the nearest word start after the previous beat.
      const target = Math.max(minMs, (total * k) / entries.length);
      idx = words.reduce((b, w, i) => (i >= from && (b < 0 || Math.abs(w.startMs - target) < Math.abs(words[b].startMs - target)) ? i : b), -1);
    }
    const ms = k === 0 || idx < 0 ? 0 : Math.max(0, words[idx].startMs - LEAD_MS);
    anchors.push({ e, k, ms });
    if (idx >= 0) from = idx + 1;
  });
  // 2. beats too close together can't both be seen: keep the earlier one
  const beats = [];
  for (const a of anchors) {
    const prev = beats[beats.length - 1];
    if (prev && a.ms - prev.ms < MIN_SHOT_MS) {
      notes.push(`beat ${a.k + 1}${a.e.on ? ` "${a.e.on}"` : ""} starts ${(Math.max(0, a.ms - prev.ms) / 1000).toFixed(1)}s after the previous one - too short to see, merged into it`);
      continue;
    }
    beats.push(a);
  }
  // 3. long beats: more shots of the same subject, cut on word starts
  const maxMs = maxShotSeconds * 1000;
  const shots = [];
  beats.forEach((b, i) => {
    const end = beats[i + 1]?.ms ?? total;
    // Your own file / an AI still / a graphic can't give a second angle: one shot per distinct asset.
    const fixed = b.e.graphic || b.e.kw.every((k) => /^(file|ai|adobe):/.test(k));
    const n = Math.max(1, Math.min(Math.round((end - b.ms) / maxMs), b.e.graphic ? 1 : fixed ? new Set(b.e.kw).size : Infinity));
    const cuts = [b.ms];
    for (let j = 1; j < n; j++) {
      const target = b.ms + ((end - b.ms) * j) / n;
      const near = words.map((w) => w.startMs - LEAD_MS).filter((t) => t > cuts[j - 1] + MIN_SHOT_MS && t < end - MIN_SHOT_MS)
        .reduce((best, t) => (best === null || Math.abs(t - target) < Math.abs(best - target) ? t : best), null);
      if (near !== null) cuts.push(near);
    }
    cuts.push(end);
    for (let j = 0; j < cuts.length - 1; j++) {
      shots.push({ kw: b.e.graphic ? null : b.e.kw[j % b.e.kw.length], alts: b.e.kw, entry: b.k, sub: j, on: b.e.on, startMs: cuts[j], endMs: cuts[j + 1],
        words: spoken(cuts[j], cuts[j + 1]), ...(b.e.graphic ? { graphic: b.e.graphic } : {}), ...(j === 0 && b.e.sfx ? { sfx: b.e.sfx } : {}),
        ...(b.e.credit ? { credit: b.e.credit } : {}) });
    }
  });
  return { shots, notes };
}

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

// Raw decoded output (e.g. a few RGB frames) as a Buffer.
export function ffmpegRaw(args) {
  const [cmd, cmdArgs] = hasCommand("ffmpeg") ? ["ffmpeg", ["-v", "error", ...args]] : remotionCmd(["ffmpeg", "-v", "error", ...args]);
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
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
  // Share of each scene's script words found in the recording: a low one means
  // that scene was said differently (or not at all).
  const perScene = [];
  for (let s = 0, t = 0; s < sceneTokens.length; t += sceneTokens[s].length, s++) {
    const own = match.slice(t, t + sceneTokens[s].length);
    perScene.push(own.length ? own.filter((m) => m !== null).length / own.length : 1);
  }
  return { bounds, matched: match.filter((m) => m !== null).length, perScene };
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
