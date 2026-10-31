// Editing layer: camera moves (punch-ins, shake), scene transitions, looks,
// list badges and split screen. Everything here moves the PICTURE; text layers
// (captions, emphasis) stay steady on top so they remain readable.
import { AbsoluteFill, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";
import type { Look, Transition } from "../types";

// ---------- camera ----------
// Punch-in: snap ~11% closer on a highlighted word, hold ~1s, ease back.
// Shake: short decaying impact shake (hook, fx "shake").
export const Camera: React.FC<{ punches: number[]; shake: boolean; children: React.ReactNode }> = ({ punches, shake, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let zoom = 1;
  for (const p of punches) {
    if (frame < p) break;
    const hold = Math.round(fps * 1.0);
    const into = spring({ frame: frame - p, fps, config: springs.punch });
    const out = interpolate(frame, [p + hold, p + hold + 12], [1, 0], { ...clamp, easing: ease.inOut });
    zoom = Math.max(zoom, 1 + 0.11 * into * out);
  }
  const amp = shake ? interpolate(frame, [0, 12], [26, 0], clamp) : 0;
  const x = amp * (random(`sx${frame}`) * 2 - 1);
  const y = amp * (random(`sy${frame}`) * 2 - 1);
  return <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})` }}>{children}</AbsoluteFill>;
};

// ---------- transitions ----------
// enter: how this scene's picture arrives; exit: how it leaves while the next
// one arrives on top (only for transitions that overlap, see visualExtend).
export const TransitionIn: React.FC<{ type: Transition; children: React.ReactNode }> = ({ type, children }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  let style: React.CSSProperties = {};
  if (type === "whip") {
    const p = interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: ease.out });
    style = { transform: `translateX(${(1 - p) * width}px)`, filter: `blur(${(1 - p) * 24}px)` };
  } else if (type === "zoom") {
    const p = interpolate(frame, [0, 9], [0, 1], { ...clamp, easing: ease.out });
    style = { transform: `scale(${1.35 - 0.35 * p})`, filter: `blur(${(1 - p) * 16}px)`, opacity: Math.min(1, p * 2) };
  } else if (type === "fade") {
    style = { opacity: interpolate(frame, [0, Math.round(fps * 0.4)], [0, 1], { ...clamp, easing: ease.inOut }) };
  } else if (type === "glitch" && frame < 7) {
    const j = (k: string) => (random(`${k}${frame}`) * 2 - 1);
    style = { transform: `translate(${j("gx") * 40}px, ${j("gy") * 8}px)`, filter: `hue-rotate(${j("gh") * 90}deg) contrast(1.6) saturate(1.8)` };
  }
  return (
    <AbsoluteFill style={style}>
      {children}
      {type === "glitch" && frame < 7 && <GlitchBars frame={frame} />}
      {type === "flash" && <AbsoluteFill style={{ background: "#fff", mixBlendMode: "overlay", opacity: interpolate(frame, [0, 7], [0.6, 0], clamp) }} />}
    </AbsoluteFill>
  );
};

export const TransitionOut: React.FC<{ type: Transition; start: number; children: React.ReactNode }> = ({ type, start, children }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const t = frame - start;
  let style: React.CSSProperties = {};
  if (t >= 0 && type === "whip") {
    const p = interpolate(t, [0, 8], [0, 1], { ...clamp, easing: ease.in });
    style = { transform: `translateX(${-p * width * 0.6}px)`, filter: `blur(${p * 24}px)` };
  } else if (t >= 0 && type === "zoom") {
    const p = interpolate(t, [0, 9], [0, 1], { ...clamp, easing: ease.in });
    style = { transform: `scale(${1 + 0.6 * p})`, filter: `blur(${p * 12}px)` };
  }
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

const GlitchBars: React.FC<{ frame: number }> = ({ frame }) => {
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} style={{
          position: "absolute", left: 0, right: 0,
          top: random(`gt${frame}-${i}`) * height, height: 6 + random(`gh${frame}-${i}`) * height * 0.06,
          background: i % 2 ? "rgba(255,0,80,0.55)" : "rgba(0,240,255,0.5)",
          transform: `translateX(${(random(`go${frame}-${i}`) * 2 - 1) * 120}px)`,
        }} />
      ))}
    </AbsoluteFill>
  );
};

// Dip to black across a cut: picture fades out, then the next one fades up.
export const Dip: React.FC<{ half: number }> = ({ half }) => {
  const frame = useCurrentFrame();
  const o = frame < half ? interpolate(frame, [0, half], [0, 1], { ...clamp, easing: ease.inOut }) : interpolate(frame, [half, half * 2.2], [1, 0], { ...clamp, easing: ease.out });
  return <AbsoluteFill style={{ background: "#000", opacity: o }} />;
};

// ---------- looks ----------
const LOOK_FILTER: Record<Look, string> = {
  normal: "none",
  flashback: "grayscale(1) sepia(0.4) contrast(1.12) brightness(0.92)",
  dramatic: "saturate(0.5) contrast(1.3) brightness(0.88)",
  night: "saturate(0.65) brightness(0.78) hue-rotate(-12deg)",
  vhs: "saturate(1.35) contrast(1.12) brightness(1.02)",
  dream: "saturate(1.12) brightness(1.08) blur(0.8px)",
};

export const LookFilter: React.FC<{ look: Look; children: React.ReactNode }> = ({ look, children }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ filter: LOOK_FILTER[look] }}>
      {children}
      {look === "night" && <AbsoluteFill style={{ background: "#0b2a6b", mixBlendMode: "multiply", opacity: 0.35 }} />}
      {look === "dream" && <AbsoluteFill style={{ background: "radial-gradient(circle, rgba(255,240,220,0.35), transparent 70%)", mixBlendMode: "screen" }} />}
      {look === "flashback" && <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 45%, rgba(20,12,0,0.55) 100%)" }} />}
      {look === "vhs" && (
        <AbsoluteFill style={{
          backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 2px, transparent 2px, transparent 5px)",
          transform: `translateY(${(frame * 2) % 5}px)`,
        }}>
          {/* tracking band rolling down the frame */}
          <div style={{ position: "absolute", left: 0, right: 0, height: height * 0.05, top: ((frame * 9) % (height * 1.2)) - height * 0.1, background: "rgba(255,255,255,0.08)", filter: "blur(4px)" }} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ---------- badge (listicles: "#3", "STEP 2", "MYTH") ----------
export const Badge: React.FC<{ text: string; style: Style }> = ({ text, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = Math.min(width, height);
  const p = spring({ frame: frame - 2, fps, config: springs.snappy });
  const portrait = height > width;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{
        position: "absolute", left: portrait ? width * 0.07 : width * 0.04, top: portrait ? height * 0.1 : height * 0.06,
        padding: `${unit * 0.012}px ${unit * 0.03}px`, borderRadius: unit * 0.02, background: style.colors.primary, color: style.colors.outline,
        fontFamily: style.fonts.emphasis, fontSize: unit * 0.07, lineHeight: 1, textTransform: "uppercase",
        transform: `translateX(${interpolate(p, [0, 1], [-unit * 0.15, 0])}px) rotate(${interpolate(p, [0, 1], [-8, -3])}deg) scale(${interpolate(p, [0, 1], [0.7, 1])})`,
        opacity: p, boxShadow: `0 ${unit * 0.01}px ${unit * 0.04}px rgba(0,0,0,0.45)`,
      }}>{text}</div>
    </AbsoluteFill>
  );
};

// ---------- split screen (comparisons: then vs now, myth vs fact) ----------
export const Split: React.FC<{ a: React.ReactNode; b: React.ReactNode; style: Style }> = ({ a, b, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const p = spring({ frame, fps, config: springs.smooth });
  const q = spring({ frame: frame - 5, fps, config: springs.smooth });
  const unit = Math.min(width, height);
  const half: React.CSSProperties = portrait ? { position: "absolute", left: 0, right: 0, height: "50%", overflow: "hidden" } : { position: "absolute", top: 0, bottom: 0, width: "50%", overflow: "hidden" };
  return (
    <AbsoluteFill>
      <div style={{ ...half, ...(portrait ? { top: 0 } : { left: 0 }), transform: portrait ? `translateY(${(1 - p) * -40}%)` : `translateX(${(1 - p) * -40}%)` }}>{a}</div>
      <div style={{ ...half, ...(portrait ? { bottom: 0 } : { right: 0 }), transform: portrait ? `translateY(${(1 - q) * 40}%)` : `translateX(${(1 - q) * 40}%)` }}>{b}</div>
      <div style={{ position: "absolute", background: style.colors.primary, ...(portrait ? { left: 0, right: 0, top: "50%", height: unit * 0.008, transform: `translateY(-50%) scaleX(${q})` } : { top: 0, bottom: 0, left: "50%", width: unit * 0.008, transform: `translateX(-50%) scaleY(${q})` }) }} />
      <div style={{
        position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) scale(${q})`,
        width: unit * 0.14, height: unit * 0.14, borderRadius: "50%", background: style.colors.primary, color: style.colors.outline,
        display: "flex", alignItems: "center", justifyContent: "center", fontFamily: style.fonts.emphasis, fontSize: unit * 0.055,
        boxShadow: `0 0 ${unit * 0.04}px rgba(0,0,0,0.5)`,
      }}>VS</div>
    </AbsoluteFill>
  );
};
