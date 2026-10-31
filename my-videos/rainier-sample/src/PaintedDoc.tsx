// Reference-style layout: AI oil paintings (one per phrase) on the left, a
// presenter panel on the right, phrase subtitles in a black box under the
// painting. Voice, words and length come from public/timeline.json.
import { useMemo } from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { PaintFx, type FxName } from "./components/PaintFx";
import type { Props } from "./Root";
import { clamp, getStyle } from "./theme";
import type { Word } from "./types";

// Painting per voiceover phrase: public/paint/NN.mp4 is its 2.5D parallax clip
// (scripts/parallax.py, same start times); fx are animated layers on top.
const PAINTINGS: { file: string; at: number; crop?: number; fx?: FxName[]; shake?: number }[] = [
  { file: "01", at: 0, fx: ["rain", "mist"] },
  { file: "02", at: 4.2, crop: 1.12, fx: ["mist"] }, // crop: painted frame border
  { file: "03", at: 9.7, fx: ["embers"] },
  { file: "04", at: 14.4, fx: ["snowstorm"], shake: 7 },
  { file: "05", at: 18.3, shake: 2 },
  { file: "06", at: 23.8, fx: ["flicker"] },
  { file: "07", at: 30.2 },
  { file: "08", at: 37.4, fx: ["specks"] },
  { file: "09", at: 40.8, fx: ["rings"] },
  { file: "10", at: 44.7, fx: ["snow"] },
  { file: "11", at: 47.3, fx: ["embers"] },
  { file: "12", at: 52.3, fx: ["snow"] },
  { file: "13", at: 56.0, fx: ["sweep"] },
  { file: "14", at: 58.2, fx: ["clouds"] },
  { file: "15", at: 62.6, fx: ["steam"] },
];
const XF = 12; // crossfade frames between paintings
const LEFT = 1280; // painting panel width; presenter gets the rest

const Painting: React.FC<{ file: string; crop: number; len: number; i: number; fx: FxName[]; shake: number }> = ({ file, crop, len, i, fx, shake }) => {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, XF], [0, 1], clamp);
  // Shake: decays over the first ~2s, a faint tremor after.
  const amp = shake * (0.3 + 0.7 * interpolate(frame, [0, 60], [1, 0], clamp));
  const sx = shake ? (random(`sx${file}${frame}`) - 0.5) * 2 * amp : 0;
  const sy = shake ? (random(`sy${file}${frame}`) - 0.5) * 2 * amp : 0;
  return (
    <AbsoluteFill style={{ opacity: i === 0 ? 1 : fade }}>
      <AbsoluteFill style={{ transform: `scale(${crop * (shake ? 1.03 : 1)}) translate(${sx}px, ${sy}px)` }}>
        <OffthreadVideo src={staticFile(`paint/${file}.mp4`)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <PaintFx fx={fx} len={len} />
    </AbsoluteFill>
  );
};

