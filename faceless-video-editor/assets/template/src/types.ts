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
  words?: string; // what the voice says over this shot (check / sync report)
  keyword?: string;
  rel?: number; // how well the search result matched the keyword (0-1)
  picked?: boolean; // chosen from a review sheet
  crossesCut?: boolean; // the clip's own internal cut is visible in this shot
};

export type Scene = {
  id: string;
  startFrame: number;
  durationInFrames: number;
  audio: string | null;
  text: string;
  emphasis: string | null;
  emphasisFrom: number; // frame (relative to the scene) the emphasis lands on
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

// A sound on a beat (door slam on the door shot), onset-aligned to `at`.
export type Spot = { src: string; file?: string; at: number; volume: number; scene: string };
export type AmbienceSegment = { src: string; file: string; volume: number; from: number; durationInFrames: number };

export type MusicSegment = { src: string; from: number; durationInFrames: number; mood?: string; file?: string };

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
  sfxFiles?: Record<string, string[]>; // slot -> files (own SFX variants or the synthesized one)
  sfxPeaks?: Record<string, number>; // file -> ms from its start to its alignment point (peak for whoosh/riser, onset otherwise)
  spots?: Spot[];
  ambience?: AmbienceSegment[];
  musicGapBoost?: number; // music rises by this factor when nobody is speaking
  editStyle: string;
  reveals: number[]; // absolute frames where a reveal lands
  transitions: "scene" | "chapter" | "none";
  showChapterCards: boolean;
  chapters: Chapter[];
  scenes: Scene[];
  words: Word[];
};
