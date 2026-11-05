// Weapon dossier card: the gun alone on a light studio floor, a name tag with its
// year, and three specs that count up. Drawn from data, so a card is always exact.
// The picture is multiplied onto the floor, so a white-background photo needs no cutout.
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";

export type WeaponSpec = { label: string; value: string | number; prefix?: string; unit?: string; decimals?: number; bar?: number };
export type WeaponG = { type: "weapon"; name: string; year?: string; era?: string; image: string; step?: number; steps?: number; specs: WeaponSpec[]; scale?: number; flip?: boolean };

const Floor: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  const horizon = height * 0.64;
  const lines = Array.from({ length: 15 }, (_, i) => i - 7);
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
      {lines.map((i) => <line key={i} x1={width / 2 + i * width * 0.09} y1={horizon} x2={width / 2 + i * width * 0.34} y2={height} stroke="#00000012" strokeWidth={1.5} />)}
      {[0, 0.09, 0.22, 0.42, 0.7].map((k) => <line key={k} x1={0} x2={width} y1={horizon + (height - horizon) * k} y2={horizon + (height - horizon) * k} stroke="#00000010" strokeWidth={1.5} />)}
    </svg>
  );
};

const Corner: React.FC<{ x: number; y: number; sx: number; sy: number; size: number; p: number }> = ({ x, y, sx, sy, size, p }) => (
  <svg width={size} height={size} style={{ position: "absolute", left: x - (sx < 0 ? size : 0), top: y - (sy < 0 ? size : 0), opacity: p, transform: `scale(${sx},${sy}) translate(${(1 - p) * -18}px, ${(1 - p) * -18}px)` }}>
    <path d={`M1.5 ${size} V1.5 H${size}`} fill="none" stroke="#17181B" strokeWidth={3} />
  </svg>
);

