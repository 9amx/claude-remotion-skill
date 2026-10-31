// AI host: an illustrated field reporter standing bottom-right who "speaks" the
// voiceover. Mouth flaps on the word timings, brows lift and the head nods on
// highlighted words, plus idle breathing and blinks. Pure SVG, no assets.
import { useMemo } from "react";
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, springs } from "../theme";
import type { Word } from "../types";

const SKIN = "#E9B08A", SKIN_SHADE = "#C98B65", HAIR = "#3A2A1F", JACKET = "#E8682A", JACKET_SHADE = "#C4521C";

// Openness 0-1 at time t: syllable-rate flap inside a word, closed between words.
const mouthAt = (words: Word[], ms: number) => {
  const w = words.find((x) => ms >= x.startMs - 30 && ms <= x.endMs);
  if (!w) return 0;
  const len = Math.max(80, w.endMs - w.startMs);
  const syllables = Math.max(1, Math.round(len / 180));
  const p = (ms - w.startMs) / len;
  return 0.25 + 0.75 * Math.abs(Math.sin(Math.PI * syllables * Math.min(1, Math.max(0, p))));
};

export const Host: React.FC<{ words: Word[]; enterAt?: number }> = ({ words, enterAt = 12 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const ms = (frame / fps) * 1000;

  // Frames where a highlighted word starts: nod + brow raise.
  const accents = useMemo(() => words.filter((w) => w.hl).map((w) => Math.round((w.startMs / 1000) * fps)), [words, fps]);
  const lastAccent = accents.filter((f) => f <= frame).pop() ?? -999;
  const accent = spring({ frame: frame - lastAccent, fps, config: springs.snappy }) * interpolate(frame - lastAccent, [6, 24], [1, 0], clamp);

  // Average of three samples a frame apart so the mouth doesn't strobe.
  const mouth = (mouthAt(words, ms) + mouthAt(words, ms - 1000 / fps) + mouthAt(words, ms + 1000 / fps)) / 3;

  // Blink every 2.6-4.2s, 5 frames long.
  let blink = 1;
  for (let b = 0, t = 20; t < frame + 10; b++, t += Math.round(fps * (2.6 + random(`blink-${b}`) * 1.6))) {
    const d = frame - t;
    if (d >= 0 && d < 5) blink = [0.5, 0.05, 0.05, 0.4, 0.85][d];
  }

  const breathe = Math.sin((frame / fps) * Math.PI * 0.5);
  const talking = mouth > 0.05 ? 1 : 0;
  const tilt = Math.sin(frame / fps * 1.3) * 1.6 * (0.4 + 0.6 * talking) + accent * 3;
  const nod = accent * 6 + Math.sin(frame / fps * 2.1) * 1.2 * talking;
  const brow = accent * 7 + mouth * 1.5;

  const enter = spring({ frame: frame - enterAt, fps, config: springs.smooth });
  const exit = interpolate(frame, [durationInFrames - 15, durationInFrames - 2], [1, 0], clamp);
  const h = height * 0.56;
  const eyeRy = 10 * blink;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg
        viewBox="0 0 400 500"
        style={{
          position: "absolute", right: width * 0.025, bottom: 0, height: h, width: h * 0.8,
          transform: `translateY(${interpolate(enter, [0, 1], [h * 0.6, 0]) + h * 0.04 * (1 - exit)}px)`,
          opacity: enter * exit, filter: "drop-shadow(0 10px 24px rgba(0,0,0,0.55))",
        }}
      >
        <defs>
          <clipPath id="host-body"><path d="M58 500 C58 405 110 352 200 346 C290 352 342 405 342 500 Z" /></clipPath>
          <radialGradient id="host-rim" cx="0.75" cy="0.25" r="0.9">
            <stop offset="0" stopColor="#FFD9A0" stopOpacity="0.35" />
            <stop offset="1" stopColor="#FFD9A0" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Torso: hi-vis field jacket, breathing */}
        <g transform={`translate(0 ${breathe * 2}) scale(1 ${1 + breathe * 0.006})`} style={{ transformOrigin: "200px 500px" }}>
          <path d="M58 500 C58 405 110 352 200 346 C290 352 342 405 342 500 Z" fill={JACKET} />
          <g clipPath="url(#host-body)">
            <path d="M58 500 C70 430 100 390 140 370 L150 500 Z" fill={JACKET_SHADE} opacity="0.55" />
            <rect x="40" y="440" width="320" height="16" fill="#D9DDE0" />
            <rect x="40" y="444" width="320" height="4" fill="#FFFFFF" opacity="0.7" />
            <rect x="120" y="360" width="14" height="140" fill="#D9DDE0" />
            <rect x="266" y="360" width="14" height="140" fill="#D9DDE0" />
          </g>
          <path d="M168 350 L200 410 L232 350 Z" fill="#22303F" />
          <path d="M168 350 L200 410 L186 352 Z" fill="#2F4256" />
          {/* USGS-style badge, generic */}
          <rect x="246" y="392" width="40" height="26" rx="4" fill="#1E2A36" />
          <path d="M252 410 L260 400 L266 406 L272 398 L280 410 Z" fill="#F2B544" />
        </g>

        {/* Neck */}
        <rect x="174" y="296" width="52" height="62" rx="14" fill={SKIN_SHADE} />

        {/* Head: tilts and nods around the neck */}
        <g transform={`translate(0 ${nod * 0.6 + breathe}) rotate(${tilt} 200 320)`}>
          <ellipse cx="129" cy="240" rx="12" ry="20" fill={SKIN_SHADE} />
          <ellipse cx="271" cy="240" rx="12" ry="20" fill={SKIN_SHADE} />
          <ellipse cx="200" cy="232" rx="72" ry="86" fill={SKIN} />
          <ellipse cx="200" cy="232" rx="72" ry="86" fill="url(#host-rim)" />
          {/* Sideburns + stubble */}
          <path d="M130 205 C128 240 134 262 140 270 L146 222 Z" fill={HAIR} />
          <path d="M270 205 C272 240 266 262 260 270 L254 222 Z" fill={HAIR} />
          <path d="M146 268 C160 312 240 312 254 268 C246 300 222 318 200 318 C178 318 154 300 146 268 Z" fill={HAIR} opacity="0.28" />
          <ellipse cx="160" cy="268" rx="13" ry="7" fill="#E07C6A" opacity="0.25" />
          <ellipse cx="240" cy="268" rx="13" ry="7" fill="#E07C6A" opacity="0.25" />

          {/* Eyes */}
          {[172, 228].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy="238" rx="13" ry={eyeRy} fill="#FBF7F2" />
              {blink > 0.3 && <circle cx={x + 1} cy="239" r={6.5 * Math.min(1, blink * 1.2)} fill="#2A1D14" />}
              {blink > 0.3 && <circle cx={x + 3.5} cy="236" r="2" fill="#FFFFFF" />}
            </g>
          ))}
          {/* Brows */}
          <rect x="156" y={212 - brow} width="32" height="7" rx="3.5" fill={HAIR} transform={`rotate(${-4 - accent * 4} 172 ${215 - brow})`} />
          <rect x="212" y={212 - brow} width="32" height="7" rx="3.5" fill={HAIR} transform={`rotate(${4 + accent * 4} 228 ${215 - brow})`} />
          {/* Nose */}
          <path d="M200 244 Q191 268 199 274 Q206 276 211 270" stroke={SKIN_SHADE} strokeWidth="4" fill="none" strokeLinecap="round" />

          {/* Mouth: a closed smile line between words, an open mouth while speaking */}
          {mouth < 0.08 ? (
            <path d="M182 292 Q200 302 218 292" stroke="#7A3328" strokeWidth="5" fill="none" strokeLinecap="round" />
          ) : (
            <g>
              <ellipse cx="200" cy={294 + mouth * 3} rx={16 + mouth * 5} ry={3 + mouth * 12} fill="#5A1E1E" />
              <rect x={188} y={290 - 1} width="24" height={Math.min(6, 2 + mouth * 6)} rx="2" fill="#F6F1EA" />
              <ellipse cx="200" cy={300 + mouth * 10} rx={8 + mouth * 2} ry={2 + mouth * 3} fill="#C45A5A" opacity={mouth > 0.4 ? 0.9 : 0} />
            </g>
          )}

          {/* Hard hat */}
          <path d="M120 196 C116 112 284 112 280 196 Z" fill="#F4F3EE" />
          <path d="M120 196 C116 112 284 112 280 196 Z" fill="url(#host-rim)" />
          <path d="M196 124 C192 150 192 180 194 196 L206 196 C208 180 208 150 204 124 Z" fill="#E2E1DA" />
          <rect x="128" y="182" width="144" height="10" fill="#F2B544" />
          <ellipse cx="200" cy="198" rx="100" ry="13" fill="#E4E3DC" />
          <ellipse cx="200" cy="195" rx="100" ry="9" fill="#F4F3EE" />
        </g>
      </svg>
    </AbsoluteFill>
  );
};
