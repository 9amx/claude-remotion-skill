// Shape of public/timeline.json, written by scripts/build-timeline.mjs.
export type Word = { text: string; startMs: number; endMs: number; scene: number; hl?: boolean };

export type StillMove = "push" | "pull" | "pan-left" | "pan-right" | "tilt-up" | "tilt-down" | "detail" | "focus" | "frame";
export type Transition = "whip" | "zoom" | "glitch" | "flash" | "dip" | "fade" | "cut";
export type Look = "normal" | "flashback" | "dramatic" | "night" | "vhs" | "dream";

// Motion graphics drawn from data (components/Graphic.tsx). Map places are
// resolved to coordinates by fetch-broll (geocoded when given as names).
export type MapPlace = { name: string; lat: number; lon: number; label?: string };
export type GraphicSpec =
  | { type: "counter"; value: number; decimals?: number; prefix?: string; suffix?: string; label?: string; title?: string; source?: string }
  | { type: "bars"; data: [string, number][]; unit?: string; highlight?: number; title?: string; source?: string }
  | { type: "timeline"; events: [string, string][]; highlight?: number; title?: string; source?: string }
  | { type: "quote"; text: string; by?: string; source?: string }
  | { type: "map"; places: MapPlace[]; countries?: string[]; route?: boolean; title?: string; source?: string }
  // Explainers: each item appears on its own words ("on"); build-timeline turns
  // that into `at` (frames from the shot's start) for every item.
  | { type: "list"; items: Item[]; title?: string; numbered?: boolean; at?: number[] }
  | { type: "steps"; items: Item[]; title?: string; at?: number[] }
  | { type: "compare"; left: Side; right: Side; title?: string; at?: number[] }
  | { type: "statement"; text: string; highlight?: string; kicker?: string }
  | { type: "ui"; image: string; device?: "browser" | "phone"; url?: string; highlight?: [number, number, number, number]; on?: string; caption?: string; at?: number[] };
export type Item = string | { text: string; on?: string; icon?: string };
export type Side = { label: string; items: Item[]; tone?: "good" | "bad" };

export type Shot = {
  type: "video" | "image" | "kinetic" | "graphic";
  graphic?: GraphicSpec;
  src?: string;
  from: number; // frames, relative to the scene
  durationInFrames: number;
  zoomIn: boolean;
  playbackRate?: number;
  trimBefore?: number;
  words?: string; // what the voice says over this shot (check / sync report)
  keyword?: string;
  assetId?: string; // source-id, e.g. "wikimedia-123" (archive prints get a paper border)
  rel?: number; // how well the search result matched the keyword (0-1)
  picked?: boolean; // chosen from a review sheet
  crossesCut?: boolean; // the clip's own internal cut is visible in this shot
  move?: StillMove; // camera move on a still (build-timeline picks one; a beat can set it)
  focus?: [number, number]; // where "detail" / "push" head, % of the picture
  fadeIn?: number; // frames of crossfade from the previous shot
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