export const WeaponCard: React.FC<{ g: WeaponG; style: Style; durationInFrames: number }> = ({ g, style, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const u = height / 1080;
  const label = style.fonts.label;
  const red = style.colors.primary;

  const tag = interpolate(frame, [3, 15], [0, 1], { ...clamp, easing: ease.out });
  const sub = interpolate(frame, [9, 20], [0, 1], { ...clamp, easing: ease.out });
  const corners = spring({ frame: frame - 6, fps, config: springs.smooth });
  const panel = interpolate(frame, [8, 22], [0, 1], { ...clamp, easing: ease.out });
  const gunIn = spring({ frame, fps, config: springs.smooth });
  const drift = interpolate(frame, [0, durationInFrames], [0, 1], clamp);
  const hover = Math.sin(frame / 24) * 5 * u;
  const steps = g.steps ?? 8;

  return (
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #F7F7F4 0%, #ECECE8 55%, #D9D9D4 100%)", overflow: "hidden" }}>
      <Floor width={width} height={height} />

      {/* the gun, with a soft contact shadow under it */}
      <div style={{ position: "absolute", left: "22%", right: "22%", top: height * 0.72, height: height * 0.05, background: "radial-gradient(ellipse at center, rgba(0,0,0,0.3), transparent 70%)", opacity: gunIn * 0.75, filter: `blur(${10 * u}px)`, transform: `scaleX(${1 + Math.sin(frame / 24) * 0.02})` }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: height * 0.03 }}>
        <Img src={staticFile(g.image)} style={{
          maxWidth: `${(g.scale ?? 1) * 64}%`, maxHeight: "50%", objectFit: "contain", mixBlendMode: "multiply",
          opacity: gunIn,
          transform: `translate(${interpolate(gunIn, [0, 1], [-40 * u, 0]) + drift * 14 * u}px, ${hover}px) scale(${(0.97 + drift * 0.045) * (g.flip ? -1 : 1)}, ${0.97 + drift * 0.045})`,
        }} />
      </AbsoluteFill>

      <Corner x={width * 0.074} y={height * 0.26} sx={1} sy={1} size={46 * u} p={corners} />
      <Corner x={width * 0.926} y={height * 0.26} sx={-1} sy={1} size={46 * u} p={corners} />
      <Corner x={width * 0.074} y={height * 0.765} sx={1} sy={-1} size={46 * u} p={corners} />
      <Corner x={width * 0.926} y={height * 0.765} sx={-1} sy={-1} size={46 * u} p={corners} />

      {/* name tag */}
      <div style={{ position: "absolute", left: width * 0.042, top: height * 0.066, clipPath: `inset(0 ${(1 - tag) * 100}% 0 0)` }}>
        <div style={{ display: "flex", background: "#17181B", clipPath: `polygon(0 0, calc(100% - ${26 * u}px) 0, 100% ${26 * u}px, 100% 100%, 0 100%)` }}>
          <div style={{ width: 16 * u, background: red }} />
          <div style={{ padding: `${10 * u}px ${70 * u}px ${12 * u}px ${44 * u}px`, fontFamily: label, fontWeight: 700, fontSize: 92 * u, lineHeight: 1.05, color: "#fff", letterSpacing: "0.015em" }}>{g.name}</div>
        </div>
        {(g.year || g.era) && (
          <div style={{ display: "flex", marginLeft: 16 * u, opacity: sub, transform: `translateY(${(1 - sub) * -14 * u}px)`, fontFamily: label, fontWeight: 700, fontSize: 31 * u, letterSpacing: "0.1em" }}>
            {g.year && <div style={{ background: red, color: "#fff", padding: `${6 * u}px ${18 * u}px` }}>{g.year}</div>}
            {g.era && <div style={{ background: "#fff", color: "#17181B", padding: `${6 * u}px ${22 * u}px` }}>{g.era.toUpperCase()}</div>}
          </div>
        )}
      </div>

      {/* where we are in the story */}
      {g.era && (
        <div style={{ position: "absolute", right: width * 0.042, top: height * 0.066, textAlign: "right", opacity: sub }}>
          <div style={{ fontFamily: label, fontWeight: 600, fontSize: 25 * u, letterSpacing: "0.2em", color: "#6A6B6E" }}>{g.era.toUpperCase()}</div>
          <div style={{ display: "flex", gap: 7 * u, marginTop: 11 * u, justifyContent: "flex-end" }}>
            {Array.from({ length: steps }, (_, i) => <div key={i} style={{ width: 44 * u, height: 8 * u, background: i + 1 === (g.step ?? 1) ? red : i < (g.step ?? 1) ? "#17181B" : "#C9C9C5" }} />)}
          </div>
        </div>
      )}

      {/* spec panel */}
      <div style={{
        position: "absolute", left: width * 0.042, right: width * 0.042, top: height * 0.795, height: height * 0.158, background: "#17181B", display: "flex",
        clipPath: `polygon(0 0, ${panel * 100}% 0, ${panel * 100}% 100%, 0 100%)`,
      }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: 5 * u, width: `${panel * 38}%`, background: red }} />
        {g.specs.map((s, i) => {
          const p = interpolate(frame, [14 + i * 5, 40 + i * 5], [0, 1], { ...clamp, easing: ease.out });
          const n = typeof s.value === "number" ? (s.value * p).toFixed(s.decimals ?? 0) : s.value;
          const lit = Math.round((s.bar ?? 0) * p * 26);
          return (
            <div key={i} style={{ flex: 1, padding: `${22 * u}px ${36 * u}px`, borderLeft: i ? "1px solid #33353A" : "none" }}>
              <div style={{ fontFamily: label, fontWeight: 600, fontSize: 25 * u, letterSpacing: "0.2em", color: red }}>{s.label.toUpperCase()}</div>
              <div style={{ fontFamily: label, fontWeight: 700, fontSize: 56 * u, lineHeight: 1.18, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{s.prefix ?? ""}{n}{s.unit ? ` ${s.unit}` : ""}</div>
              {s.bar != null && (
                <div style={{ display: "flex", gap: 4 * u, marginTop: 6 * u }}>
                  {Array.from({ length: 26 }, (_, k) => <div key={k} style={{ flex: 1, height: 9 * u, background: k < lit ? red : "#33353A" }} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