// Presenter still with subtle life: breathing, slow sway, a gentle nod on highlighted words.
const Presenter: React.FC<{ words: Word[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = frame / fps;
  const accents = useMemo(() => words.filter((w) => w.hl).map((w) => w.startMs / 1000), [words]);
  const last = accents.filter((a) => a <= s).pop() ?? -9;
  const nod = interpolate(s - last, [0, 0.25, 0.7], [0, 1, 0], clamp);
  const speaking = words.some((w) => s * 1000 >= w.startMs && s * 1000 <= w.endMs) ? 1 : 0;
  const breathe = Math.sin(s * Math.PI * 0.55);
  return (
    <div style={{ position: "absolute", left: LEFT, top: 0, width: 1920 - LEFT, height: 1080, overflow: "hidden", background: "#222" }}>
      <Img
        src={staticFile("paint/presenter.png")}
        style={{
          width: 1920 - LEFT, height: 1080, objectFit: "cover", objectPosition: "50% 20%",
          transformOrigin: "50% 45%",
          transform: `scale(${1.04 + breathe * 0.006}) translate(${Math.sin(s * 0.7) * 3}px, ${nod * 4 + breathe * 1.5}px) rotate(${Math.sin(s * 0.9) * 0.35 * (0.5 + speaking * 0.5)}deg)`,
        }}
      />
    </div>
  );
};

// Phrase subtitles: split at punctuation, then cut long phrases into even chunks of <= ~44 characters.
const MAX_CHARS = 44;
const pagesOf = (words: Word[]) => {
  const phrases: Word[][] = [[]];
  for (const w of words) {
    phrases[phrases.length - 1].push(w);
    if (/[.,!?]$/.test(w.text)) phrases.push([]);
  }
  const pages: { text: string; start: number; end: number }[] = [];
  for (const ph of phrases.filter((p) => p.length)) {
    const chars = ph.reduce((n, w) => n + w.text.length + 1, 0);
    const n = Math.ceil(chars / MAX_CHARS), per = Math.ceil(ph.length / n);
    for (let k = 0; k < ph.length; k += per) {
      const c = ph.slice(k, k + per);
      pages.push({ text: c.map((w) => w.text).join(" "), start: c[0].startMs, end: c[c.length - 1].endMs });
    }
  }
  return pages;
};

const Subtitles: React.FC<{ words: Word[]; font: string }> = ({ words, font }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pages = useMemo(() => pagesOf(words), [words]);
  const ms = (frame / fps) * 1000;
  const p = pages.find((x, k) => ms >= x.start && ms < (pages[k + 1]?.start ?? x.end + 600));
  if (!p) return null;
  return (
    <AbsoluteFill style={{ width: LEFT, alignItems: "center", justifyContent: "flex-end", paddingBottom: 92 }}>
      <div style={{
        maxWidth: LEFT * 0.78, textAlign: "center", fontFamily: font, fontWeight: 500, fontSize: 40, lineHeight: 1.18,
        color: "#fff", background: "rgba(0,0,0,0.88)", padding: "4px 14px", borderRadius: 4, boxDecorationBreak: "clone",
      }}>
        {p.text.replace(/[,.]$/, "")}
      </div>
    </AbsoluteFill>
  );
};

export const PaintedDoc: React.FC<Props> = ({ timeline }) => {
  const { fps, durationInFrames } = useVideoConfig();
  if (!timeline) return null;
  const style = getStyle("documentary");
  const starts = PAINTINGS.map((p) => Math.round(p.at * fps));
  const shaking = timeline.words.find((w) => /^shaking/i.test(w.text));
  const reveal = starts[10]; // "the hidden process..."

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ width: LEFT, overflow: "hidden" }}>
        {PAINTINGS.map((p, i) => {
          const from = starts[i];
          const len = (starts[i + 1] ?? durationInFrames) - from + XF;
          return (
            <Sequence key={p.file} from={from} durationInFrames={len} name={`paint ${p.file}`}>
              <Painting file={p.file} crop={p.crop ?? 1} len={len} i={i} fx={p.fx ?? []} shake={p.shake ?? 0} />
            </Sequence>
          );
        })}
        <div style={{ position: "absolute", left: 14, top: 10, fontFamily: style.fonts.caption, fontSize: 18, color: "rgba(255,255,255,0.55)" }}>AI</div>
      </AbsoluteFill>
      <Presenter words={timeline.words} />
      <Subtitles words={timeline.words} font={style.fonts.caption} />

      {/* Voice */}
      {timeline.scenes.map((sc) => sc.audio && (
        <Sequence key={sc.id} from={sc.startFrame} durationInFrames={sc.durationInFrames}><Audio src={staticFile(sc.audio)} /></Sequence>
      ))}
      {/* Music bed */}
      <Audio src={staticFile("audio/user/music-night-hunter.m4a")} volume={(f) => 0.13 * interpolate(f, [0, 15, durationInFrames - 30, durationInFrames], [0, 1, 1, 0], clamp)} />
      {/* SFX: opening hit, soft whoosh on each painting change, rumble on "shaking", riser + hit into the reveal */}
      <Audio src={staticFile("audio/user/sfx-hit-1.wav")} volume={0.35} />
      {starts.slice(1).map((f, i) => (
        <Sequence key={`w${f}`} from={f - 8} durationInFrames={60}><Audio src={staticFile(`audio/user/sfx-whoosh-${(i % 2) + 1}.wav`)} volume={0.12} /></Sequence>
      ))}
      {shaking && (
        <Sequence from={Math.round((shaking.startMs / 1000) * fps)} durationInFrames={160}><Audio src={staticFile("audio/user/sfx-rumble.wav")} volume={0.45} /></Sequence>
      )}
      <Sequence from={reveal - Math.round(fps * 2.6)} durationInFrames={100}><Audio src={staticFile("audio/user/sfx-riser.wav")} volume={0.25} /></Sequence>
      <Sequence from={reveal} durationInFrames={110}><Audio src={staticFile("audio/user/sfx-hit-2.wav")} volume={0.3} /></Sequence>
    </AbsoluteFill>
  );
};
