// "stage": one composed frame that builds up element by element, each landing on
// its own spoken words (the business-documentary look: black with a red glow, big
// condensed numbers, red label tags, white logo cards, flags, a black-and-white
// cut-out of a person, a line chart drawn live, a typed line with red keywords).
// A beat in project.json:
//   { "on": "70 billion", "graphic": { "type": "stage", "items": [
//       { "el": "chart", "on": "70 billion", "points": [100, 82, 61, 44, 30], ... },
//       { "el": "tag", "on": "wiped out", "text": "WIPED OUT IN TWO YEARS", "x": 76, "y": 30 } ] } }
// Positions are % of the frame (element center), sizes % of the frame height.
// An element with "until": k leaves when item k arrives.
import { loadFont as loadArchivoBlack } from "@remotion/google-fonts/ArchivoBlack";
import { loadFont as loadOswald } from "@remotion/google-fonts/Oswald";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, type Style } from "../theme";
import { StageCinema } from "./StageCinema";

const heavy = loadArchivoBlack("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
const cond = loadOswald("normal", { weights: ["500", "600", "700"], subsets: ["latin"] }).fontFamily;

export type StageEl = {
  el: "number" | "tag" | "line" | "title" | "logo" | "logos" | "flag" | "flags" | "person" | "chart" | "donut";
  on?: string;
  sfx?: string | { file: string; volume?: number };
  until?: number; // index of the item whose arrival removes this one
  x?: number; y?: number; size?: number; // center %, size % of height
  align?: "left" | "center" | "right";
  text?: string; // *word* = red
  sub?: string;
  color?: "red" | "white";
  value?: number; from?: number; decimals?: number; prefix?: string; suffix?: string; // number / donut count-up
  image?: string; images?: string[]; // logo(s), person
  flag?: string; flags?: string[]; // fr | it | us | ca | eu
  points?: number[]; title?: string; start?: string; end?: string; w?: number; h?: number; // chart box (% of frame)
  side?: "left" | "right";
};
export type StageSpec = {
  type: "stage";
  bg?: { video?: string; image?: string; from?: number; dim?: number; bw?: boolean; glow?: boolean; move?: "in" | "out" | "left" | "right" | "up"; pos?: string; scrim?: "left" | "right" | "bottom" | "center" | "none"; speed?: number };
  push?: number; // camera push over the shot (default 0.04)
  items: StageEl[];
  at?: number[];
};

const RED = "#E3262F";
const WHITE = "#F3F1EC";

const useSpring = (delay: number, damping = 16, stiffness = 140) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, stiffness, mass: 0.7 } });
};

/** Text with *red* words. */
const Marked: React.FC<{ text: string; red?: string }> = ({ text, red = RED }) => (
  <>
    {text.split(/(\*[^*]+\*)/g).map((part, i) =>
      part.startsWith("*") && part.endsWith("*") ? <span key={i} style={{ color: red }}>{part.slice(1, -1)}</span> : <span key={i}>{part}</span>,
    )}
  </>
);

