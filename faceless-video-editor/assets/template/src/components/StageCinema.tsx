// Cinema look for "stage" graphics: every beat sits on graded colour footage (or a
// photo), letterboxed; numbers and titles in a light serif, labels in tracked caps,
// keywords in amber italic, logos on frosted cards, a glass chart panel.
// Same item model as Stage.tsx (on / until / x / y / size), different design.
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease } from "../theme";
import type { StageEl, StageSpec } from "./Stage";
import { Flag } from "./Stage";

const SERIF = "Fraunces, serif";
const SANS = "'Inter Tight', Inter, sans-serif";
const AMB = "#F2A541";
const TEAL = "#5FB7C4";
const WHITE = "#F4F1EA";

const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

/** *word* -> amber serif italic. */
const Marked: React.FC<{ text: string; serif?: boolean }> = ({ text, serif = true }) => (
  <>
    {text.split(/(\*[^*]+\*)/g).map((part, i) =>
      part.startsWith("*") && part.endsWith("*") ? (
        <span key={i} style={{ color: AMB, fontStyle: "italic", fontFamily: serif ? SERIF : undefined }}>{part.slice(1, -1)}</span>
      ) : <span key={i}>{part}</span>,
    )}
  </>
);

const Glass: React.FC<{ h: number; w?: number; children: React.ReactNode }> = ({ h, w, children }) => (
  <div style={{
    height: h, width: w, padding: `${h * 0.2}px ${h * 0.34}px`, boxSizing: "border-box", background: "rgba(246,243,236,0.9)", borderRadius: h * 0.09,
    border: "1px solid rgba(255,255,255,0.7)", boxShadow: `0 ${h * 0.12}px ${h * 0.5}px rgba(0,0,0,0.45)`, display: "flex", alignItems: "center", justifyContent: "center",
  }}>{children}</div>
);

