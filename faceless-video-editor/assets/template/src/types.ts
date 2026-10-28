// Shape of public/timeline.json, written by scripts/build-timeline.mjs.
export type Word = { text: string; startMs: number; endMs: number; scene: number };

export type Shot = {
  type: "video" | "image" | "kinetic";
  src?: string;
  from: number; // frames, relative to the scene
  durationInFrames: number;
  zoomIn: boolean;
  playbackRate?: number;
  trimBefore?: number;
};

export type Scene = {
  id: string;
  startFrame: number;
  durationInFrames: number;
  audio: string | null;
  text: string;
  emphasis: string | null;
  lowerThird: { title: string; subtitle?: string } | null;
  chapter: number;
  chapterStart: boolean;
  shots: Shot[];
};

export type Chapter = { title: string; mood: string; startFrame: number; durationInFrames: number };

export type MusicSegment = { src: string; from: number; durationInFrames: number; mood?: string };

export type Timeline = {
  title: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  style: string;
  captions: { style: "pop" | "karaoke" | "boxed" | "subtitle" | "none"; maxWords: number; position?: number; uppercase?: boolean };
  progressBar: boolean;
  music: { volume: number; segments: MusicSegment[] };
  sfx: boolean;
  transitions: "scene" | "chapter" | "none";
  showChapterCards: boolean;
  chapters: Chapter[];
  scenes: Scene[];
  words: Word[];
};
