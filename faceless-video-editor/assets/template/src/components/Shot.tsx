// One B-roll shot: stock video, still (slow camera move), a motion graphic, or
// the title-card fallback when nothing matched.
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";
import type { Shot as ShotT } from "../types";
import { Graphic } from "./Graphic";

// No footage: the line itself, set as a title card on a slow light sweep. It is
// a fallback - the check report counts these, and the review should replace them.
const Kinetic: React.FC<{ style: Style; seed: number; words?: string }> = ({ style, seed, words }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const unit = Math.min(width, height);
  const text = (words ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 9);
  const sweep = interpolate(frame, [0, fps * 6], [-30, 130]);
  const fontSize = Math.min(unit * 0.085, (width * 0.8) / Math.max(8, Math.sqrt(text.join(" ").length) * 3.2));
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at ${30 + (seed % 5) * 10}% 40%, ${style.colors.bgAlt}, ${style.colors.bg} 70%)`, alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ background: `linear-gradient(105deg, transparent ${sweep - 20}%, ${style.colors.primary}14 ${sweep}%, transparent ${sweep + 20}%)` }} />
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: fontSize * 0.28, width: width * 0.78, marginTop: -height * 0.06 }}>
        {text.map((w, i) => {
          const p = spring({ frame: frame - 3 - i * 3, fps, config: springs.smooth });
          return (
            <span key={i} style={{
              fontFamily: style.fonts.emphasis, fontSize, lineHeight: 1.15, color: i === text.length - 1 ? style.colors.primary : style.colors.text,
              opacity: p, transform: `translateY(${interpolate(p, [0, 1], [fontSize * 0.4, 0])}px)`, display: "inline-block",
            }}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Picture motion by edit style. "cinematic" (story, calm): real footage plays as
// shot, no zoom on top of it. "punchy" (viral, explainer): a small zoom-punch on
// each cut and a little more travel on stills. Stills get the camera move
// build-timeline chose for them (never the same twice in a row).
export type Motion = "cinematic" | "punchy";

// Color match (build-timeline measured the clip): per-channel white balance as an
// SVG color matrix, then exposure and contrast, so clips from different
// libraries cut together like one shoot.
const ccId = (shot: ShotT, seed: number) => `cc-${seed}-${shot.from}`;
const CcFilter: React.FC<{ shot: ShotT; seed: number }> = ({ shot, seed }) => shot.cc ? (
  <svg width="0" height="0" style={{ position: "absolute" }}>
    <filter id={ccId(shot, seed)} colorInterpolationFilters="sRGB">
      <feColorMatrix type="matrix" values={`${shot.cc.r} 0 0 0 0  0 ${shot.cc.g} 0 0 0  0 0 ${shot.cc.b} 0 0  0 0 0 1 0`} />
    </filter>
  </svg>
) : null;
const ccCss = (shot: ShotT, seed: number, base: string) =>
  shot.cc ? `url(#${ccId(shot, seed)}) brightness(${shot.cc.bright}) contrast(${shot.cc.contrast}) ${base}` : base;
const THIRDS: [number, number][] = [[33, 38], [67, 38], [50, 45], [33, 62], [67, 62]];

const Still: React.FC<{ shot: ShotT; seed: number; motion: Motion }> = ({ shot, seed, motion }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const t = interpolate(frame, [0, shot.durationInFrames], [0, 1], { ...clamp, easing: ease.inOut });
  const k = motion === "punchy" ? 1.35 : 1;
  const move = shot.move ?? (["push", "pan-left", "pull", "pan-right"] as const)[seed % 4];
  const [fx, fy] = shot.focus ?? THIRDS[seed % THIRDS.length];
  const src = staticFile(shot.src!);
  const look: React.CSSProperties = { filter: ccCss(shot, seed, "saturate(1.05) contrast(1.05)") };
  const lerp = (a: number, b: number) => interpolate(t, [0, 1], [a, b]);
  const grow = (a: number, b: number) => 1 + (lerp(a, b) - 1) * k;

  if (move === "frame") {
    // The whole picture as a print over its own darkened, blurred copy. The blur
    // runs on a quarter-size layer scaled up: same look, a fraction of the cost.
    const archive = /^(wikimedia|nasa|dvids)-/.test(shot.assetId ?? "");
    const settle = spring({ frame, fps: 30, config: springs.smooth });
    const variant = seed % 4;
    const side = seed % 8 < 4 ? 1 : -1;
    const entrance =
      variant === 1 ? `translateX(${interpolate(settle, [0, 1], [side * 70, 0])}%) rotate(${interpolate(settle, [0, 1], [side * 3, side * -0.6])}deg) scale(${lerp(1, 1.06)})`
      : variant === 2 ? `translateY(${interpolate(settle, [0, 1], [-60, 0])}%) rotate(${interpolate(settle, [0, 1], [side * -5, side * 0.8])}deg) scale(${lerp(1.02, 1.08)})`
      : variant === 3 ? `scale(${interpolate(settle, [0, 1], [0.9, 1]) * lerp(1, 1.3)})`
      : `scale(${interpolate(settle, [0, 1], [0.94, 1]) * lerp(1, 1.05)}) rotate(${lerp(seed % 2 ? -1.2 : 1.2, seed % 2 ? 0.4 : -0.4)}deg)`;
    return (
      <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: "25%", height: "25%", transform: `scale(${4 * lerp(1.15, 1.25)})`, transformOrigin: "0 0" }}>
          <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(6px) brightness(0.42) saturate(0.75)" }} />
        </div>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Img src={src} style={{
            maxWidth: "80%", maxHeight: "84%", ...look,
            border: archive ? `${width * 0.006}px solid #EFE8DA` : "none", borderRadius: archive ? 2 : width * 0.006,
            boxShadow: `0 ${width * 0.012}px ${width * 0.04}px rgba(0,0,0,0.65)`,
            transform: entrance,
          }} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  if (move === "parallax") {
    // Fake depth: the middle of the picture slides against the rest of it.
    const mask = `radial-gradient(ellipse 46% 56% at ${fx}% ${fy}%, #000 62%, transparent 100%)`;
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <AbsoluteFill style={{ transform: `translateX(${lerp(3, -3)}%) scale(1.14)` }}>
          <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", ...look }} />
        </AbsoluteFill>
        <AbsoluteFill style={{ transform: `translateX(${lerp(-3.5, 3.5)}%) scale(${lerp(1.2, 1.28)})`, transformOrigin: `${fx}% ${fy}%`, WebkitMaskImage: mask, maskImage: mask }}>
          <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", ...look }} />
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  let scale = 1, x = 0, y = 0, blur = 0, rotate = 0, origin = "50% 50%";
  const snapIn = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease.out });
  const creep = interpolate(frame, [0, shot.durationInFrames], [0, 1], clamp);
  switch (move) {
    case "push": scale = grow(1.03, 1.2); origin = `${fx}% ${fy}%`; break;
    case "pull": scale = grow(1.22, 1.03); origin = `${fx}% ${fy}%`; break;
    case "pan-left": scale = 1.2; x = lerp(6, -6) * k; break;
    case "pan-right": scale = 1.2; x = lerp(-6, 6) * k; break;
    case "tilt-up": scale = 1.2; y = lerp(-5, 5) * k; break;
    case "tilt-down": scale = 1.2; y = lerp(5, -5) * k; break;
    case "detail": scale = grow(1.03, 1.42); origin = `${fx}% ${fy}%`; break;
    case "diag-down": scale = 1.22; x = lerp(-5, 5) * k; y = lerp(-4, 4) * k; break;
    case "diag-up": scale = 1.22; x = lerp(5, -5) * k; y = lerp(4, -4) * k; break;
    case "reveal": scale = grow(1.55, 1.05); origin = `${fx}% ${fy}%`; break;
    case "tilt-rotate": scale = grow(1.1, 1.24); rotate = lerp(-2, 1.6); origin = `${fx}% ${fy}%`; break;
    case "handheld": scale = 1.14; x = Math.sin(frame / 17) * 1.1 + Math.sin(frame / 7) * 0.3; y = Math.cos(frame / 23) * 0.9; rotate = Math.sin(frame / 29) * 0.45; break;
    case "snap": scale = 1.02 + 0.16 * snapIn + 0.07 * creep; origin = `${fx}% ${fy}%`; blur = (1 - snapIn) * 5; break;
    case "slam": scale = 1.38 - 0.3 * snapIn + 0.06 * creep; origin = `${fx}% ${fy}%`; blur = (1 - snapIn) * 7; break;
    case "focus":
      scale = grow(1.12, 1.04);
      blur = interpolate(frame, [0, 14], [10, 0], { ...clamp, easing: ease.out });
      break;
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `translate(${x}%, ${y}%) scale(${scale}) rotate(${rotate}deg)`, transformOrigin: origin }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", ...look, ...(blur > 0.05 ? { filter: `${look.filter} blur(${blur}px)` } : {}) }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Shot: React.FC<{ shot: ShotT; style: Style; seed: number; motion?: Motion }> = ({ shot, style, seed, motion = "punchy" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = shot.fadeIn ? interpolate(frame, [0, shot.fadeIn], [0, 1], { ...clamp, easing: ease.inOut }) : 1;
  // Graphics have their own motion; no Ken Burns or cut punch on top of a chart.
  if (shot.type === "graphic" && shot.graphic) return <Graphic graphic={shot.graphic} style={style} />;
  if (shot.type !== "video" && shot.type !== "image" || !shot.src) return <Kinetic style={style} seed={seed} words={shot.words} />;
  const punch = motion === "punchy" ? interpolate(spring({ frame, fps, config: springs.punch }), [0, 1], [1.06, 1]) : 1;
  if (shot.type === "image") {
    return <AbsoluteFill style={{ opacity: fade, transform: `scale(${punch})` }}><CcFilter shot={shot} seed={seed} /><Still shot={shot} seed={seed} motion={motion} /></AbsoluteFill>;
  }
  // Footage already moves: in punchy edits only a slight push so held clips don't feel parked.
  const t = interpolate(frame, [0, shot.durationInFrames], [0, 1], { ...clamp, easing: ease.inOut });
  const scale = motion === "punchy" ? interpolate(t, [0, 1], shot.zoomIn ? [1, 1.04] : [1.04, 1]) : 1;
  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity: fade }}>
      <CcFilter shot={shot} seed={seed} />
      <AbsoluteFill style={{ transform: `scale(${punch * scale})` }}>
        <OffthreadVideo
          src={staticFile(shot.src)}
          muted
          playbackRate={shot.playbackRate ?? 1}
          trimBefore={shot.trimBefore || undefined}
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: ccCss(shot, seed, "saturate(1.08) contrast(1.06)") }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
