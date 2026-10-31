// Merge project.json + voiceover timings + B-roll into public/timeline.json,
// the single file the Remotion composition renders from.
import path from "node:path";
import fs from "node:fs";
import { BUILD, FORMATS, FX, LOOKS, PUBLIC, SFX_NAMES, TRANSITIONS, fail, log, readJson, readProject, sceneId, timecode, userMusicPath, userSfx, userSfxPath, writeJson } from "./lib.mjs";

const project = readProject();
const { width, height } = FORMATS[project.format];
const fps = project.fps;
const broll = readJson(path.join(BUILD, "broll.json"), {});
const GAP_MS = project.sceneGapMs ?? 120; // breath between scenes
const OUTRO_MS = project.outroMs ?? 900; // hold after the last word
const CHAPTER_GAP_MS = project.chapterGapMs ?? 900; // longer breath before a new chapter
const toF = (ms) => Math.round((ms / 1000) * fps);

const AUTO_TRANSITIONS = ["whip", "zoom", "glitch", "flash"];
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
const transitionFor = (scene, i) => {
  if (i === 0) return "cut";
  if (scene.transition) return scene.transition;
  if (project.transitions === "none") return "cut";
  if (project.transitions === "chapter" && !scene.chapterStart) return "cut";
  return project.transitionStyle === "auto" ? AUTO_TRANSITIONS[autoIdx++ % AUTO_TRANSITIONS.length] : project.transitionStyle;
};
const FADE_FRAMES = Math.round(fps * 0.4);

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

  // Shots: split the scene evenly, then snap each cut to the nearest word start
  // so cuts land on speech rhythm instead of mid-word.
  const plan = broll[id]?.length ? broll[id] : [{ type: "kinetic" }];
  const split = scene.layout === "split";
  const cutsMs = [0];
  for (let k = 1; k < (split ? 0 : plan.length); k++) {
    const target = (durMs * k) / plan.length;
    const near = vo.words.reduce((b, w) => (Math.abs(w.startMs - target) < Math.abs(b - target) ? w.startMs : b), target);
    cutsMs.push(Math.min(durMs - 500, Math.max(cutsMs[k - 1] + 500, near)));
  }
  cutsMs.push(durMs);
  // Split layout: the first two assets play side by side for the whole scene.
  const assets = split ? [plan[0], plan[1] ?? { type: "kinetic" }] : plan;
  const shots = assets.map((asset, k) => {
    const from = split ? 0 : toF(cutsMs[k]);
    const len = split ? durationInFrames : Math.max(1, toF(cutsMs[k + 1]) - from);
    const shot = { ...asset, from, durationInFrames: len, zoomIn: (i + k) % 2 === 0 };
    if (asset.type === "video" && asset.duration) {
      const need = len / fps;
      // Slow short clips down (never below 0.6x) instead of freezing on the last frame.
      shot.playbackRate = asset.duration < need ? Math.max(0.6, asset.duration / need) : 1;
      // Start from the middle of long clips; stock clips often open on a dull frame.
      const spare = asset.duration - need * shot.playbackRate;
      shot.trimBefore = spare > 1 ? Math.round(Math.min(spare * 0.35, 4) * fps) : 0;
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
  scenes.push({
    id,
    startFrame,
    durationInFrames,
    audio: vo.audio,
    text: scene.text,
    emphasis: scene.emphasis ?? null,
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
log("timeline", `${chapters.length} chapter${chapters.length > 1 ? "s" : ""}, ${scenes.length} scenes, ${scenes.reduce((n, s) => n + s.shots.length, 0)} shots, ${(cursorMs / 1000).toFixed(1)}s @ ${width}x${height}`);