const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- flags (drawn, so they are always crisp) ----------
export const Flag: React.FC<{ code: string; h: number }> = ({ code, h }) => {
  const w = h * 1.5;
  const tri = (a: string, b: string, c: string) => (
    <svg width={w} height={h} viewBox="0 0 3 2"><rect width="1" height="2" fill={a} /><rect x="1" width="1" height="2" fill={b} /><rect x="2" width="1" height="2" fill={c} /></svg>
  );
  if (code === "pl")
    return <svg width={w} height={h} viewBox="0 0 3 2"><rect width="3" height="1" fill="#FFFFFF" /><rect y="1" width="3" height="1" fill="#DC143C" /></svg>;
  if (code === "es")
    return <svg width={w} height={h} viewBox="0 0 3 2"><rect width="3" height="2" fill="#AA151B" /><rect y="0.5" width="3" height="1" fill="#F1BF00" /></svg>;
  if (code === "cn")
    return (
      <svg width={w} height={h} viewBox="0 0 30 20">
        <rect width="30" height="20" fill="#DE2910" />
        <path d="M5 2 L6.18 5.6 L9.95 5.6 L6.9 7.8 L8.05 11.4 L5 9.2 L1.95 11.4 L3.1 7.8 L0.05 5.6 L3.82 5.6 Z" fill="#FFDE00" />
        {[[10, 2], [12, 4], [12, 7], [10, 9]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r="0.8" fill="#FFDE00" />)}
      </svg>
    );
  if (code === "fr") return tri("#1F3D8F", "#FFFFFF", "#E2262E");
  if (code === "it") return tri("#159A4A", "#FFFFFF", "#D72B33");
  if (code === "ca")
    return (
      <svg width={w} height={h} viewBox="0 0 4 2">
        <rect width="4" height="2" fill="#fff" /><rect width="1" height="2" fill="#D52B1E" /><rect x="3" width="1" height="2" fill="#D52B1E" />
        <path d="M2 0.45 L2.12 0.8 L2.4 0.7 L2.3 1.05 L2.5 1.15 L2.08 1.3 L2.1 1.55 L1.9 1.55 L1.92 1.3 L1.5 1.15 L1.7 1.05 L1.6 0.7 L1.88 0.8 Z" fill="#D52B1E" />
      </svg>
    );
  if (code === "eu")
    return (
      <svg width={w} height={h} viewBox="0 0 3 2">
        <rect width="3" height="2" fill="#123E9B" />
        {Array.from({ length: 12 }, (_, i) => <circle key={i} cx={1.5 + 0.6 * Math.cos((i * Math.PI) / 6)} cy={1 + 0.6 * Math.sin((i * Math.PI) / 6)} r="0.07" fill="#FFCC00" />)}
      </svg>
    );
  // us
  return (
    <svg width={w} height={h} viewBox="0 0 19 10">
      {Array.from({ length: 13 }, (_, i) => <rect key={i} y={(i * 10) / 13} width="19" height={10 / 13} fill={i % 2 ? "#FFFFFF" : "#C8102E"} />)}
      <rect width="7.6" height={(10 * 7) / 13} fill="#1C2E64" />
      {Array.from({ length: 30 }, (_, i) => <circle key={i} cx={0.65 + (i % 6) * 1.25 + (Math.floor(i / 6) % 2) * 0.62} cy={0.55 + Math.floor(i / 6) * 1.05} r="0.22" fill="#fff" />)}
    </svg>
  );
};

const FlagCard: React.FC<{ code: string; h: number }> = ({ code, h }) => (
  <div style={{ padding: h * 0.12, background: "#ECEAE4", borderRadius: h * 0.16, boxShadow: `0 ${h * 0.08}px ${h * 0.3}px rgba(0,0,0,0.55)`, display: "flex" }}>
    <div style={{ borderRadius: h * 0.06, overflow: "hidden", display: "flex" }}><Flag code={code} h={h} /></div>
  </div>
);

