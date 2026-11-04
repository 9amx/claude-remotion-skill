// Editing layer: camera moves (punch-ins, shake), scene transitions, looks,
// list badges and split screen. Everything here moves the PICTURE; text layers
// (captions, emphasis) stay steady on top so they remain readable.
import { useId } from "react";
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
// Whip and zoom move both pictures on one curve, so the seam travels as one
// camera move, smeared by real directional motion blur (an SVG filter: CSS
// blur() is round, a fast pan smears along its direction) with a touch of RGB
// split at the fastest frames, the way a lens and a shutter would.
const WHIP = 8, ZOOM = 9, LIGHT = 8;
const cubicOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const cubicIn = (t: number) => Math.pow(Math.min(1, Math.max(0, t)), 3);

// Directional blur (bx, by) + chromatic split (rgb px), as one SVG filter.
const FxFilter: React.FC<{ id: string; bx: number; by?: number; rgb?: number }> = ({ id, bx, by = 0, rgb = 0 }) => (
  <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
    <defs>
      <filter id={id} x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`} edgeMode="duplicate" result="b" />
        {rgb >= 0.5 ? (
          <>
            <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="r" dx={rgb} dy={0} result="ro" />
            <feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
            <feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="bl" />
            <feOffset in="bl" dx={-rgb} dy={0} result="bo" />
            <feBlend in="ro" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="bo" mode="screen" />
          </>
        ) : null}
      </filter>
    </defs>
  </svg>
);
const useFxId = () => `fx${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
// The filter is only attached while it does something (it costs render time).
const fxStyle = (id: string, bx: number, by: number, rgb: number, css: string[]): React.CSSProperties => {
  const f = [...(bx > 0.3 || by > 0.3 || rgb >= 0.5 ? [`url(#${id})`] : []), ...css].join(" ");
  return f ? { filter: f } : {};
};

// Light leak: warm film light sweeping across the cut (story / emotional beats).
const LightLeak: React.FC<{ t: number }> = ({ t }) => {
  // t: frames relative to the cut (-6 .. 22)
  const { width, height } = useVideoConfig();
  const o = interpolate(t, [-6, 0, 3, 12, 22], [0, 0.75, 0.8, 0.25, 0], clamp);
  if (o <= 0) return null;
  const x = interpolate(t, [-6, 22], [-0.35, 1.15]) * width;
  const blob = (cx: number, cy: number, r: number, c: string) => (
    <div style={{ position: "absolute", left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: "50%", background: `radial-gradient(circle, ${c} 0%, transparent 70%)` }} />
  );
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", opacity: o, pointerEvents: "none" }}>
      {blob(x, height * 0.35, width * 0.7, "rgba(255,140,60,0.9)")}
      {blob(x - width * 0.4, height * 0.62, width * 0.55, "rgba(255,70,80,0.5)")}
      {blob(x + width * 0.25, height * 0.18, width * 0.4, "rgba(255,226,150,0.85)")}
      <AbsoluteFill style={{ background: "linear-gradient(100deg, transparent 30%, rgba(255,200,140,0.35) 50%, transparent 70%)", transform: `translateX(${(x / width - 0.5) * width}px)` }} />
    </AbsoluteFill>
  );
};

export const TransitionIn: React.FC<{ type: Transition; children: React.ReactNode }> = ({ type, children }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const id = useFxId();
  let style: React.CSSProperties = {};
  let bx = 0, by = 0, rgb = 0;
  if (type === "whip") {
    // arrives from the right on the same curve the outgoing picture leaves on; blur follows speed
    const p = cubicOut(frame / WHIP), v = 1 - p;
    bx = v * v * 70; rgb = v * v * 14;
    style = { transform: `translateX(${(1 - p) * width}px)`, ...fxStyle(id, bx, 0, rgb, v > 0.02 ? [`brightness(${1 + 0.3 * v})`] : []) };
  } else if (type === "zoom") {
    // lands from a push-in: starts magnified and smeared, settles; opacity covers the seam
    const p = cubicOut(frame / ZOOM), v = 1 - p;
    bx = v * 16; by = v * 16; rgb = v * 18;
    style = { transform: `scale(${1 + 0.45 * v})`, opacity: Math.min(1, (frame + 1) / 3), ...fxStyle(id, bx, by, rgb, v > 0.02 ? [`brightness(${1 + 0.25 * v})`] : []) };
  } else if (type === "fade") {
    style = { opacity: interpolate(frame, [0, Math.round(fps * 0.4)], [0, 1], { ...clamp, easing: ease.inOut }) };
  } else if (type === "glitch" && frame < 7) {
    const j = (k: string) => (random(`${k}${frame}`) * 2 - 1);
    rgb = 10 + Math.abs(j("gr")) * 26;
    style = { transform: `translate(${j("gx") * 40}px, ${j("gy") * 8}px)`, ...fxStyle(id, 0, 0, rgb, [`contrast(1.25) saturate(1.25) hue-rotate(${j("gh") * 20}deg)`]) };
  } else if (type === "flash") {
    // exposure flash: the new picture is blown out and comes down to normal
    const v = interpolate(frame, [0, 9], [1, 0], { ...clamp, easing: ease.out });
    if (v > 0.01) style = { filter: `brightness(${1 + 1.6 * v}) saturate(${1 - 0.4 * v})` };
  } else if (type === "light") {
    const v = interpolate(frame, [0, LIGHT], [1, 0], { ...clamp, easing: ease.inOut });
    if (v > 0.01) style = { opacity: 1 - v, filter: `brightness(${1 + 0.5 * v}) sepia(${0.3 * v})` };
  }
  return (
    <AbsoluteFill>
      {bx > 0.3 || by > 0.3 || rgb >= 0.5 ? <FxFilter id={id} bx={bx} by={by} rgb={rgb} /> : null}
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {type === "glitch" && frame < 7 ? <GlitchBars frame={frame} /> : null}
      {type === "flash" ? <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 42%, #fff 0%, rgba(255,246,232,0.95) 45%, rgba(255,236,210,0.8) 100%)", mixBlendMode: "screen", opacity: interpolate(frame, [0, 2, 8], [0.95, 0.8, 0], clamp) }} /> : null}
      {type === "light" ? <LightLeak t={frame} /> : null}
    </AbsoluteFill>
  );
};

export const TransitionOut: React.FC<{ type: Transition; start: number; children: React.ReactNode }> = ({ type, start, children }) => {
  const frame = useCurrentFrame();
  const { width } = useVideoConfig();
  const id = useFxId();
  const t = frame - start;
  let style: React.CSSProperties = {};
  let bx = 0, by = 0, rgb = 0;
  if (t >= 0 && type === "whip") {
    const p = cubicOut(t / WHIP), v = 1 - p;
    bx = v * v * 70; rgb = v * v * 14;
    style = { transform: `translateX(${-p * width}px)`, ...fxStyle(id, bx, 0, rgb, []) };
  } else if (t >= -3 && type === "whip") {
    // the pan starts a beat before the cut: a quick wind-up smear
    const w = cubicIn((t + 3) / 3);
    bx = w * 40;
    style = { transform: `translateX(${-w * width * 0.06}px)`, ...fxStyle(id, bx, 0, 0, []) };
  } else if (t >= 0 && type === "zoom") {
    const p = cubicIn(Math.min(1, (t + 1) / 3));
    bx = by = p * 18; rgb = p * 16;
    style = { transform: `scale(${1 + 0.5 * p + t * 0.02})`, ...fxStyle(id, bx, by, rgb, [`brightness(${1 + 0.3 * p})`]) };
  } else if (t >= -4 && t < 0 && type === "zoom") {
    // push in to the cut
    const w = cubicIn((t + 4) / 4);
    bx = by = w * 10;
    style = { transform: `scale(${1 + 0.18 * w})`, ...fxStyle(id, bx, by, 0, []) };
  }
  return (
    <AbsoluteFill>
      {bx > 0.3 || by > 0.3 || rgb >= 0.5 ? <FxFilter id={id} bx={bx} by={by} rgb={rgb} /> : null}
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {type === "light" && t >= -6 && t < 0 ? <LightLeak t={t} /> : null}
    </AbsoluteFill>
  );
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
  if (style.editorial) {
    const o = interpolate(frame, [2, 12], [0, 1], clamp);
    return (
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div style={{
          position: "absolute", left: portrait ? width * 0.07 : width * 0.05, top: portrait ? height * 0.1 : height * 0.07, opacity: o,
          display: "flex", alignItems: "center", gap: unit * 0.014, transform: `translateY(${(1 - o) * 10}px)`,
        }}>
          {style.rules && <div style={{ width: unit * 0.03, height: 2, background: style.colors.primary }} />}
          <span style={{ fontFamily: style.fonts.label, fontWeight: 600, fontSize: unit * 0.03, letterSpacing: "0.26em", color: style.colors.text, textTransform: "uppercase", textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>{text}</span>
        </div>
      </AbsoluteFill>
    );
  }
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