const Element: React.FC<{ e: StageEl; start: number; end: number | null }> = ({ e, start, end }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame - start;
  const p = spring({ frame: t, fps, config: { damping: 22, stiffness: 110, mass: 0.8 } });
  const out = end == null ? 0 : interpolate(frame, [end - 2, end + 9], [0, 1], { ...clamp, easing: ease.in });
  if (t < 0 || out >= 1) return null;
  const H = height / 100;
  const x = (e.x ?? 50) * (width / 100), y = (e.y ?? 50) * H;
  const anchor = e.align === "left" ? "0%" : e.align === "right" ? "-100%" : "-50%";
  const align = e.align === "left" ? "left" : e.align === "right" ? "right" : "center";
  // Shared entrance: rise out of a soft blur. Exit: drift up and fade.
  const blur = interpolate(p, [0, 1], [14, 0]);
  const enter = (rise: number) => ({
    position: "absolute" as const, left: x, top: y, textAlign: align as "left",
    transform: `translate(${anchor}, calc(-50% + ${interpolate(p, [0, 1], [rise, 0]) - out * 24}px))`,
    filter: blur > 0.2 || out > 0 ? `blur(${blur + out * 8}px)` : undefined,
    opacity: Math.min(1, p * 1.6) * (1 - out),
  });

  switch (e.el) {
    case "number": {
      const size = (e.size ?? 13) * H;
      const v = e.value ?? 0;
      const k = interpolate(t, [0, Math.round(fps * 1.3)], [0, 1], { ...clamp, easing: ease.out });
      const shown = e.value == null ? e.text ?? "" : `${e.prefix ?? ""}${fmt((e.from ?? 0) + (v - (e.from ?? 0)) * k, e.decimals ?? 0)}${e.suffix ?? ""}`;
      return (
        <div style={{
          ...enter(size * 0.18), fontFamily: SERIF, fontWeight: 400, fontSize: size, lineHeight: 1, whiteSpace: "nowrap",
          color: e.color === "red" ? AMB : WHITE, letterSpacing: `${interpolate(p, [0, 1], [0.06, -0.02])}em`, fontVariantNumeric: "lining-nums tabular-nums",
          textShadow: `0 ${size * 0.03}px ${size * 0.3}px rgba(0,0,0,0.55)`,
        }}>{shown}</div>
      );
    }
    case "tag": {
      const size = (e.size ?? 2.3) * H * 0.95;
      return (
        <div style={{ ...enter(size * 0.8), whiteSpace: "nowrap" }}>
          <div style={{ fontFamily: SANS, fontWeight: 600, fontSize: size, letterSpacing: `${interpolate(p, [0, 1], [0.5, 0.26])}em`, textTransform: "uppercase", color: AMB, textShadow: "0 2px 14px rgba(0,0,0,0.7)" }}>{e.text}</div>
          {e.sub ? <div style={{ marginTop: size * 0.5, fontFamily: SANS, fontWeight: 500, fontSize: size * 0.82, letterSpacing: "0.16em", color: `${WHITE}B0`, textTransform: "uppercase" }}>{e.sub}</div> : null}
        </div>
      );
    }
    case "line": {
      // Word by word, each one rising out of a blur.
      const size = (e.size ?? 3) * H * 1.15;
      const words = (e.text ?? "").match(/\*[^*]+\*|\S+/g) ?? [];
      return (
        <div style={{ position: "absolute", left: x, top: y, transform: `translate(${anchor}, calc(-50% - ${out * 24}px))`, opacity: 1 - out, whiteSpace: "nowrap", textAlign: align as "left" }}>
          {words.map((w, i) => {
            const q = spring({ frame: t - i * 2.2, fps, config: { damping: 20, stiffness: 130, mass: 0.7 } });
            const hl = w.startsWith("*");
            return (
              <span key={i} style={{
                display: "inline-block", marginRight: size * 0.26, fontFamily: hl ? SERIF : SANS, fontStyle: hl ? "italic" : "normal", fontWeight: hl ? 400 : 400,
                fontSize: hl ? size * 1.12 : size, color: hl ? AMB : WHITE, opacity: Math.min(1, q * 1.5),
                transform: `translateY(${interpolate(q, [0, 1], [size * 0.5, 0])}px)`, filter: `blur(${interpolate(q, [0, 1], [8, 0])}px)`,
                textShadow: "0 2px 18px rgba(0,0,0,0.75)",
              }}>{w.replace(/\*/g, "")}</span>
            );
          })}
        </div>
      );
    }
    case "title": {
      const size = (e.size ?? 8) * H * 0.95;
      const lines = (e.text ?? "").split("|");
      return (
        <div style={{ position: "absolute", left: x, top: y, transform: `translate(${anchor}, calc(-50% - ${out * 30}px))`, opacity: 1 - out, textAlign: align as "left" }}>
          {lines.map((l, i) => {
            const q = spring({ frame: t - i * 5, fps, config: { damping: 24, stiffness: 120, mass: 0.8 } });
            return (
              <div key={i} style={{ overflow: "hidden", lineHeight: 1.08, paddingBottom: size * 0.06 }}>
                <div style={{
                  fontFamily: SERIF, fontWeight: 400, fontSize: size, color: WHITE, letterSpacing: "-0.015em", whiteSpace: "nowrap",
                  transform: `translateY(${interpolate(q, [0, 1], [size * 1.1, 0])}px)`, textShadow: `0 ${size * 0.04}px ${size * 0.35}px rgba(0,0,0,0.5)`,
                }}><Marked text={l} /></div>
              </div>
            );
          })}
          {e.sub ? <div style={{ marginTop: size * 0.2, fontFamily: SANS, fontSize: size * 0.3, color: `${WHITE}CC`, opacity: interpolate(t, [10, 22], [0, 1], clamp) }}><Marked text={e.sub} /></div> : null}
        </div>
      );
    }
    case "logo": {
      const h = (e.size ?? 9) * H * 1.05;
      return (
        <div style={{ ...enter(h * 0.25), transform: `${enter(h * 0.25).transform} scale(${interpolate(p, [0, 1], [1.08, 1])})` }}>
          <Glass h={h}><Img src={staticFile(e.image!)} style={{ height: "100%", maxWidth: h * 4.2, objectFit: "contain" }} /></Glass>
        </div>
      );
    }
    case "logos": {
      const h = (e.size ?? 7) * H * 1.0;
      const imgs = e.images ?? [];
      const cols = imgs.length <= 4 ? imgs.length : Math.ceil(imgs.length / Math.ceil(imgs.length / 7));
      const cw = h * 2.5;
      return (
        <div style={{ position: "absolute", left: x, top: y, transform: `translate(${anchor}, -50%)`, opacity: 1 - out, display: "grid", gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gap: h * 0.28 }}>
          {imgs.map((img, i) => {
            const q = spring({ frame: t - i * 2, fps, config: { damping: 20, stiffness: 140, mass: 0.7 } });
            return (
              <div key={i} style={{ opacity: Math.min(1, q * 1.6), transform: `translateX(${interpolate(q, [0, 1], [-h * 0.6, 0])}px)`, filter: `blur(${interpolate(q, [0, 1], [8, 0])}px)` }}>
                <Glass h={h} w={cw}><Img src={staticFile(img)} style={{ height: "100%", maxWidth: cw - h * 0.68, objectFit: "contain" }} /></Glass>
              </div>
            );
          })}
        </div>
      );
    }
    case "flag":
    case "flags": {
      const h = (e.size ?? 4.5) * H * 0.95;
      const codes = e.el === "flag" ? [e.flag ?? "us"] : e.flags ?? [];
      return (
        <div style={{ position: "absolute", left: x, top: y, transform: `translate(${anchor}, -50%)`, opacity: 1 - out, display: "flex", gap: h * 0.3 }}>
          {codes.map((c, i) => {
            const q = spring({ frame: t - i * 4, fps, config: { damping: 20, stiffness: 140, mass: 0.7 } });
            return (
              <div key={i} style={{ borderRadius: h * 0.08, overflow: "hidden", display: "flex", boxShadow: `0 ${h * 0.1}px ${h * 0.4}px rgba(0,0,0,0.5)`, opacity: Math.min(1, q * 1.6), transform: `translateY(${interpolate(q, [0, 1], [h * 0.4, 0])}px)` }}>
                <Flag code={c} h={h} />
              </div>
            );
          })}
        </div>
      );
    }
    case "chart": {
      const w = (e.w ?? 52) * (width / 100), hh = (e.h ?? 50) * H;
      const pts = e.points ?? [1, 0];
      const max = Math.max(...pts), min = Math.min(...pts);
      const pad = hh * 0.15;
      const px = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
      const py = (v: number) => pad + 30 + (1 - (v - min) / Math.max(1e-9, max - min)) * (hh - pad * 2 - 40);
      const draw = interpolate(t, [6, 6 + fps * 1.8], [0, 1], { ...clamp, easing: ease.inOut });
      const path = pts.map((v, i) => `${i ? "L" : "M"}${px(i)},${py(v)}`).join(" ");
      const area = `${path} L${px(pts.length - 1)},${hh - pad} L${px(0)},${hh - pad} Z`;
      const head = Math.min(pts.length - 1, draw * (pts.length - 1));
      const hi = Math.floor(head), hf = head - hi;
      const hx = px(hi) + (hi < pts.length - 1 ? (px(hi + 1) - px(hi)) * hf : 0);
      const hy = py(pts[hi]) + (hi < pts.length - 1 ? (py(pts[hi + 1]) - py(pts[hi])) * hf : 0);
      return (
        <div style={{ ...enter(30), width: w, height: hh, background: "rgba(8,16,20,0.5)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: hh * 0.025 }}>
          <div style={{ position: "absolute", left: pad * 0.75, top: pad * 0.45, fontFamily: SANS, fontWeight: 600, fontSize: hh * 0.032, letterSpacing: "0.22em", color: `${WHITE}C0`, textTransform: "uppercase" }}>{e.title}</div>
          <svg width={w} height={hh} style={{ position: "absolute", inset: 0 }}>
            <defs>
              <linearGradient id="cinefill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={AMB} stopOpacity="0.35" /><stop offset="1" stopColor={AMB} stopOpacity="0" /></linearGradient>
              <clipPath id="cineclip"><rect x={0} y={0} width={hx + 1} height={hh} /></clipPath>
            </defs>
            {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad} x2={w - pad} y1={pad + 30 + g * (hh - pad * 2 - 40)} y2={pad + 30 + g * (hh - pad * 2 - 40)} stroke="#ffffff12" strokeWidth={1} />)}
            <line x1={pad} x2={w - pad} y1={hh - pad} y2={hh - pad} stroke="#ffffff38" strokeWidth={1.2} />
            <g clipPath="url(#cineclip)">
              <path d={area} fill="url(#cinefill)" />
              <path d={path} fill="none" stroke={AMB} strokeWidth={hh * 0.007} strokeLinejoin="round" strokeLinecap="round" />
            </g>
            {draw > 0 ? <circle cx={hx} cy={hy} r={hh * 0.012} fill={WHITE} stroke={AMB} strokeWidth={hh * 0.006} /> : null}
            {draw > 0 ? <circle cx={hx} cy={hy} r={hh * 0.035} fill={AMB} opacity={0.18} /> : null}
          </svg>
          {e.start ? <div style={{ position: "absolute", left: pad, bottom: pad * 0.32, fontFamily: SANS, fontSize: hh * 0.028, color: `${WHITE}80`, letterSpacing: "0.16em" }}>{e.start}</div> : null}
          {e.end ? <div style={{ position: "absolute", right: pad, bottom: pad * 0.32, fontFamily: SANS, fontSize: hh * 0.028, color: `${WHITE}80`, letterSpacing: "0.16em", opacity: draw }}>{e.end}</div> : null}
        </div>
      );
    }
    case "donut": {
      const r = (e.size ?? 12) * H;
      const k = interpolate(t, [3, 3 + fps * 1.2], [0, 1], { ...clamp, easing: ease.out });
      const C = 2 * Math.PI * r * 0.8;
      return (
        <div style={{ ...enter(20), width: r * 2, height: r * 2 }}>
          <svg width={r * 2} height={r * 2} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={r} cy={r} r={r * 0.8} fill="none" stroke="#ffffff1A" strokeWidth={r * 0.08} />
            <circle cx={r} cy={r} r={r * 0.8} fill="none" stroke={AMB} strokeWidth={r * 0.08} strokeDasharray={C} strokeDashoffset={C * (1 - ((e.value ?? 50) / 100) * k)} strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SERIF, fontSize: r * 0.5, color: WHITE }}>{e.text ?? `${Math.round((e.value ?? 0) * k)}%`}</div>
        </div>
      );
    }
  }
  return null;
};

