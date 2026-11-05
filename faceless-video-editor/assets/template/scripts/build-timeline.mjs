// Merge project.json + voiceover timings + B-roll into public/timeline.json,
// the single file the Remotion composition renders from.
import path from "node:path";
import fs from "node:fs";
import { applyOverrides, hasEdits } from "./studio-overrides.mjs";
import { BUILD, FORMATS, FX, LOOKS, MOOD_BPM, PUBLIC, SFX_NAMES, TRANSITIONS, kitSfx, fail, findPhrase, log, planShots, probeDuration, probeSize, ffmpegRaw, readJson, readProject, sceneId, timecode,
  userAmbiencePath, userMusicPath, userSfx, userSfxPath, userSpotPath, writeJson } from "./lib.mjs";

const project = readProject();
const { width, height } = FORMATS[project.format];
const fps = project.fps;
const broll = readJson(path.join(BUILD, "broll.json"), {});
const GAP_MS = project.sceneGapMs ?? 120; // breath between scenes
const OUTRO_MS = project.outroMs ?? 900; // hold after the last word
// Long form with chapter cards: the card gets its own silent beat before the
// chapter's first words (it used to sit over them and hide their picture).
const CARD_LEAD_MS = 3000; // card on screen before the voice comes back
const cardsInGap = (project.chapters?.length ?? 0) > 1 && project.chapterCards !== false && project.chapterCardsOverVoice !== true;
const CHAPTER_GAP_MS = project.chapterGapMs ?? (cardsInGap ? CARD_LEAD_MS + 450 : 900); // longer breath before a new chapter
const toF = (ms) => Math.round((ms / 1000) * fps);

// auto: what alternates when nothing motivates a transition (story: softer, filmic)
const AUTO_TRANSITIONS = project.editStyle === "story" ? ["zoom", "light"] : ["whip", "zoom"];
let autoIdx = 0;
const fxList = (scene) => [].concat(scene.fx ?? []);
for (const [i, s] of project.scenes.entries()) {
  const where = `scene ${i + 1}`;
  if (s.transition && !TRANSITIONS.includes(s.transition)) fail(`${where}: transition "${s.transition}" - use ${TRANSITIONS.join(", ")}`);
  if (s.look && !LOOKS.includes(s.look)) fail(`${where}: look "${s.look}" - use ${LOOKS.join(", ")}`);
  for (const f of fxList(s)) if (!FX.includes(f)) fail(`${where}: fx "${f}" - use ${FX.join(", ")}`);
}

// Which transition enters each scene. The hook scene has none; in long form
// only chapter starts get one unless a scene asks for it explicitly.
// "auto" picks by what the cut MEANS, like an editor would: flash into a reveal,
// dip into the past / a dream or a new chapter, glitch into VHS, whip to the next
// list item, zoom into a comparison; otherwise whip and zoom alternate.
const motivated = (scene, i) => {
  const prev = project.scenes[i - 1];
  const look = scene.look ?? "normal", prevLook = prev.look ?? "normal";
  if (fxList(scene).includes("reveal")) return "flash";
  if (look !== prevLook) return look === "flashback" || look === "dream" ? "dip" : look === "vhs" ? "glitch" : look === "normal" ? "whip" : "flash";
  if (scene.chapterStart) return "dip";
  if (scene.badge) return "whip";
  if (scene.layout === "split") return "zoom";
  return null;
};
let lastAuto = null;
const transitionFor = (scene, i) => {
  if (i === 0) return "cut";
  if (scene.transition) return scene.transition;
  if (project.transitions === "none") return "cut";
  if (project.transitions === "chapter" && !scene.chapterStart) return "cut";
  if (project.transitionStyle !== "auto") return project.transitionStyle;
  let t = motivated(scene, i) ?? AUTO_TRANSITIONS[autoIdx++ % AUTO_TRANSITIONS.length];
  if (t === lastAuto && !motivated(scene, i)) t = AUTO_TRANSITIONS[autoIdx++ % AUTO_TRANSITIONS.length];
  lastAuto = t;
  return t;
};

// Sound files the script points at (beat sfx, scene ambience) must exist; kit
// slot names (hit, whoosh, pop, ...) use the kit.
const soundRef = (ref, what) => {
  const r = typeof ref === "string" ? { file: ref } : ref;
  if (!r?.file) fail(`${what}: give a file in public/ (e.g. "sfx/spot/door.mp3") or a kit sound (${SFX_NAMES.join(", ")})`);
  if (SFX_NAMES.includes(r.file)) return { ...r, slot: r.file };
  if (!fs.existsSync(path.join(PUBLIC, r.file))) fail(`${what}: ${r.file} not found in public/`);
  return r;
};
const spots = [];
const FADE_FRAMES = Math.round(fps * 0.4);

// Which part of a clip to play: a stretch without the clip's own internal cut
// (stock clips are often edits of several shots), starting a little in (they
// often open on a dull frame). Too short: slow it down, never below 0.6x.
function clipWindow(asset, need) {
  const d = asset.duration;
  const inner = (asset.cuts ?? []).filter((c) => c > 0.2 && c < d - 0.2);
  const bounds = [0, ...inner, d];
  const segs = bounds.slice(1).map((b, k) => [bounds[k], b]);
  const longest = (list) => list.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
  const fits = segs.filter(([a, b]) => b - a >= need);
  const [a, b] = fits.length ? longest(fits) : longest(segs);
  const playbackRate = b - a < need ? Math.max(0.6, (b - a) / need) : 1;
  const spare = b - a - need * playbackRate;
  const start = a + (spare > 0.3 ? Math.min(spare * 0.35, 4) : 0);
  return { playbackRate, trimBefore: Math.round(start * fps), ...(b - a < need * 0.6 - 0.05 ? { crossesCut: true } : {}) };
}

