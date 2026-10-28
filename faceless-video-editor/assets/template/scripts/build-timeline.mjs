// Merge project.json + voiceover timings + B-roll into public/timeline.json,
// the single file the Remotion composition renders from.
import path from "node:path";
import { BUILD, FORMATS, PUBLIC, fail, log, readJson, readProject, sceneId, writeJson } from "./lib.mjs";

const project = readProject();
const { width, height } = FORMATS[project.format];
const fps = project.fps;
const broll = readJson(path.join(BUILD, "broll.json"), {});
const GAP_MS = project.sceneGapMs ?? 120; // breath between scenes
const OUTRO_MS = project.outroMs ?? 900; // hold after the last word
const toF = (ms) => Math.round((ms / 1000) * fps);

let cursorMs = 0;
const scenes = [];
const words = [];

for (const [i, scene] of project.scenes.entries()) {
  const id = sceneId(i);
  const vo = readJson(path.join(BUILD, "vo", `${id}.json`), null);
  if (!vo) fail(`Missing build/vo/${id}.json - run the voiceover step first.`);
  const isLast = i === project.scenes.length - 1;
  const durMs = vo.durationMs + (isLast ? OUTRO_MS : GAP_MS);
  const startFrame = toF(cursorMs);
  const durationInFrames = toF(cursorMs + durMs) - startFrame;

  // Shots: split the scene evenly, then snap each cut to the nearest word start
  // so cuts land on speech rhythm instead of mid-word.
  const plan = broll[id]?.length ? broll[id] : [{ type: "kinetic" }];
  const cutsMs = [0];
  for (let k = 1; k < plan.length; k++) {
    const target = (durMs * k) / plan.length;
    const near = vo.words.reduce((b, w) => (Math.abs(w.startMs - target) < Math.abs(b - target) ? w.startMs : b), target);
    cutsMs.push(Math.min(durMs - 500, Math.max(cutsMs[k - 1] + 500, near)));
  }
  cutsMs.push(durMs);
  const shots = plan.map((asset, k) => {
    const from = toF(cutsMs[k]);
    const len = Math.max(1, toF(cutsMs[k + 1]) - from);
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

  for (const w of vo.words) {
    words.push({ text: w.text, startMs: cursorMs + w.startMs, endMs: cursorMs + w.endMs, scene: i });
  }
  scenes.push({
    id,
    startFrame,
    durationInFrames,
    audio: vo.audio,
    text: scene.text,
    emphasis: scene.emphasis ?? null,
    shots,
  });
  cursorMs += durMs;
}

const durationInFrames = toF(cursorMs);
const timeline = {
  title: project.title ?? "",
  fps,
  width,
  height,
  durationInFrames,
  style: project.style,
  captions: project.captions,
  progressBar: project.progressBar ?? project.format === "shorts",
  music: {
    src: project.music.file ?? (project.music.mood === "none" ? null : "audio/bed.wav"),
    volume: project.music.volume,
  },
  sfx: project.sfx !== false,
  scenes,
  words,
};
writeJson(path.join(PUBLIC, "timeline.json"), timeline);
log("timeline", `${scenes.length} scenes, ${scenes.reduce((n, s) => n + s.shots.length, 0)} shots, ${(cursorMs / 1000).toFixed(1)}s @ ${width}x${height}`);
