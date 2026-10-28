// Shape of public/timeline.json, written by scripts/build-timeline.mjs.
export type Word = { text: string; startMs: number; endMs: number; scene: number; hl?: boolean };

export type Transition = "whip" | "zoom" | "glitch" | "flash" | "dip" | "fade" | "cut";
export type Look = "normal" | "flashback" | "dramatic" | "night" | "vhs" | "dream";

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
  badge: string | null;
  transition: Transition; // how this scene enters
  exit: Transition; // = the next scene's transition
  look: Look;
  fx: ("shake" | "freeze" | "reveal" | "punch")[];
  shake: boolean;
  layout: "full" | "split";
  punches: number[]; // frames (relative to the scene) of punch-in zooms
  visualExtend: number; // frames the picture keeps playing under the next scene (crossfade)
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
  sfxLevel: number;
  editStyle: string;
  reveals: number[]; // absolute frames where a reveal lands
  transitions: "scene" | "chapter" | "none";
  showChapterCards: boolean;
  chapters: Chapter[];
  scenes: Scene[];
  words: Word[];
};