// Explainer items (list, steps, compare, ui highlight) appear on their own words:
// `at` = frames from the shot's start. An item with "on" lands a few frames
// before that phrase is spoken; the rest are spread over the shot's first 60%.
function withItemTimes(g, voWords, shotStartMs, shotFrom, len) {
  const items = g.type === "compare" ? [...g.left.items, ...g.right.items] : g.type === "ui" ? [{ on: g.on }] : g.items;
  if (!items) return g;
  // Search only around this shot: from a little before its cut (an item's words are
  // often the last ones before it) to its end. A match far away in the line is a
  // false hit and used to drop the item into the shot's last frames.
  const shotEndMs = shotStartMs + (len / fps) * 1000;
  const idxAt = (ms, d) => { const i = voWords.findIndex((w) => w.startMs >= ms); return i < 0 ? d : i; };
  const before = Math.max(0, voWords.findIndex((w) => w.endMs >= shotStartMs - 6500)); // a graphic often sums up what was just said
  const startIdx = idxAt(shotStartMs - 50, voWords.length);
  const endIdx = idxAt(shotEndMs - 150, voWords.length);
  const after = idxAt(shotEndMs + 1000, voWords.length); // said right after the cut: show it just before
  // Stage items sit anywhere on screen and can be listed in any order: each one
  // lands on its own words. Lists and steps read in order, so they keep moving forward.
  const ordered = g.type !== "stage";
  let from = startIdx;
  const spread = (i) => Math.round(4 + (i * Math.max(8, len * 0.6)) / Math.max(1, items.length));
  const at = items.map((it, i) => {
    const on = typeof it === "object" ? it?.on : null;
    if (!on) return spread(i);
    // Its own shot first, then just before the cut, then just after the shot.
    let idx = findPhrase(voWords, on, ordered ? from : startIdx, false, endIdx);
    if (idx >= 0) { if (ordered) from = idx + 1; return Math.max(0, toF(voWords[idx].startMs) - shotFrom - 3); }
    idx = findPhrase(voWords, on, before, true, startIdx);
    if (idx < 0) idx = findPhrase(voWords, on, Math.max(before, startIdx - 12), false, startIdx);
    if (idx >= 0) return 4; // said just before the cut: on screen with the cut
    idx = findPhrase(voWords, on, endIdx, false, after);
    if (idx >= 0) return Math.max(4, len - 16); // said just after: up shortly before the cut
    log("timeline", `${g.type} item "${on}" not found near its shot - placed by position`);
    return spread(i);
  });
  // A graphic never opens on an empty screen: when its first item's words come
  // later in the line (common - the phrase that names it is often at the end),
  // the first item lands with the cut instead. The rest still land on their words.
  if (at.length && at[0] > 12) at[0] = 4;
  // Never before the previous item, never after the shot.
  if (ordered) for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i], at[i - 1] + 4);
  return { ...g, at: at.map((a) => Math.min(a, Math.max(0, len - 10))) };
}

// Camera move for a still, chosen like an editor would and never the same twice
// in a row: a photo that doesn't fit the frame (portrait in 16:9, an old archive
// print) is shown whole as a framed print over its own blurred backdrop; a
// panorama pans; long holds push in on a detail; the rest rotate through push,
// pull, pans and tilts. A beat can set "move" (and "focus": [x, y] in %) itself.
const MOVES = ["push", "pan-left", "reveal", "diag-down", "pull", "parallax", "tilt-up", "snap", "pan-right", "tilt-rotate", "diag-up", "detail", "handheld", "focus", "tilt-down", "slam"];
const SHORT_ONLY = new Set(["snap", "slam", "handheld", "focus", "push", "pull"]);
const LONG_ONLY = new Set(["detail", "reveal", "parallax", "tilt-rotate"]);
const FRAME_AR = width / height;
let lastMove = null, moveIdx = 0;
const recentMoves = [];
function stillMove(shot, planned, lenSec) {
  if (planned.move) return planned.move;
  const size = shot.src ? probeSize(path.join(PUBLIC, shot.src)) : null;
  const ar = size ? size[0] / size[1] : FRAME_AR;
  const archive = /^(wikimedia|nasa|dvids)-/.test(shot.assetId ?? "");
  let m;
  // A print over a blurred copy only when the picture really can't fill the frame.
  if (ar < FRAME_AR * 0.72) m = "frame";
  else if (ar > FRAME_AR * 1.35) m = lastMove === "pan-left" ? "pan-right" : "pan-left";
  else {
    // Never one of the last five moves; a short shot takes a quick move, a long one a big one.
    for (let tries = 0; tries < MOVES.length * 2; tries++) {
      m = MOVES[moveIdx++ % MOVES.length];
      if (recentMoves.includes(m)) continue;
      if (lenSec < 2.2 && LONG_ONLY.has(m)) continue;
      if (lenSec > 6 && SHORT_ONLY.has(m)) continue;
      break;
    }
  }
  if (m !== "frame") { recentMoves.push(m); if (recentMoves.length > 5) recentMoves.shift(); }
  lastMove = m;
  return m;
}