const LogoCard: React.FC<{ image: string; h: number; w?: number }> = ({ image, h, w }) => (
  <div style={{
    height: h, width: w, padding: `${h * 0.18}px ${h * 0.32}px`, boxSizing: "border-box", background: "#ECEAE4", borderRadius: h * 0.12,
    boxShadow: `0 ${h * 0.08}px ${h * 0.35}px rgba(0,0,0,0.6)`, display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    <Img src={staticFile(image)} style={{ height: "100%", maxWidth: w ? w - h * 0.64 : h * 4.2, objectFit: "contain" }} />
  </div>
);

// ---------- one element ----------
const Element: React.FC<{ e: StageEl; start: number; end: number | null }> = ({ e, start, end }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame - start;
  const p = useSpring(start);
  const out = end == null ? 0 : interpolate(frame, [end - 2, end + 8], [0, 1], { ...clamp, easing: ease.in });
  if (t < 0 || out >= 1) return null;
  const H = height / 100;
  const x = (e.x ?? 50) * (width / 100), y = (e.y ?? 50) * H;
  const anchor = e.align === "left" ? "0%" : e.align === "right" ? "-100%" : "-50%";
  const base: React.CSSProperties = { position: "absolute", left: x, top: y, transform: `translate(${anchor}, -50%)`, opacity: 1 - out };
  const rise = (amt: number) => `translate(${anchor}, calc(-50% + ${interpolate(p, [0, 1], [amt, 0])}px))`;

  switch (e.el) {
    case "number": {
      const size = (e.size ?? 13) * H;
      const v = e.value ?? 0;
      const k = interpolate(t, [0, Math.round(fps * 1.1)], [0, 1], { ...clamp, easing: ease.out });
      const shown = e.value == null ? e.text ?? "" : `${e.prefix ?? ""}${fmt((e.from ?? 0) + (v - (e.from ?? 0)) * k, e.decimals ?? 0)}${e.suffix ?? ""}`;
      return (
        <div style={{
          ...base, transform: `${rise(size * 0.25)} scale(${interpolate(p, [0, 1], [0.92, 1])})`, fontFamily: cond, fontWeight: 700, fontSize: size,
          lineHeight: 1, color: e.color === "white" ? WHITE : RED, letterSpacing: "-0.01em", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
          textShadow: `0 ${size * 0.04}px ${size * 0.25}px rgba(0,0,0,0.6)`, opacity: Math.min(1, p * 1.4) * (1 - out),
        }}>{shown}</div>
      );
    }
    case "tag": {
      const size = (e.size ?? 2.3) * H;
      const wipe = interpolate(t, [0, 9], [0, 100], { ...clamp, easing: ease.out });
      return (
        <div style={{ ...base, clipPath: `inset(0 ${100 - wipe}% 0 0)` }}>
          <div style={{
            background: RED, color: "#fff", fontFamily: cond, fontWeight: 600, fontSize: size, letterSpacing: "0.06em", textTransform: "uppercase",
            padding: `${size * 0.16}px ${size * 0.45}px`, whiteSpace: "nowrap", lineHeight: 1.15,
          }}>{e.text}</div>
          {e.sub ? <div style={{ marginTop: size * 0.35, textAlign: "center", fontFamily: cond, fontWeight: 500, fontSize: size * 0.7, letterSpacing: "0.08em", color: `${WHITE}AA`, textTransform: "uppercase" }}>{e.sub}</div> : null}
        </div>
      );
    }
    case "line": {
      // Typed in, like an editor's on-screen note.
      const size = (e.size ?? 3) * H;
      const plain = (e.text ?? "").replace(/\*/g, "");
      const chars = Math.floor(interpolate(t, [0, Math.max(8, plain.length * 0.9)], [0, plain.length], clamp));
      let left = chars;
      const parts = (e.text ?? "").split(/(\*[^*]+\*)/g).map((part, i) => {
        const red = part.startsWith("*") && part.endsWith("*");
        const s = red ? part.slice(1, -1) : part;
        const show = s.slice(0, Math.max(0, left));
        left -= s.length;
        return <span key={i} style={{ color: red ? RED : WHITE, fontWeight: red ? 700 : 500 }}>{show}</span>;
      });
      return (
        <div style={{ ...base, fontFamily: "Inter, sans-serif", fontSize: size, whiteSpace: "nowrap", textShadow: "0 2px 18px rgba(0,0,0,0.8)" }}>
          {parts}
          <span style={{ opacity: chars < plain.length && Math.floor(t / 4) % 2 === 0 ? 1 : 0, color: RED }}>|</span>
        </div>
      );
    }
    case "title": {
      const size = (e.size ?? 8) * H;
      const lines = (e.text ?? "").split("|");
      return (
        <div style={{ ...base, textAlign: e.align === "left" ? "left" : e.align === "right" ? "right" : "center" }}>
          {lines.map((l, i) => {
            const q = spring({ frame: t - i * 4, fps, config: { damping: 18, stiffness: 150, mass: 0.7 } });
            return (
              <div key={i} style={{ overflow: "hidden", lineHeight: 1.02 }}>
                <div style={{
                  fontFamily: heavy, fontSize: size, color: WHITE, textTransform: "uppercase", letterSpacing: "-0.01em", whiteSpace: "nowrap",
                  transform: `translateY(${interpolate(q, [0, 1], [size * 1.05, 0])}px)`, textShadow: `0 ${size * 0.05}px ${size * 0.3}px rgba(0,0,0,0.5)`,
                }}><Marked text={l} /></div>
              </div>
            );
          })}
          {e.sub ? <div style={{ marginTop: size * 0.25, fontFamily: "Inter, sans-serif", fontWeight: 500, fontSize: size * 0.3, color: WHITE, opacity: interpolate(t, [8, 18], [0, 1], clamp) }}><Marked text={e.sub} /></div> : null}
        </div>
      );
    }
    case "logo": {
      const h = (e.size ?? 9) * H;
      return <div style={{ ...base, transform: `${rise(h * 0.3)} scale(${interpolate(p, [0, 1], [0.85, 1])})`, opacity: Math.min(1, p * 1.5) * (1 - out) }}><LogoCard image={e.image!} h={h} /></div>;
    }
    case "logos": {
      // A grid of logo cards popping in one after another.
      const h = (e.size ?? 7) * H;
      const imgs = e.images ?? [];
      // Equal cells in even rows, so a mix of wide wordmarks and square badges lines up.
      const cols = imgs.length <= 4 ? imgs.length : Math.ceil(imgs.length / Math.ceil(imgs.length / 7));
      const cw = h * 2.6;
      return (
        <div style={{ ...base, display: "grid", gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gap: h * 0.3, justifyItems: "center", alignItems: "center" }}>
          {imgs.map((img, i) => {
            const q = spring({ frame: t - i * 2, fps, config: { damping: 14, stiffness: 170, mass: 0.6 } });
            return <div key={i} style={{ opacity: Math.min(1, q * 1.5), transform: `translateY(${interpolate(q, [0, 1], [h * 0.4, 0])}px) scale(${interpolate(q, [0, 1], [0.7, 1])})` }}><LogoCard image={img} h={h} w={cw} /></div>;
          })}
        </div>
      );
    }
    case "flag": {
      const h = (e.size ?? 4.5) * H;
      return <div style={{ ...base, transform: `${rise(h * 0.4)} scale(${interpolate(p, [0, 1], [0.7, 1])})`, opacity: Math.min(1, p * 1.5) * (1 - out) }}><FlagCard code={e.flag ?? "us"} h={h} /></div>;
    }
    case "flags": {
      const h = (e.size ?? 4.5) * H;
      return (
        <div style={{ ...base, display: "flex", gap: h * 0.35 }}>
          {(e.flags ?? []).map((f, i) => {
            const q = spring({ frame: t - i * 5, fps, config: { damping: 14, stiffness: 170, mass: 0.6 } });
            return <div key={i} style={{ opacity: Math.min(1, q * 1.5), transform: `scale(${interpolate(q, [0, 1], [0.6, 1])})` }}><FlagCard code={f} h={h} /></div>;
          })}
        </div>
      );
    }
    case "person": {
      // Black-and-white cut-out standing in a red glow, drifting in slowly.
      const h = (e.size ?? 88) * H;
      const right = e.side !== "left";
      const drift = interpolate(t, [0, fps * 8], [0, 1], clamp);
      const cx = (e.x ?? (right ? 72 : 28)) * (width / 100);
      return (
        <div style={{ position: "absolute", left: cx, bottom: 0, transform: `translateX(-50%) translateX(${interpolate(p, [0, 1], [right ? 60 : -60, 0])}px) scale(${1 + drift * 0.03})`, transformOrigin: "50% 100%", opacity: Math.min(1, p * 1.3) * (1 - out) }}>
          <div style={{ position: "absolute", left: "50%", top: "30%", width: h * 1.1, height: h * 1.1, transform: "translate(-50%, -50%)", background: `radial-gradient(circle, ${RED}66 0%, ${RED}22 35%, transparent 65%)` }} />
          <Img src={staticFile(e.image!)} style={{ position: "relative", height: h, display: "block", filter: "contrast(1.12) brightness(0.95)" }} />
        </div>
      );
    }
    case "chart": {
      // A dark panel; the line draws itself left to right and the area under it fills.
      const w = (e.w ?? 52) * (width / 100), hh = (e.h ?? 50) * H;
      const pts = e.points ?? [1, 0];
      const max = Math.max(...pts), min = Math.min(...pts);
      const pad = hh * 0.16;
      const px = (i: number) => pad + (i / (pts.length - 1)) * (w - pad * 2);
      const py = (v: number) => pad + 20 + (1 - (v - min) / Math.max(1e-9, max - min)) * (hh - pad * 2 - 30);
      const draw = interpolate(t, [4, 4 + fps * 1.6], [0, 1], { ...clamp, easing: ease.inOut });
      const path = pts.map((v, i) => `${i ? "L" : "M"}${px(i)},${py(v)}`).join(" ");
      const area = `${path} L${px(pts.length - 1)},${hh - pad} L${px(0)},${hh - pad} Z`;
      return (
        <div style={{ ...base, width: w, height: hh, background: "linear-gradient(180deg, #141214F0, #0B0A0BF0)", border: "1px solid #ffffff14", borderRadius: hh * 0.03, boxShadow: "0 30px 80px rgba(0,0,0,0.6)", transform: `${rise(30)}`, opacity: Math.min(1, p * 1.4) * (1 - out) }}>
          <div style={{ position: "absolute", left: pad * 0.7, top: pad * 0.45, fontFamily: cond, fontWeight: 600, fontSize: hh * 0.035, letterSpacing: "0.14em", color: `${WHITE}CC`, textTransform: "uppercase" }}>{e.title}</div>
          <svg width={w} height={hh} style={{ position: "absolute", inset: 0 }}>
            <defs>
              <linearGradient id="chartfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={RED} stopOpacity="0.45" /><stop offset="1" stopColor={RED} stopOpacity="0" /></linearGradient>
              <clipPath id="chartclip"><rect x={0} y={0} width={px(0) + (px(pts.length - 1) - px(0)) * draw + 2} height={hh} /></clipPath>
            </defs>
            <line x1={pad} x2={w - pad} y1={hh - pad} y2={hh - pad} stroke="#ffffff30" strokeWidth={1.5} />
            <g clipPath="url(#chartclip)">
              <path d={area} fill="url(#chartfill)" />
              <path d={path} fill="none" stroke={RED} strokeWidth={hh * 0.009} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((v, i) => <circle key={i} cx={px(i)} cy={py(v)} r={hh * 0.011} fill="#141214" stroke={RED} strokeWidth={hh * 0.006} />)}
            </g>
          </svg>
          {e.start ? <div style={{ position: "absolute", left: pad, bottom: pad * 0.35, fontFamily: cond, fontSize: hh * 0.03, color: `${WHITE}88`, letterSpacing: "0.1em" }}>{e.start}</div> : null}
          {e.end ? <div style={{ position: "absolute", right: pad, bottom: pad * 0.35, fontFamily: cond, fontSize: hh * 0.03, color: `${WHITE}88`, letterSpacing: "0.1em", opacity: draw }}>{e.end}</div> : null}
        </div>
      );
    }
    case "donut": {
      const r = (e.size ?? 12) * H;
      const k = interpolate(t, [3, 3 + fps * 1.2], [0, 1], { ...clamp, easing: ease.out });
      const v = (e.value ?? 50) / 100;
      const C = 2 * Math.PI * r * 0.8;
      return (
        <div style={{ ...base, width: r * 2, height: r * 2, transform: `${rise(20)}`, opacity: Math.min(1, p * 1.4) * (1 - out) }}>
          <svg width={r * 2} height={r * 2} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={r} cy={r} r={r * 0.8} fill="none" stroke="#ffffff1A" strokeWidth={r * 0.2} />
            <circle cx={r} cy={r} r={r * 0.8} fill="none" stroke={RED} strokeWidth={r * 0.2} strokeDasharray={C} strokeDashoffset={C * (1 - v * k)} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: cond, fontWeight: 700, fontSize: r * 0.45, color: WHITE }}>
            {e.text ?? `${Math.round((e.value ?? 0) * k)}%`}
          </div>
        </div>
      );
    }
  }
  return null;
};

