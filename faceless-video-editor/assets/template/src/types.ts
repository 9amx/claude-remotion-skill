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
  shots: Shot[];
};

export type Timeline = {
  title: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  style: string;
  captions: { style: "pop" | "karaoke" | "boxed"; maxWords: number; position?: number; uppercase?: boolean };
  progressBar: boolean;
  music: { src: string | null; volume: number };
  sfx: boolean;
  scenes: Scene[];
  words: Word[];
};