// Every still gets its own choreography: a recipe (several moves in one shot,
// jump crops, light, film gate, depth) aimed at what is actually in THAT picture
// (the busiest regions, measured), with seeded distances, so no two look alike and
// no recipe comes back within the last six stills. A portrait picture stays a print.
const seedRand = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };
const saliencyCache = new Map();
function saliency(src) {
  if (saliencyCache.has(src)) return saliencyCache.get(src);
  const W = 48, H = 27;
  const buf = ffmpegRaw(["-i", path.join(PUBLIC, src), "-frames:v", "1", "-vf", `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  const cells = [];
  if (buf?.length >= W * H) {
    const CX = 8, CY = 5;
    for (let cy = 0; cy < CY; cy++) for (let cx = 0; cx < CX; cx++) {
      let e = 0;
      const x0 = Math.floor((cx * W) / CX), x1 = Math.floor(((cx + 1) * W) / CX), y0 = Math.floor((cy * H) / CY), y1 = Math.floor(((cy + 1) * H) / CY);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1 - 1; x++) e += Math.abs(buf[y * W + x] - buf[y * W + x + 1]) + (y < H - 1 ? Math.abs(buf[y * W + x] - buf[(y + 1) * W + x]) : 0);
      // Slight pull to the middle: the frame edge is rarely the subject.
      const px = ((cx + 0.5) / CX) * 100, py = ((cy + 0.5) / CY) * 100;
      cells.push({ x: px, y: py, e: e * (1 - (Math.abs(px - 50) + Math.abs(py - 50)) / 220) });
    }
    cells.sort((a, b) => b.e - a.e);
  }
  const picks = [];
  for (const c of cells) { if (picks.every((p) => Math.hypot(p[0] - c.x, p[1] - c.y) > 24)) picks.push([c.x, c.y]); if (picks.length === 3) break; }
  while (picks.length < 3) picks.push([[38, 44], [64, 52], [50, 36]][picks.length]);
  saliencyCache.set(src, picks);
  return picks;
}
const RECIPES = ["pushIn", "pullOut", "twoStep", "jumpCrops", "traverse", "arc", "drop", "rack", "parallax", "gate", "sweep", "tiltTravel", "breathe"];
const recentRecipes = [];
const recipeUse = {};
function choreograph(shot, lenSec) {
  const size = shot.src ? probeSize(path.join(PUBLIC, shot.src)) : null;
  const ar = size ? size[0] / size[1] : FRAME_AR;
  const rnd = seedRand(`${shot.src}|${shot.words ?? ""}`);
  if (ar < FRAME_AR * 0.72) return { move: "frame" };
  const [f1, f2, f3] = saliency(shot.src);
  const r = (a, b) => a + (b - a) * rnd();
  const at = (f, s, rot = 0, t = 0, e) => {
    const lim = 50 * (s - 1) - (Math.abs(rot) > 0 ? 1.4 : 0.2);
    const cl = (v) => Math.max(-lim, Math.min(lim, v));
    return { t, s, x: +cl(-(f[0] - 50) * s).toFixed(2), y: +cl(-(f[1] - 50) * s).toFixed(2), r: rot, ...(e ? { e } : {}) };
  };
  const mid = [50, 50];
  const old = /\b(19\d\d|cold war|soviet|embassy)\b/i.test(`${shot.keyword} ${shot.words}`);
  const allowed = RECIPES.filter((n) => {
    // A client flagged both as "glitchy": jumpCrops hard-cuts between crops of one
    // photo, parallax tears the cut-out edges. Off unless the project asks for them.
    if ((n === "jumpCrops" || n === "parallax") && !(project.stillRecipes ?? []).includes(n)) return false;
    if (recentRecipes.includes(n)) return false;
    if (n === "jumpCrops" && lenSec < 3.4) return false;
    if ((n === "twoStep" || n === "parallax" || n === "traverse") && lenSec < 2.4) return false;
    if (n === "drop" && lenSec > 6) return false;
    if (n === "gate" && !old) return false;
    return true;
  });
  // Least used first, then a seeded choice among them.
  const least = Math.min(...allowed.map((n) => recipeUse[n] ?? 0));
  const pool = allowed.filter((n) => (recipeUse[n] ?? 0) === least);
  const name = pool[Math.floor(rnd() * pool.length)] ?? "pushIn";
  recipeUse[name] = (recipeUse[name] ?? 0) + 1;
  recentRecipes.push(name); if (recentRecipes.length > 6) recentRecipes.shift();
  const big = r(1.22, 1.42), small = r(1.04, 1.1), rot = r(0.7, 1.9) * (rnd() < 0.5 ? -1 : 1);
  let p, fx;
  switch (name) {
    case "pushIn": p = [at(mid, small), at(f1, big, 0, 1)]; break;
    case "pullOut": p = [at(f1, big + 0.12), at(mid, small, 0, 1)]; break;
    case "twoStep": p = [at(f1, r(1.1, 1.16)), at(f1, r(1.17, 1.22), 0, 0.46), at(f2, r(1.3, 1.44), 0, 0.62, "snap"), at(f2, r(1.45, 1.55), 0, 1, "lin")]; break;
    case "jumpCrops": { const s1 = r(1.05, 1.12), s2 = r(1.4, 1.6), s3 = r(1.5, 1.75); p = [at(mid, s1), at(mid, s1 + 0.04, 0, 0.32, "lin"), at(f1, s2, 0, 0.33, "jump"), at(f1, s2 + 0.06, 0, 0.65, "lin"), at(f2, s3, 0, 0.66, "jump"), at(f2, s3 + 0.08, 0, 1, "lin")]; break; }
    case "traverse": { const s = r(1.26, 1.4); p = [at(f1, s, rot * 0.35), at(f2, s + r(0.02, 0.08), -rot * 0.35, 1)]; break; }
    case "arc": { const s = r(1.16, 1.24), a = at(f1, s, rot), b = at(f2, s + 0.07, 0, 0.5), c = at(f3, s + 0.13, -rot, 1); p = [a, b, c]; break; }
    case "drop": { const s = r(1.12, 1.2); p = [at(f1, s + r(0.3, 0.45), rot * 0.6), at(f1, s, 0, Math.min(0.3, 0.55 / lenSec), "snap"), at(f1, s + r(0.03, 0.06), 0, 1, "lin")]; break; }
    case "rack": p = [at(f1, r(1.1, 1.16)), at(f1, r(1.22, 1.3), 0, 1)]; fx = "rack"; break;
    case "parallax": p = [at(f2, 1.12), at(f1, 1.18, 0, 1)]; fx = "parallax"; break;
    case "gate": p = [at(mid, 1.07), at(f1, r(1.14, 1.22), 0, 1, "lin")]; fx = "gate"; break;
    case "sweep": p = [at(f1, r(1.24, 1.32)), at(mid, r(1.06, 1.1), 0, 1)]; fx = "sweep"; break;
    case "tiltTravel": { const s = r(1.28, 1.42), dir = rnd() < 0.5 ? 1 : -1; p = [at([f1[0], 50 + dir * 40], s), at([f1[0], 50 - dir * 40], s + 0.03, 0, 1)]; break; }
    default: p = [at(f1, r(1.1, 1.14), rot * 0.5), at(f1, r(1.16, 1.2), -rot * 0.5, 0.5), at(f2, r(1.12, 1.18), rot * 0.3, 1)]; break;
  }
  return { path: p, ...(fx ? { pathFx: fx } : {}), recipe: name, focus: f1 };
}

// "callouts": "auto" (default) pops *highlighted* phrases only when captions are
// off; "on" always; "off" never (a beat's own "text" always shows).
const calloutsOn = (project.callouts ?? "auto") === "on" || ((project.callouts ?? "auto") === "auto" && project.captions.style === "none");

// Color match: footage from different libraries arrives warm, cold, flat or dark.
// Measure each clip where the edit plays it (3 small frames) and pull it toward a
// common exposure, contrast and neutral white balance, so cuts don't jump; the
// style's grade then sits on one consistent base. Cached per file + window.
const ccFile = path.join(BUILD, "colorstats.json");
const ccCache = readJson(ccFile, {});
const colorMatch = project.colorMatch !== false;
function clipStats(src, startSec, lenSec, image) {
  const key = `${src}|${image ? 0 : startSec.toFixed(2)}|${image ? 0 : lenSec.toFixed(1)}`;
  if (ccCache[key]) return ccCache[key];
  const file = path.join(PUBLIC, src);
  const times = image ? [null] : [0.2, 0.5, 0.8].map((f) => startSec + lenSec * f);
  let n = 0, R = 0, G = 0, B = 0, L = 0, L2 = 0;
  for (const tm of times) {
    const buf = ffmpegRaw([...(tm != null ? ["-ss", tm.toFixed(2)] : []), "-i", file, "-frames:v", "1", "-vf", "scale=64:-2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    if (!buf?.length) continue;
    for (let i = 0; i < buf.length; i += 3) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2], l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      R += r; G += g; B += b; L += l; L2 += l * l; n++;
    }
  }
  if (!n) return null;
  const mean = L / n;
  const stats = { r: R / n, g: G / n, b: B / n, l: mean, sd: Math.sqrt(Math.max(0, L2 / n - mean * mean)) };
  ccCache[key] = stats;
  return stats;
}
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
function matchColor(stats) {
  if (!stats) return null;
  const gray = (stats.r + stats.g + stats.b) / 3;
  // Gentle: 40% of a gray-world white balance, exposure toward ~42% mean, contrast
  // toward a common spread - enough to stop cuts jumping, not enough to erase a mood.
  const wb = (c) => clampN(Math.pow(gray / Math.max(1, c), 0.4), 0.93, 1.08);
  return {
    r: +wb(stats.r).toFixed(3), g: +wb(stats.g).toFixed(3), b: +wb(stats.b).toFixed(3),
    bright: +clampN(Math.pow(107 / Math.max(1, stats.l), 0.5), 0.88, 1.2).toFixed(3),
    contrast: +clampN(Math.pow(55 / Math.max(1, stats.sd), 0.5), 0.88, 1.2).toFixed(3),
  };
}

// Edits made in the Studio (build/edits.json): moved cuts { "s002-3": +6 } (frames,
// the shot starts later / the shot before ends later) and text overrides
// { "s001:emphasis": "...", "s001:callout:0": "...", "s001:badge": "", ... } ("" removes).
const edits = readJson(path.join(BUILD, "edits.json"), { cuts: {}, text: {} });
const textEdit = (key, value) => (edits.text && key in edits.text ? (edits.text[key] === "" ? null : edits.text[key]) : value);

let cursorMs = 0;
const scenes = [];
const words = [];
const reveals = [];

for (const [i, scene] of project.scenes.entries()) {
  const id = sceneId(i);
  const vo = readJson(path.join(BUILD, "vo", `${id}.json`), null);
  if (!vo) fail(`Missing build/vo/${id}.json - run the voiceover step first.`);
  const isLast = i === project.scenes.length - 1;
  const nextStartsChapter = !isLast && project.scenes[i + 1].chapterStart;
  const durMs = vo.durationMs + (isLast ? OUTRO_MS : nextStartsChapter ? CHAPTER_GAP_MS : GAP_MS);
  const startFrame = toF(cursorMs);
  const durationInFrames = toF(cursorMs + durMs) - startFrame;

  // Shots: the same beat plan fetch-broll searched for. Each shot starts on its
  // beat's words (a couple of frames early), so the picture lands with the word.
  const split = scene.layout === "split";
  const { shots: planned } = planShots(scene, vo, project.maxShotSeconds);
  let assets = broll[id] ?? [];
  if (assets.length !== planned.length) {
    if (assets.length) log("timeline", `${id}: B-roll was fetched for a different shot plan - re-run the broll step (using what fits for now)`);
    assets = planned.map((_, k) => assets[k] ?? { type: "kinetic" });
  }
  const cutShift = (k) => (k > 0 && !split ? Number(edits.cuts?.[`${id}-${k + 1}`] ?? 0) : 0);
  const shots = planned.map((p, k) => {
    const asset = assets[k];
    const from = split ? 0 : Math.max(0, toF(p.startMs) + cutShift(k));
    // The last shot also covers the breath before the next scene.
    const end = split || k === planned.length - 1 ? durationInFrames : toF(planned[k + 1].startMs) + cutShift(k + 1);
    const len = Math.max(1, end - from);
    const shot = { ...asset, from, durationInFrames: len, zoomIn: (i + k) % 2 === 0, words: p.words, ...(cutShift(k) ? { userCut: true } : {}) };
    delete shot.cuts;
    // Items can sum up words said just before the scene began, so the search also sees
    // the previous scene's last seconds (times relative to this scene, so negative).
    const ctxWords = [...words.filter((w) => w.startMs >= cursorMs - 8000).map((w) => ({ ...w, startMs: w.startMs - cursorMs, endMs: w.endMs - cursorMs })), ...vo.words];
    if (shot.type === "graphic" && shot.graphic) shot.graphic = withItemTimes(shot.graphic, ctxWords, p.startMs, from, len);
    // Stage items can carry their own sound, landing with the item.
    if (shot.type === "graphic" && shot.graphic?.type === "stage") shot.graphic.items.forEach((it, j) => {
      if (!it.sfx) return;
      const ref = soundRef(typeof it.sfx === "string" ? { file: it.sfx } : it.sfx, `${id} stage item "${it.on}" sfx`);
      spots.push({ ...ref, at: startFrame + from + (shot.graphic.at?.[j] ?? 0) + 3, volume: ref.volume ?? 0.55, scene: id });
    });
    if (shot.type === "image") Object.assign(shot, project.stillMotion === "simple" || p.move ? { move: stillMove(shot, p, len / fps) } : choreograph(shot, len / fps), p.focus ? { focus: p.focus } : {});
    if (shot.type === "video" && shot.src) {
      // Vertical video, wide source: footage that must stay whole (archival, official, your own
      // files) is shown complete over a blurred copy of itself instead of cropped to the middle
      // third. A beat can force it ("fit": true / false) and aim the crop ("focus": [x, y] in %).
      if (p.focus) shot.focus = p.focus;
      const keep = /^(dvids|nasa|wikimedia|file|archive)/.test(shot.assetId ?? "") || /^(file|archive):/.test(p.kw ?? "");
      if (p.fit === true) shot.fit = true;
      else if (p.fit !== false && keep && height > width) {
        const size = probeSize(path.join(PUBLIC, shot.src));
        if (size && size[0] > size[1] * 1.15) shot.fit = true;
      }
    }
    if (colorMatch && (shot.type === "video" || shot.type === "image") && shot.src && !/^adobe-/.test(shot.assetId ?? "")) {
      const cc = matchColor(clipStats(shot.src, (shot.trimBefore ?? 0) / fps, (len / fps) * (shot.playbackRate ?? 1), shot.type === "image"));
      if (cc) shot.cc = cc;
    }
    if (asset.type === "video" && asset.duration) Object.assign(shot, clipWindow(asset, len / fps));
    if (p.sfx) {
      const ref = soundRef(p.sfx, `${id} beat "${p.on ?? p.kw}" sfx`);
      spots.push({ ...ref, at: startFrame + from, volume: ref.volume ?? 0.55, scene: id });
    } else if (shot.type === "graphic" && shot.graphic && project.sfxLevel > 0 && project.graphicSfx !== false) {
      // Explainers make the sound of what they show: a radar pings, and the contact
      // drops out on an impact; counters, charts and diagrams build with soft data blips.
      const g = shot.graphic, at = startFrame + from;
      if (g.type === "radar") {
        spots.push({ file: "ping", slot: "ping", at: at + 4, volume: 0.3, scene: id });
        if (g.vanish) spots.push({ file: "hit", slot: "hit", at: at + Math.round(len * (g.vanishAt ?? 0.62)), volume: 0.38, scene: id });
      } else if (["counter", "timeline", "profile", "aircraft", "bars"].includes(g.type)) {
        spots.push({ file: "data", slot: "data", at: at + 3, volume: 0.2, scene: id });
      }
    }
    // Motion graphics on the footage: each lands on its own words; none in the long-form hook.
    if (p.overlays?.length) {
      shot.overlays = p.overlays.flatMap((o) => {
        const idx = o.on ? findPhrase(vo.words, o.on, 0) : -1;
        if (o.on && idx < 0) log("timeline", `${id}: overlay "${o.text}" - "${o.on}" not found in the spoken words, placed at the shot's start`);
        const at = idx >= 0 ? Math.max(from, toF(vo.words[idx].startMs) - 2) : from + 4;
        const pinned = o.type === "callout" || o.type === "track"; // these point at something in THIS picture
        const dur = Math.min(Math.round((o.seconds ?? 2.6) * fps), (pinned ? from + len : durationInFrames) - at);
        if (dur < fps * 0.8) { log("timeline", `${id}: overlay "${o.text}" has no room on its shot, dropped`); return []; }
        if (project.format === "landscape" && startFrame + at < (project.hookTextFreeSeconds ?? 10) * fps) { log("timeline", `${id}: overlay "${o.text}" is inside the hook, dropped`); return []; }
        const { on, seconds, ...rest } = o;
        return [{ ...rest, from: at, duration: dur, shotOffset: at - from, shotLen: len, ...(shot.path ? { path: shot.path } : {}) }];
      });
    }
    return shot;
  });
  // Story / calm: a still eases in over the shot before it (or out of it) with a
  // short dissolve instead of a hard cut; footage-to-footage stays a cut.
  if (["story", "calm"].includes(project.editStyle) && !split) {
    for (let k = 1; k < shots.length; k++) {
      const a = shots[k - 1], b = shots[k];
      const card = (s) => s.type === "graphic" && s.graphic?.type === "weapon";
      if (card(a) || card(b)) b.fadeIn = Math.min(14, Math.round(b.durationInFrames / 4));
      else if (a.type !== "graphic" && b.type !== "graphic" && (a.type === "image" || b.type === "image")) b.fadeIn = Math.min(12, Math.round(b.durationInFrames / 4));
    }
  }

  // *word* markup (and any number) is a highlight: accent color in captions,
  // plus a punch-in zoom when the edit style or the scene asks for one.
  const fx = fxList(scene);
  const punches = [];
  for (const w of vo.words) {
    const hl = /\*/.test(w.text) || /\d/.test(w.text);
    words.push({ text: w.text.replace(/\*/g, ""), startMs: cursorMs + w.startMs, endMs: cursorMs + w.endMs, scene: i, ...(hl ? { hl: true } : {}) });
    const at = toF(w.startMs);
    if (hl && (project.punchIns || fx.includes("punch")) && at > 3 && (!punches.length || at - punches[punches.length - 1] >= fps * 1.2)) punches.push(at);
  }
  if (fx.includes("reveal")) reveals.push(startFrame);
  // Emphasis text lands on the words it repeats ("ON PURPOSE" when the voice says
  // "on purpose"), or on emphasisOn; else with the scene. The hook is on frame 0.
  let emphasisFrom = 0;
  if (scene.emphasis && i > 0) {
    const idx = findPhrase(vo.words, scene.emphasisOn ?? scene.emphasis.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ""), 0, !scene.emphasisOn);
    if (idx >= 0) emphasisFrom = Math.max(0, toF(vo.words[idx].startMs) - 2);
    else if (scene.emphasisOn) log("timeline", `${id}: emphasisOn "${scene.emphasisOn}" not found in the spoken words`);
  }
  // Text pops: a beat's "text" lands with its shot; with callouts on (default
  // when captions are off) every *highlighted* phrase in the line pops on the
  // word it repeats. Never over a graphic, the emphasis, or another pop.
  const callouts = [];
  const graphicAt = (f) => shots.some((sh) => sh.type === "graphic" && f >= sh.from - 4 && f < sh.from + sh.durationInFrames);
  // The emphasis stays up for the rest of its scene: no pop next to it.
  const free = (f, len) => !graphicAt(f) && !(scene.emphasis && f + len > emphasisFrom) &&
    !callouts.some((c) => f < c.from + c.duration + 6 && f + len > c.from - 6);
  planned.forEach((p, k) => {
    if (!p.text || k >= shots.length) return;
    const len = Math.min(shots[k].durationInFrames - 8, Math.round(fps * 3.5)); // ends before the cut so the next shot can carry its own name
    if (free(shots[k].from + 2, len)) callouts.push({ text: p.text, from: shots[k].from + 2, duration: len });
  });
  // Long form: no automatic text pops in the opening (picture + voice carry the hook).
  const quietUntil = project.format === "shorts" ? 0 : (project.hookTextFreeSeconds ?? 10) * fps;
  if (calloutsOn && startFrame >= quietUntil - durationInFrames) {
    let fromIdx = 0;
    // A line without *markup*: its numbers ("3 years", "$48,200", "4.1%") pop instead.
    const marked = [...scene.text.matchAll(/\*([^*]+)\*/g)].map((m) => m[1]);
    const phrases = marked.length ? marked : [...scene.text.matchAll(/[$€£৳₹]?\d[\d,.]*\s*(%|percent|million|billion|thousand|years?|months?|days?|hours?|times|x)?/gi)].map((m) => m[0]);
    for (const raw of phrases) {
      const phrase = raw.replace(/[^\p{L}\p{M}\p{N}\s$€£৳₹%.,'-]/gu, "").trim();
      const idx = findPhrase(vo.words, phrase, fromIdx);
      if (idx < 0) continue;
      fromIdx = idx + 1;
      const from = Math.max(0, toF(vo.words[idx].startMs) - 3), len = Math.min(Math.round(fps * 2.4), durationInFrames - from);
      if (len > fps && free(from, len) && startFrame + from >= quietUntil) callouts.push({ text: phrase, from, duration: len });
    }
  }
  callouts.forEach((c, n) => (c.text = textEdit(`${id}:callout:${n}`, c.text)));
  for (let n = callouts.length - 1; n >= 0; n--) if (!callouts[n].text) callouts.splice(n, 1);

  scenes.push({
    id,
    startFrame,
    durationInFrames,
    callouts,
    audio: vo.audio,
    text: scene.text,
    emphasis: textEdit(`${id}:emphasis`, scene.emphasis ?? null),
    emphasisFrom,
    lowerThird: (() => { const t = textEdit(`${id}:lowerThird`, scene.lowerThird?.title ?? null); return t ? { ...(scene.lowerThird ?? {}), title: t } : null; })(),
    badge: textEdit(`${id}:badge`, scene.badge ?? null),
    transition: transitionFor(scene, i),
    look: scene.look ?? "normal",
    fx,
    shake: fx.includes("shake") || (i === 0 && project.hookShake),
    layout: split ? "split" : "full",
    punches,
    visualExtend: 0,
    chapter: scene.chapter,
    chapterStart: scene.chapterStart,
    shots,
  });
  cursorMs += durMs;
}

// Two low-centered texts can't share the frame: the weapon name wins over a line.
for (const s of scenes) {
  for (const sh of s.shots) {
    if (!sh.overlays) continue;
    sh.overlays = sh.overlays.filter((o) => o.type !== "line" || !(s.callouts ?? []).some((c) => o.from < c.from + c.duration && c.from < o.from + o.duration));
  }
  const lines = s.shots.flatMap((sh) => sh.overlays ?? []).filter((o) => o.type === "line").sort((a, b) => a.from - b.from);
  lines.forEach((o, k) => { if (lines[k + 1]) o.duration = Math.min(o.duration, lines[k + 1].from - o.from - 2); });
  for (const sh of s.shots) if (sh.overlays) sh.overlays = sh.overlays.filter((o) => o.type !== "line" || o.duration >= fps * 0.7);
}
const durationInFrames = toF(cursorMs);
// Overlapping transitions keep the outgoing picture playing (and animating out)
// under the incoming scene for a few frames.
const OVERLAP = { fade: FADE_FRAMES, whip: 9, zoom: 10, light: 8, push: 13, wipe: 15, burn: 18, leak: 16 };
scenes.forEach((s, i) => {
  s.exit = scenes[i + 1]?.transition ?? "cut";
  s.visualExtend = OVERLAP[s.exit] ?? 0;
});

// Chapters: frame ranges, plus a YouTube description block (first must be 0:00).
const chapters = project.chapters.map((ch, c) => {
  const first = scenes.find((s) => s.chapter === c);
  // With the card in the gap the chapter (music, YouTube timestamp) starts with the card.
  return first ? { title: ch.title, ...(ch.sub ? { sub: ch.sub } : {}), mood: ch.mood, startFrame: c === 0 ? 0 : first.startFrame - (cardsInGap ? toF(CARD_LEAD_MS) : 0) } : null;
}).filter(Boolean);
chapters.forEach((ch, c) => (ch.durationInFrames = (chapters[c + 1]?.startFrame ?? durationInFrames) - ch.startFrame));

// Music: per chapter, the chapter's own track (chapters[].music, a file in
// public/) or the synthesized loop for its mood; runs sharing a source merge and
// crossfade in the composition. music.file overrides everything.
const bedFor = (mood) => (mood === "none" ? null : `audio/bed-${mood}.wav`);
const checkFile = (f) => {
  if (!fs.existsSync(path.join(PUBLIC, f))) fail(`music file not found in public/: ${f}`);
  return f;
};
const musicSegments = [];
if (project.music.file) {
  musicSegments.push({ src: userMusicPath(checkFile(project.music.file)), file: project.music.file, from: 0, durationInFrames });
} else {
  for (const [c, ch] of chapters.entries()) {
    const own = project.chapters[c].music;
    const seg = own ? { src: userMusicPath(checkFile(own)), file: own } : { mood: ch.mood, src: bedFor(ch.mood) };
    const last = musicSegments[musicSegments.length - 1];
    if (last && last.src === seg.src) last.durationInFrames += ch.durationInFrames;
    else musicSegments.push({ ...seg, from: ch.startFrame, durationInFrames: ch.durationInFrames });
  }
}

// ---------- music: beats and swells ----------
// Cuts inside a scene land on the music's beat when one is within a few frames
// (never more than 3 frames after, 5 before the planned cut, so the picture still
// arrives with its word). Beats: the synthesized beds' known tempo, or detected
// from the user's track (onset envelope -> tempo by autocorrelation -> phase).
const beatsFile = path.join(BUILD, "beats.json");
const beatCache = readJson(beatsFile, {});
function trackBeats(file) {
  const abs = path.join(PUBLIC, file), key = `${file}|${Math.round(fs.statSync(abs).mtimeMs)}`;
  if (beatCache[key]) return beatCache[key];
  const sr = 11025, hop = 128; // ~86 envelope frames per second
  const pcm = ffmpegRaw(["-i", abs, "-t", "240", "-ac", "1", "-ar", String(sr), "-f", "s16le", "-"]);
  if (!pcm?.length) return null;
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const env = [];
  for (let i = 0; i + hop <= samples.length; i += hop) { let e = 0; for (let j = i; j < i + hop; j++) e += samples[j] * samples[j]; env.push(Math.log1p(e / hop)); }
  const onset = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? v)));
  const fr = sr / hop;
  const at = (x) => { const i = Math.floor(x), f = x - i; return (onset[i] ?? 0) * (1 - f) + (onset[i + 1] ?? 0) * f; };
  // Tempo: the lag whose onsets line up best (comb over 4 multiples, so the
  // true beat beats its half / double).
  let best = { score: -1, lag: 0, bpm: 0 };
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * fr; let sc = 0;
    for (let i = 0; i < onset.length - lag * 4; i++) { if (!onset[i]) continue; sc += onset[i] * (at(i + lag) + 0.5 * at(i + 2 * lag) + 0.25 * at(i + 4 * lag)); }
    if (sc > best.score) best = { score: sc, lag, bpm };
  }
  let phase = 0, top = -1;
  for (let p = 0; p < best.lag; p += 0.5) { let sc = 0; for (let x = p; x < onset.length; x += best.lag) sc += at(x); if (sc > top) { top = sc; phase = p; } }
  return (beatCache[key] = { bpm: best.bpm, phase: phase / fr, duration: probeDuration(abs) ?? env.length / fr });
}
const XF_FRAMES = Math.round(fps * 1.5); // music crossfade in the composition
const beatFrames = [];
if (project.music.beatSync !== false) {
  musicSegments.forEach((seg, i) => {
    const start = (i > 0 ? seg.from - XF_FRAMES : seg.from) / fps, end = (seg.from + seg.durationInFrames) / fps;
    const g = seg.file ? trackBeats(seg.file) : seg.mood ? { bpm: MOOD_BPM[seg.mood] ?? MOOD_BPM.calm, phase: 0, duration: Infinity } : null;
    if (!g) return;
    const period = 60 / g.bpm, loopLen = Number.isFinite(g.duration) && g.duration > 1 ? g.duration : end - start + 1;
    // A user track loops at its own length, so its beat grid restarts with it.
    for (let loopStart = start; loopStart < end; loopStart += loopLen) {
      for (let tb = g.phase; tb < loopLen; tb += period) {
        const at = loopStart + tb;
        if (at >= end) break;
        if (at >= seg.from / fps) beatFrames.push(Math.round(at * fps));
      }
    }
  });
  beatFrames.sort((a, b) => a - b);
}
const nearestBeat = (f) => { let lo = 0, hi = beatFrames.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (beatFrames[m] < f) lo = m + 1; else hi = m; }
  return [beatFrames[lo - 1], beatFrames[lo]].filter((b) => b != null).sort((a, b) => Math.abs(a - f) - Math.abs(b - f))[0]; };