export const Stage: React.FC<{ g: StageSpec; style: Style; durationInFrames: number }> = (props) => (props.style.cinema ? <StageCinema g={props.g} durationInFrames={props.durationInFrames} /> : <StageClassic {...props} />);

const StageClassic: React.FC<{ g: StageSpec; style: Style; durationInFrames: number }> = ({ g, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = g.items.map((_, i) => g.at?.[i] ?? 4 + i * 10);
  const push = 1 + (g.push ?? 0.04) * interpolate(frame, [0, durationInFrames], [0, 1], clamp);
  const breathe = 0.85 + 0.15 * Math.sin(frame / (fps * 1.6));
  const bg = g.bg ?? {};
  const media = bg.video || bg.image;
  return (
    <AbsoluteFill style={{ background: "#060506", overflow: "hidden" }}>
      {media ? (
        <AbsoluteFill style={{ transform: `scale(${1.04 + 0.06 * interpolate(frame, [0, durationInFrames], [0, 1], clamp)})` }}>
          {bg.video ? (
            <OffthreadVideo src={staticFile(bg.video)} muted trimBefore={Math.round((bg.from ?? 0) * fps)} playbackRate={bg.speed ?? 1}
              style={{ width: "100%", height: "100%", objectFit: "cover", filter: bg.bw === false ? "none" : "grayscale(1) contrast(1.15) brightness(0.9)" }} />
          ) : (
            <Img src={staticFile(bg.image!)} style={{ width: "100%", height: "100%", objectFit: "cover", filter: bg.bw === false ? "none" : "grayscale(1) contrast(1.15)" }} />
          )}
          <AbsoluteFill style={{ background: `rgba(0,0,0,${bg.dim ?? 0.35})` }} />
          <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.75) 100%)" }} />
        </AbsoluteFill>
      ) : null}
      {!media || bg.glow ? (
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 55% 45% at 50% 50%, rgba(140,14,24,${0.55 * breathe}) 0%, rgba(70,6,12,${0.35 * breathe}) 40%, transparent 75%)` }} />
      ) : null}
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        {g.items.map((e, i) => {
          const until = e.until != null && e.until < at.length ? at[e.until] : null;
          return <Element key={i} e={e} start={at[i]} end={until} />;
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
