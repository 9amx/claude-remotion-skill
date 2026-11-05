// Motion graphics ON the footage, each landing on the word it answers:
//   callout  a dot on the thing itself, a line drawn out to its name
//   track    brackets snap onto a subject and hold it
//   slug     place and date, written on in the top corner
//   stat     a number counting up in a panel
//   line     the point of the sentence in a few words, low and centered (not a caption)
// On a still the point is given in picture coordinates and follows the still's move,
// so a label stays on the part it names.
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, type Style } from "../theme";
import type { OverlaySpec, PathKey } from "../types";
import { pathAt } from "./Shot";

// Where a picture point sits on screen right now (screen % if the shot has no path).
const usePoint = (at: [number, number] | undefined, path: PathKey[] | undefined, shotOffset: number, shotLen: number) => {
  const frame = useCurrentFrame();
  if (!at) return null;
  if (!path?.length) return at;
  const p = pathAt(path, Math.min(1, (frame + shotOffset) / Math.max(1, shotLen - 1)));
  return [50 + (at[0] - 50) * p.s + p.x, 50 + (at[1] - 50) * p.s + p.y] as [number, number];
};

const Tag: React.FC<{ text: string; style: Style; size: number; p: number }> = ({ text, style, size, p }) => (
  <div style={{ display: "inline-flex", background: "rgba(13,14,16,0.86)", clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`, whiteSpace: "nowrap" }}>
    <div style={{ width: size * 0.16, background: style.colors.primary }} />
    <div style={{ padding: `${size * 0.14}px ${size * 0.5}px ${size * 0.16}px ${size * 0.36}px`, fontFamily: style.fonts.label, fontWeight: 700, fontSize: size, lineHeight: 1.1, letterSpacing: "0.07em", color: "#fff" }}>{text.toUpperCase()}</div>
  </div>
);

const Callout: React.FC<{ o: OverlaySpec; style: Style; pos: [number, number] }> = ({ o, style, pos }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const u = height / 1080;
  const x = (pos[0] / 100) * width, y = (pos[1] / 100) * height;
  const side = o.side ?? (pos[0] > 50 ? -1 : 1);
  const up = (o.rise ?? (pos[1] > 50 ? 1 : -1)) * 110 * u;
  const run = (o.reach ?? 150) * u * side;
  const dot = interpolate(frame, [0, 7], [0, 1], { ...clamp, easing: ease.out });
  const a = interpolate(frame, [3, 11], [0, 1], { ...clamp, easing: ease.out });
  const b = interpolate(frame, [10, 17], [0, 1], { ...clamp, easing: ease.out });
  const tag = interpolate(frame, [14, 24], [0, 1], { ...clamp, easing: ease.out });
  const ex = x + run * 0.4 * a, ey = y - up * a;
  const fx = ex + run * 0.6 * b;
  const ring = (frame % 40) / 40;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <circle cx={x} cy={y} r={34 * u * ring} fill="none" stroke="#fff" strokeWidth={2 * u} opacity={(1 - ring) * 0.8 * dot} />
        <circle cx={x} cy={y} r={8 * u * dot} fill={style.colors.primary} stroke="#fff" strokeWidth={2.5 * u} />
        <polyline points={`${x},${y} ${ex},${ey} ${fx},${ey}`} fill="none" stroke="#fff" strokeWidth={2.5 * u} style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.8))" }} />
      </svg>
      <div style={{ position: "absolute", top: ey - 31 * u, ...(side > 0 ? { left: fx } : { right: width - fx }) }}>
        <Tag text={o.text ?? ""} style={style} size={44 * u} p={tag} />
      </div>
    </AbsoluteFill>
  );
};

const Track: React.FC<{ o: OverlaySpec; style: Style; pos: [number, number] }> = ({ o, style, pos }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const u = height / 1080;
  const lock = interpolate(frame, [0, 11], [0, 1], { ...clamp, easing: ease.out });
  const k = interpolate(lock, [0, 1], [1.7, 1]);
  const w = (((o.size?.[0] ?? 22) / 100) * width * k) / 2, h = (((o.size?.[1] ?? 30) / 100) * height * k) / 2;
  const x = (pos[0] / 100) * width, y = (pos[1] / 100) * height;
  const len = 34 * u;
  const flick = frame < 11 && frame % 3 === 0 ? 0.4 : 1;
  const c = lock >= 1 ? "#fff" : style.colors.primary;
  const corners: [number, number, number, number][] = [[-1, -1, 1, 1], [1, -1, -1, 1], [-1, 1, 1, -1], [1, 1, -1, -1]];
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: flick }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.8))" }}>
        {corners.map(([sx, sy, dx, dy], i) => {
          const px = x + sx * w, py = y + sy * h;
          return <polyline key={i} points={`${px + dx * len},${py} ${px},${py} ${px},${py + dy * len}`} fill="none" stroke={c} strokeWidth={3.5 * u} />;
        })}
      </svg>
      {o.text && (
        <div style={{ position: "absolute", left: x - w, top: y - h - 68 * u }}>
          <Tag text={o.text} style={style} size={38 * u} p={interpolate(frame, [9, 18], [0, 1], { ...clamp, easing: ease.out })} />
        </div>
      )}
    </AbsoluteFill>
  );
};

const Slug: React.FC<{ o: OverlaySpec; style: Style }> = ({ o, style }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const u = height / 1080;
  const bar = interpolate(frame, [0, 9], [0, 1], { ...clamp, easing: ease.out });
  const title = interpolate(frame, [4, 20], [0, 1], { ...clamp, easing: ease.out });
  const sub = interpolate(frame, [14, 26], [0, 1], { ...clamp, easing: ease.out });
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: width * 0.045, top: height * 0.075, display: "flex", gap: 18 * u, textShadow: "0 2px 14px rgba(0,0,0,0.85)" }}>
        <div style={{ width: 7 * u, background: style.colors.primary, transform: `scaleY(${bar})`, transformOrigin: "top" }} />
        <div>
          <div style={{ fontFamily: style.fonts.label, fontWeight: 700, fontSize: 58 * u, lineHeight: 1.05, letterSpacing: "0.03em", color: "#fff", clipPath: `inset(-20% ${(1 - title) * 100}% -20% 0)`, whiteSpace: "nowrap" }}>{(o.text ?? "").toUpperCase()}</div>
          {o.sub && <div style={{ fontFamily: style.fonts.label, fontWeight: 500, fontSize: 31 * u, letterSpacing: "0.24em", color: "#E8E5DE", opacity: sub, transform: `translateX(${(1 - sub) * -14 * u}px)`, marginTop: 4 * u, whiteSpace: "nowrap" }}>{o.sub.toUpperCase()}</div>}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ o: OverlaySpec; style: Style }> = ({ o, style }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const u = height / 1080;
  const box = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease.out });
  const n = interpolate(frame, [5, 28], [0, 1], { ...clamp, easing: ease.out });
  const v = typeof o.value === "number" ? (o.value * n).toFixed(o.decimals ?? 0) : o.value ?? "";
  const lit = Math.round((o.bar ?? 0) * n * 20);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: width * 0.045, bottom: height * 0.085, background: "rgba(13,14,16,0.86)", padding: `${16 * u}px ${34 * u}px ${20 * u}px`, borderTop: `${4 * u}px solid ${style.colors.primary}`, clipPath: `inset(0 ${(1 - box) * 100}% 0 0)`, minWidth: 330 * u }}>
        <div style={{ fontFamily: style.fonts.label, fontWeight: 600, fontSize: 25 * u, letterSpacing: "0.2em", color: style.colors.primary, whiteSpace: "nowrap" }}>{(o.text ?? "").toUpperCase()}</div>
        <div style={{ fontFamily: style.fonts.label, fontWeight: 700, fontSize: 68 * u, lineHeight: 1.12, color: "#fff", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{o.prefix ?? ""}{v}{o.unit ? ` ${o.unit}` : ""}</div>
        {o.bar != null && <div style={{ display: "flex", gap: 4 * u, marginTop: 6 * u }}>{Array.from({ length: 20 }, (_, k) => <div key={k} style={{ flex: 1, height: 9 * u, background: k < lit ? style.colors.primary : "#33353A" }} />)}</div>}
      </div>
    </AbsoluteFill>
  );
};

const Line: React.FC<{ o: OverlaySpec; style: Style }> = ({ o, style }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const u = height / 1080;
  const size = 56 * u;
  const p = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease.out });
  const hl = o.hl?.toLowerCase();
  return (
    <AbsoluteFill style={{ pointerEvents: "none", justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.085 }}>
      <div style={{ display: "flex", columnGap: size * 0.24, padding: `${size * 0.16}px ${size * 0.5}px ${size * 0.2}px`, background: "rgba(13,14,16,0.8)", opacity: p, transform: `translateY(${(1 - p) * 14 * u}px)`, clipPath: `inset(0 ${(1 - p) * 8}% 0 ${(1 - p) * 8}%)` }}>
        {(o.text ?? "").split(/\s+/).map((w, i) => {
          const q = interpolate(frame, [2 + i * 1.5, 11 + i * 1.5], [0, 1], { ...clamp, easing: ease.out });
          return <span key={i} style={{ fontFamily: style.fonts.label, fontWeight: 600, fontSize: size, lineHeight: 1.12, color: hl && w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === hl ? "#FF4A3A" : "#fff", opacity: q, transform: `translateY(${(1 - q) * 10 * u}px)`, display: "inline-block" }}>{w}</span>;
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Overlay: React.FC<{ o: OverlaySpec; style: Style; duration: number }> = ({ o, style, duration }) => {
  const frame = useCurrentFrame();
  const pos = usePoint(o.at, o.path, o.shotOffset ?? 0, o.shotLen ?? duration);
  const out = interpolate(frame, [duration - 7, duration], [1, 0], clamp);
  if (pos && (pos[0] < 3 || pos[0] > 97 || pos[1] < 3 || pos[1] > 97)) return null; // the move took the point off the frame
  return (
    <AbsoluteFill style={{ opacity: out }}>
      {o.type === "callout" && pos && <Callout o={o} style={style} pos={pos} />}
      {o.type === "track" && pos && <Track o={o} style={style} pos={pos} />}
      {o.type === "slug" && <Slug o={o} style={style} />}
      {o.type === "stat" && <Stat o={o} style={style} />}
      {o.type === "line" && <Line o={o} style={style} />}
    </AbsoluteFill>
  );
};