let snapped = 0;
for (const sc of scenes) {
  for (let k = 1; k < sc.shots.length; k++) {
    const sh = sc.shots[k], prev = sc.shots[k - 1];
    if (!beatFrames.length || sc.layout === "split") break;
    if (sh.userCut) continue; // a cut placed by hand in the Studio stays where it was put
    const cut = sc.startFrame + sh.from, b = nearestBeat(cut);
    if (b == null || b === cut || b - cut > 3 || cut - b > 5) continue;
    const d = b - cut;
    if (prev.durationInFrames + d < fps * 0.6 || sh.durationInFrames - d < fps * 0.6) continue;
    prev.durationInFrames += d; sh.from += d; sh.durationInFrames -= d; snapped++;
  }
}
if (beatFrames.length) log("timeline", `music: ${snapped} cut(s) moved onto the beat (within 3-5 frames of their word)`);
// Swells: the music lifts for a moment at each new chapter and on reveals.
const swells = [...chapters.slice(1).map((c) => c.startFrame), ...reveals].sort((a, b) => a - b);

// Ambience: a room-tone / location bed under the voice (scene.ambience, a file in
// public/; "none" stops it). Scenes in a row with the same file share one loop.
const ambience = [];
scenes.forEach((sc, i) => {
  const raw = project.scenes[i].ambience;
  if (!raw || raw === "none") return;
  const ref = soundRef(raw, `${sc.id} ambience`);
  if (ref.slot) fail(`${sc.id} ambience: needs a file, not the kit sound "${ref.file}"`);
  const last = ambience[ambience.length - 1];
  if (last && last.file === ref.file && last.from + last.durationInFrames === sc.startFrame) last.durationInFrames += sc.durationInFrames;
  else ambience.push({ src: userAmbiencePath(ref.file), file: ref.file, volume: ref.volume ?? 0.1, from: sc.startFrame, durationInFrames: sc.durationInFrames });
});

