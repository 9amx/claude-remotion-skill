// Merge project.json + voiceover timings + B-roll into public/timeline.json,
// the single file the Remotion composition renders from.
import path from "node:path";
import fs from "node:fs";
import { BUILD, FORMATS, FX, LOOKS, PUBLIC, SFX_NAMES, TRANSITIONS, fail, findPhrase, log, planShots, readJson, readProject, sceneId, timecode,
  userAmbiencePath, userMusicPath, userSfx, userSfxPath, userSpotPath, writeJson } from "./lib.mjs";

const project = readProject();
const { width, height } = FORMATS[project.format];
const fps = project.fps;
const broll = readJson(path.join(BUILD, "broll.json"), {});
const GAP_MS = project.sceneGapMs ?? 120; // breath between scenes
const OUTRO_MS = project.outroMs ?? 900; // hold after the last word
const CHAPTER_GAP_MS = project.chapterGapMs ?? 900; // longer breath before a new chapter
const toF = (ms) => Math.round((ms / 1000) * fps);

const AUTO_TRANSITIONS = ["whip", "zoom"];
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
  const shots = planned.map((p, k) => {
    const asset = assets[k];
    const from = split ? 0 : toF(p.startMs);
    // The last shot also covers the breath before the next scene.
    const end = split || k === planned.length - 1 ? durationInFrames : toF(planned[k + 1].startMs);
    const len = Math.max(1, end - from);
    const shot = { ...asset, from, durationInFrames: len, zoomIn: (i + k) % 2 === 0, words: p.words };
    delete shot.cuts;
    if (asset.type === "video" && asset.duration) Object.assign(shot, clipWindow(asset, len / fps));
    if (p.sfx) {
      const ref = soundRef(p.sfx, `${id} beat "${p.on ?? p.kw}" sfx`);
      spots.push({ ...ref, at: startFrame + from, volume: ref.volume ?? 0.45, scene: id });
    }
    return shot;
  });

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
  scenes.push({
    id,
    startFrame,
    durationInFrames,
    audio: vo.audio,
    text: scene.text,
    emphasis: scene.emphasis ?? null,
    emphasisFrom,
    lowerThird: scene.lowerThird ?? null,
    badge: scene.badge ?? null,
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

const durationInFrames = toF(cursorMs);
// Overlapping transitions keep the outgoing picture playing (and animating out)
// under the incoming scene for a few frames.
const OVERLAP = { fade: FADE_FRAMES, whip: 8, zoom: 9 };
scenes.forEach((s, i) => {
  s.exit = scenes[i + 1]?.transition ?? "cut";
  s.visualExtend = OVERLAP[s.exit] ?? 0;
});

// Chapters: frame ranges, plus a YouTube description block (first must be 0:00).
const chapters = project.chapters.map((ch, c) => {
  const first = scenes.find((s) => s.chapter === c);
  return first ? { title: ch.title, mood: ch.mood, startFrame: c === 0 ? 0 : first.startFrame } : null;
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
const sfxFiles = Object.fromEntries(SFX_NAMES.map((n) => [n, user[n] ? user[n].map(userSfxPath) : [`audio/${n}.wav`]]));
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
  editStyle: project.editStyle,
  reveals,
  transitions: project.transitions,
  showChapterCards: chapters.length > 1 && project.chapterCards !== false,
  chapters,
  scenes,
  words,
};
writeJson(path.join(PUBLIC, "timeline.json"), timeline);
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
