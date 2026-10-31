// Animated layers drawn over the parallax paintings: weather, particles,
// shockwave rings, flicker and steam. Deterministic (remotion `random`) so
// every render is identical.
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp } from "../theme";

export type FxName = "rain" | "mist" | "snowstorm" | "snow" | "specks" | "rings" | "embers" | "flicker" | "clouds" | "steam" | "sweep";

const W = 1280, H = 1080;

// Falling / rising particles. vx, vy in px per second.
const Particles: React.FC<{ n: number; seed: string; vx: number; vy: number; size: [number, number]; color: string; streak?: number; opacity?: number; blur?: number }> = ({ n, seed, vx, vy, size, color, streak = 0, opacity = 0.8, blur = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0, filter: blur ? `blur(${blur}px)` : undefined }}>
      {Array.from({ length: n }, (_, i) => {
        const sp = 0.6 + random(`${seed}s${i}`) * 0.8;
        const x = ((random(`${seed}x${i}`) * (W + 400) + vx * sp * t) % (W + 400) + (W + 400)) % (W + 400) - 200;
        const y = ((random(`${seed}y${i}`) * (H + 200) + vy * sp * t) % (H + 200) + (H + 200)) % (H + 200) - 100;
        const r = size[0] + random(`${seed}r${i}`) * (size[1] - size[0]);
        const o = opacity * (0.4 + 0.6 * random(`${seed}o${i}`));
        return streak ? (
          <line key={i} x1={x} y1={y} x2={x - (vx / 60) * streak} y2={y - (vy / 60) * streak} stroke={color} strokeWidth={r} strokeOpacity={o} strokeLinecap="round" />
        ) : (
          <circle key={i} cx={x} cy={y} r={r} fill={color} opacity={o} />
        );
      })}
    </svg>
  );
};

// Soft fog banks drifting sideways.
const Fog: React.FC<{ seed: string; n: number; y: [number, number]; speed: number; opacity: number; color?: string }> = ({ seed, n, y, speed, opacity, color = "255,255,255" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill>
      {Array.from({ length: n }, (_, i) => {
        const w = 500 + random(`${seed}w${i}`) * 500;
        const x = ((random(`${seed}x${i}`) * (W + w) + speed * t * (0.7 + random(`${seed}v${i}`) * 0.6)) % (W + w)) - w / 2;
        const top = y[0] + random(`${seed}y${i}`) * (y[1] - y[0]);
        return (
          <div key={i} style={{
            position: "absolute", left: x, top, width: w, height: w * 0.35, borderRadius: "50%",
            background: `radial-gradient(closest-side, rgba(${color},${opacity}), rgba(${color},0))`,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

// Concentric seismic rings expanding from a point.
const Rings: React.FC<{ cx: number; cy: number }> = ({ cx, cy }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const period = fps * 1.4;
  return (
    <svg width={W} height={H} style={{ position: "absolute", inset: 0, mixBlendMode: "screen" }}>
      {[0, 1, 2].map((k) => {
        const p = ((frame + (k * period) / 3) % period) / period;
        return <ellipse key={k} cx={cx} cy={cy} rx={60 + p * 900} ry={(60 + p * 900) * 0.45} fill="none" stroke="#FFC46B" strokeWidth={10 * (1 - p) + 2} opacity={0.85 * (1 - p)} />;
      })}
    </svg>
  );
};

// Wisps of steam rising from a cup.
const Steam: React.FC<{ cx: number; cy: number }> = ({ cx, cy }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ filter: "blur(10px)" }}>
      {Array.from({ length: 9 }, (_, i) => {
        const p = ((t * 0.35 + i / 9) % 1);
        const x = cx + Math.sin(t * 1.3 + i * 1.7) * 26 * p + (random(`st${i}`) - 0.5) * 50;
        return (
          <div key={i} style={{
            position: "absolute", left: x - 40, top: cy - p * 300, width: 80 + p * 60, height: 110,
            borderRadius: "50%", background: "rgba(255,255,255,0.75)", opacity: interpolate(p, [0, 0.2, 1], [0, 0.8, 0]),
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

const Flicker: React.FC = () => {
  const frame = useCurrentFrame();
  const o = 0.04 + 0.05 * random(`fl${Math.floor(frame / 2)}`);
  return <AbsoluteFill style={{ background: "#9fd4ff", opacity: o, mixBlendMode: "screen" }} />;
};

const Sweep: React.FC<{ len: number }> = ({ len }) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, len], [-40, 120], clamp);
  return <AbsoluteFill style={{ background: `linear-gradient(105deg, transparent ${x - 30}%, rgba(255,200,140,0.22) ${x}%, transparent ${x + 30}%)`, mixBlendMode: "screen" }} />;
};

export const PaintFx: React.FC<{ fx: FxName[]; len: number }> = ({ fx, len }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {fx.includes("rain") && <Particles n={260} seed="rain" vx={-260} vy={1500} size={[1.2, 2.6]} color="#dfe6f0" streak={2.4} opacity={0.6} />}
    {fx.includes("mist") && <Fog seed="mist" n={6} y={[H * 0.45, H * 0.8]} speed={22} opacity={0.22} />}
    {fx.includes("snowstorm") && <Particles n={320} seed="storm" vx={520} vy={260} size={[2.5, 6]} color="#ffffff" streak={1.6} opacity={0.9} />}
    {fx.includes("snow") && <Particles n={160} seed="snow" vx={30} vy={90} size={[1.5, 3.5]} color="#ffffff" opacity={0.8} blur={0.6} />}
    {fx.includes("specks") && <Particles n={140} seed="specks" vx={4} vy={-6} size={[1, 2.6]} color="#bfe6ff" opacity={0.7} />}
    {fx.includes("embers") && <Particles n={90} seed="embers" vx={12} vy={-70} size={[1.5, 3.5]} color="#ffb04a" opacity={0.85} blur={0.8} />}
    {fx.includes("rings") && <Rings cx={W * 0.55} cy={H * 0.42} />}
    {fx.includes("flicker") && <Flicker />}
    {fx.includes("clouds") && <Fog seed="clouds" n={5} y={[H * 0.02, H * 0.3]} speed={35} opacity={0.35} />}
    {fx.includes("steam") && <Steam cx={W * 0.66} cy={H * 0.4} />}
    {fx.includes("sweep") && <Sweep len={len} />}
  </AbsoluteFill>
);