// SFX: user files (variants rotate) or the synthesized kit.
const user = userSfx();
// tr* transition slots fall back to the whoosh (user file or kit) when no own file exists.
const sfxFiles = Object.fromEntries(SFX_NAMES.map((n) => [n, user[n] ? user[n].map(userSfxPath) : n.startsWith("tr") ? (user.whoosh ? user.whoosh.map(userSfxPath) : kitSfx("whoosh")) : kitSfx(n)]));
const custom = Object.keys(user);
if (custom.length) log("timeline", `own SFX: ${custom.map((n) => `${n} x${user[n].length}`).join(", ")}`);

const timeline = {
  title: project.title ?? "",
  fps,
  width,
  height,
  durationInFrames,
  style: project.style,
  captions: project.captions,
  progressBar: project.progressBar ?? project.format === "shorts",
  music: { volume: project.music.volume, segments: musicSegments.filter((m) => m.src) },
  sfx: project.sfxLevel > 0,
  sfxLevel: project.sfxLevel,
  sfxFiles,
  // Beat sounds: kit slots resolve to the kit's first variant.
  spots: spots.map(({ file, slot, at, volume, scene }) => ({ src: slot ? sfxFiles[slot][0] : userSpotPath(file), file: slot ? undefined : file, at, volume, scene })),
  ambience,
  musicGapBoost: project.music.gapBoost ?? 1.7,
  swells,
  editStyle: project.editStyle,
  calloutStyle: project.calloutStyle,
  textRules: project.textRules === true,
  reveals,
  transitions: project.transitions,
  showChapterCards: chapters.length > 1 && project.chapterCards !== false,
  ...(cardsInGap ? { chapterCardLead: toF(CARD_LEAD_MS) } : {}),
  chapters,
  scenes,
  words,
};
writeJson(ccFile, ccCache);
writeJson(beatsFile, beatCache);
// Studio edits (motion, transitions, looks, color, levels) over the built timeline.
// The Studio previews its own edits over the base, so it gets the timeline without them.
writeJson(path.join(BUILD, "timeline.base.json"), timeline);
writeJson(path.join(BUILD, "edits.built.json"), edits);
writeJson(path.join(PUBLIC, "timeline.json"), hasEdits(edits) ? applyOverrides(timeline, edits) : timeline);
if (chapters.length > 1) {
  const yt = chapters.map((ch) => `${timecode(ch.startFrame / fps)} ${ch.title}`).join("\n");
  fs.writeFileSync(path.join(BUILD, "youtube-chapters.txt"), yt + "\n");
  const short = chapters.filter((ch) => ch.durationInFrames < fps * 10);
  if (short.length) log("timeline", `YouTube ignores chapters under 10s: ${short.map((c) => c.title).join(", ")}`);
}
log("timeline", `${chapters.length} chapter${chapters.length > 1 ? "s" : ""}, ${scenes.length} scenes, ${scenes.reduce((n, s) => n + s.shots.length, 0)} shots, ${(cursorMs / 1000).toFixed(1)}s @ ${width}x${height}` +
  (spots.length ? `, ${spots.length} beat SFX` : "") + (ambience.length ? `, ${ambience.length} ambience bed(s)` : ""));
const crossing = scenes.flatMap((s) => s.shots.filter((sh) => sh.crossesCut).map((sh) => `${s.id}@${timecode((s.startFrame + sh.from) / fps)}`));
if (crossing.length) log("timeline", `clips too short to avoid their own internal cut: ${crossing.join(", ")} - add another keyword to that beat or pick a longer clip`);