export type CineBg = NonNullable<StageSpec["bg"]>;

export const StageCinema: React.FC<{ g: StageSpec; durationInFrames: number }> = ({ g, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const at = g.items.map((_, i) => g.at?.[i] ?? 4 + i * 10);
  const k = interpolate(frame, [0, durationInFrames], [0, 1], { ...clamp, easing: ease.inOut });
  const bg = (g.bg ?? {}) as CineBg;
  const media = bg.video || bg.image;
  const move = bg.move ?? "in";
  const amt = bg.image ? 0.1 : 0.06;
  const scale = move === "out" ? 1 + amt - amt * k : 1.03 + (move === "in" ? amt * k : 0.02);
  const tx = move === "left" ? (0.5 - k) * width * 0.04 : move === "right" ? (k - 0.5) * width * 0.04 : 0;
  const ty = move === "up" ? (0.5 - k) * 30 : 0;
  const dim = bg.dim ?? 0.3;
  const scrim = bg.scrim ?? "center";
  const scrimBg = {
    left: "linear-gradient(90deg, rgba(3,8,10,0.85) 0%, rgba(3,8,10,0.55) 38%, transparent 70%)",
    right: "linear-gradient(270deg, rgba(3,8,10,0.85) 0%, rgba(3,8,10,0.55) 38%, transparent 70%)",
    bottom: "linear-gradient(0deg, rgba(3,8,10,0.85) 0%, rgba(3,8,10,0.4) 35%, transparent 60%)",
    center: "radial-gradient(ellipse 60% 55% at 50% 50%, rgba(3,8,10,0.55), rgba(3,8,10,0.15) 70%, transparent)",
    none: "none",
  }[scrim];
  const push = 1 + (g.push ?? 0.025) * k;
  const filter = `saturate(0.92) contrast(1.1) brightness(${1 - dim * 0.75})`;
  return (
    <AbsoluteFill style={{ background: "#04090B", overflow: "hidden" }}>
      {media ? (
        <AbsoluteFill style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}>
          {bg.video ? (
            <OffthreadVideo src={staticFile(bg.video)} muted trimBefore={Math.round((bg.from ?? 0) * fps)} playbackRate={bg.speed ?? 1}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: bg.pos ?? "50% 50%", filter }} />
          ) : (
            <Img src={staticFile(bg.image!)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: bg.pos ?? "50% 28%", filter }} />
          )}
        </AbsoluteFill>
      ) : (
        <AbsoluteFill>
          <AbsoluteFill style={{ background: "radial-gradient(ellipse 70% 60% at 50% 45%, #10262C 0%, #071114 55%, #030607 100%)" }} />
          <AbsoluteFill style={{ background: `linear-gradient(105deg, transparent ${k * 140 - 40}%, rgba(242,165,65,0.10) ${k * 140 - 20}%, transparent ${k * 140}%)` }} />
        </AbsoluteFill>
      )}
      {/* teal shadows, warm highlights */}
      <AbsoluteFill style={{ background: "#0E4A56", mixBlendMode: "soft-light", opacity: 0.4 }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 70% 60% at 60% 35%, rgba(255,160,70,0.5), transparent 70%)", mixBlendMode: "soft-light", opacity: 0.45 }} />
      <AbsoluteFill style={{ background: scrimBg }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 45%, rgba(0,0,0,0.6) 100%)" }} />
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        {g.items.map((e, i) => {
          if (e.el === "person") return null;
          const until = e.until != null && e.until < at.length ? at[e.until] : null;
          return <Element key={i} e={e} start={at[i]} end={until} />;
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export { TEAL };
