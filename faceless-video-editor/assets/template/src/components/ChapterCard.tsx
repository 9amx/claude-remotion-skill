// Long form: chapter title card over the first seconds of each chapter.
// Landscape: left-aligned block with an accent rule; portrait: centered.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";
import { Reveal } from "./Reveal";

export const ChapterCard: React.FC<{ index: number; title: string; sub?: string; style: Style; duration: number; overGraphic?: boolean }> = ({ index, title, sub, style, duration, overGraphic = false }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const unit = portrait ? width : height;
  // Over a graphic the card sits below the graphic's zone, with no scrim to dim it.
  const anchor = overGraphic ? { justifyContent: "flex-end", paddingBottom: height * 0.2 } : { justifyContent: "center" };
  const rule = spring({ frame, fps, config: springs.smooth });
  const label = spring({ frame: frame - 4, fps, config: springs.snappy });
  const head = spring({ frame: frame - 9, fps, config: springs.smooth });
  const exit = interpolate(frame, [duration - 12, duration - 2], [1, 0], { ...clamp, easing: ease.in });
  const exitX = interpolate(frame, [duration - 12, duration - 2], [0, -60], { ...clamp, easing: ease.in });
  const drift = interpolate(frame, [0, duration], [0, portrait ? 0 : -14], clamp); // idle motion while held

  if (style.slashCards) {
    // Full-frame card: a huge outlined chapter number, a red "CHAPTER N" label, the
    // title in a heavy face, and a thin red line slashing across the frame.
    const n = String(index).padStart(2, "0");
    const o = interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: ease.out }) * exit;
    const slash = interpolate(frame, [2, 20], [0, 1], { ...clamp, easing: ease.out });
    const num = spring({ frame, fps, config: springs.smooth });
    const t = spring({ frame: frame - 6, fps, config: springs.smooth });
    const lab = spring({ frame: frame - 3, fps, config: springs.snappy });
    const push = interpolate(frame, [0, duration], [1, 1.04], clamp);
    return (
      <AbsoluteFill style={{ pointerEvents: "none", background: "#060506", opacity: o }}>
        <AbsoluteFill style={{ background: "radial-gradient(ellipse 60% 50% at 45% 50%, rgba(120,12,20,0.5), transparent 70%)" }} />
        <AbsoluteFill style={{ transform: `scale(${push})` }}>
          <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
            <line x1={0} y1={height * 0.66} x2={width * slash} y2={height * (0.66 - 0.2 * slash)} stroke={style.colors.primary} strokeWidth={unit * 0.004} />
          </svg>
          <div style={{
            position: "absolute", left: width * 0.3, top: height * 0.5, transform: `translate(-50%, -50%) translateX(${interpolate(num, [0, 1], [-40, 0])}px)`,
            fontFamily: style.fonts.emphasis, fontWeight: 700, fontSize: unit * 0.3, lineHeight: 1, color: "transparent",
            WebkitTextStroke: `${unit * 0.002}px ${style.colors.text}33`, opacity: num,
          }}>{n}</div>
          <div style={{ position: "absolute", left: width * 0.39, top: height * 0.5, transform: "translateY(-50%)" }}>
            <div style={{ fontFamily: style.fonts.label, fontWeight: 600, fontSize: unit * 0.022, letterSpacing: "0.3em", color: style.colors.primary, opacity: lab, transform: `translateY(${interpolate(lab, [0, 1], [10, 0])}px)` }}>
              CHAPTER {index}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={{
                fontFamily: "'Archivo Black', sans-serif", fontSize: unit * 0.075, lineHeight: 1.05, color: style.colors.text, maxWidth: width * 0.5,
                transform: `translateY(${interpolate(t, [0, 1], [unit * 0.09, 0])}px)`,
              }}>{title}</div>
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  if (style.cinema) {
    // Over the chapter's first footage: the picture dims, a tracked amber label, then
    // the title in a light serif, word by word out of a blur, widening slowly.
    const o = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease.out }) * exit;
    const lab = spring({ frame: frame - 2, fps, config: { damping: 22, stiffness: 120, mass: 0.8 } });
    const spread = interpolate(frame, [0, duration], [0, 0.03], clamp);
    const size = unit * 0.1;
    return (
      <AbsoluteFill style={{ pointerEvents: "none", alignItems: "center", justifyContent: "center" }}>
        <AbsoluteFill style={{ background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(3,8,10,0.55), rgba(3,8,10,0.8))", opacity: o }} />
        <div style={{ textAlign: "center", opacity: exit }}>
          <div style={{ fontFamily: style.fonts.label, fontWeight: 600, fontSize: unit * 0.02, letterSpacing: `${interpolate(lab, [0, 1], [0.8, 0.42])}em`, color: style.colors.primary, opacity: lab, marginBottom: unit * 0.03 }}>
            CHAPTER {String(index).padStart(2, "0")}
          </div>
          <div style={{ display: "flex", justifyContent: "center", columnGap: size * 0.26, letterSpacing: `${spread - 0.01}em` }}>
            {title.split(/\s+/).map((w, i) => {
              const q = spring({ frame: frame - 8 - i * 4, fps, config: { damping: 24, stiffness: 110, mass: 0.8 } });
              return (
                <span key={i} style={{
                  fontFamily: style.fonts.emphasis, fontWeight: 400, fontSize: size, lineHeight: 1.05, color: style.colors.text, display: "inline-block",
                  fontStyle: i === title.split(/\s+/).length - 1 ? "italic" : "normal",
                  opacity: Math.min(1, q * 1.5), transform: `translateY(${interpolate(q, [0, 1], [size * 0.35, 0])}px)`, filter: `blur(${interpolate(q, [0, 1], [12, 0])}px)`,
                  textShadow: `0 ${size * 0.04}px ${size * 0.4}px rgba(0,0,0,0.6)`,
                }}>{w}</span>
              );
            })}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  if (style.centerCards) {
    // A title over the footage: big condensed caps, a thin rule, a date line.
    const size = unit * 0.135;
    const o = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease.out }) * exit;
    const w = interpolate(frame, [6, 24], [0, 1], { ...clamp, easing: ease.out });
    const grow = interpolate(frame, [0, duration], [1, 1.035], clamp);
    return (
      <AbsoluteFill style={{ pointerEvents: "none", alignItems: "center", justifyContent: "center" }}>
        <AbsoluteFill style={{ background: "rgba(0,0,0,0.34)", opacity: o }} />
        <div style={{ opacity: o, transform: `scale(${grow})`, textAlign: "center", maxWidth: width * 0.86, letterSpacing: `${(1 - w) * 0.06 + 0.012}em` }}>
          <div style={{ fontFamily: style.fonts.emphasis, fontWeight: 700, fontSize: size, lineHeight: 1.02, color: style.colors.text, textTransform: "uppercase", textShadow: "0 4px 40px rgba(0,0,0,0.7)" }}>{title}</div>
          <div style={{ height: 2, width: unit * 0.3 * w, margin: `${unit * 0.02}px auto`, background: `linear-gradient(90deg, ${style.colors.primary} 35%, ${style.colors.text}88 35%)` }} />
          {sub && <div style={{ fontFamily: style.fonts.label, fontWeight: 500, fontSize: unit * 0.034, letterSpacing: "0.28em", color: `${style.colors.text}CC`, opacity: w }}>{sub}</div>}
        </div>
      </AbsoluteFill>
    );
  }

  if (style.editorial) {
    const size = unit * (portrait ? 0.09 : 0.08);
    const ruleW = interpolate(frame, [0, 16], [0, 1], { ...clamp, easing: ease.out });
    return (
      <AbsoluteFill style={{ pointerEvents: "none", ...anchor, alignItems: portrait ? "center" : "flex-start" }}>
        {!overGraphic && <AbsoluteFill style={{ background: `linear-gradient(${portrait ? "180deg" : "90deg"}, rgba(0,0,0,0.62), transparent 70%)`, opacity: exit }} />}
        <div style={{ marginLeft: portrait ? 0 : width * 0.07, maxWidth: portrait ? width * 0.84 : width * 0.64, textAlign: portrait ? "center" : "left", opacity: exit, transform: `translateX(${drift * 0.5}px)` }}>
          <Reveal delay={2} frames={12}>
            <span style={{ fontFamily: style.fonts.label, fontWeight: 600, fontSize: unit * 0.024, letterSpacing: "0.32em", color: style.colors.primary }}>
              CHAPTER {String(index + 1).padStart(2, "0")}
            </span>
          </Reveal>
          {style.rules ? <div style={{ height: 2, width: unit * 0.22 * ruleW, background: `${style.colors.text}88`, margin: portrait ? `${unit * 0.025}px auto` : `${unit * 0.025}px 0` }} /> : <div style={{ height: unit * 0.02 }} />}
          <div style={{ display: "flex", flexWrap: "wrap", columnGap: size * 0.24, justifyContent: portrait ? "center" : "flex-start" }}>
            {title.split(/\s+/).map((w, i) => (
              <Reveal key={i} delay={8 + i * 3} frames={18}>
                <span style={{ fontFamily: style.fonts.emphasis, fontWeight: 600, fontSize: size, lineHeight: 1.06, color: style.colors.text, textShadow: `0 ${size * 0.04}px ${size * 0.4}px rgba(0,0,0,0.6)` }}>{w}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ pointerEvents: "none", ...anchor, alignItems: portrait ? "center" : "flex-start" }}>
      {/* darken the footage so the card reads at a glance */}
      {!overGraphic && <AbsoluteFill style={{ background: `linear-gradient(${portrait ? "180deg" : "90deg"}, ${style.colors.scrim}, transparent 75%)`, opacity: exit * rule }} />}
      <div style={{
        marginLeft: portrait ? 0 : width * 0.07, marginTop: portrait ? -height * 0.08 : 0, maxWidth: portrait ? width * 0.84 : width * 0.55,
        textAlign: portrait ? "center" : "left", opacity: exit, transform: `translateX(${exitX + drift}px)`,
      }}>
        <div style={{
          height: unit * 0.008, width: unit * 0.16 * rule, background: style.colors.primary, borderRadius: 99,
          margin: portrait ? `0 auto ${unit * 0.03}px` : `0 0 ${unit * 0.03}px`,
        }} />
        <div style={{
          fontFamily: style.fonts.caption, fontWeight: 800, fontSize: unit * 0.032, letterSpacing: "0.22em", color: style.colors.primary,
          opacity: label, transform: `translateY(${interpolate(label, [0, 1], [16, 0])}px)`,
        }}>
          CHAPTER {index + 1}
        </div>
        <div style={{
          fontFamily: style.fonts.emphasis, fontSize: unit * (portrait ? 0.1 : 0.085), lineHeight: 1.05, color: style.colors.text, textTransform: "uppercase",
          marginTop: unit * 0.012, textShadow: `0 ${unit * 0.006}px ${unit * 0.03}px rgba(0,0,0,0.6)`,
          opacity: head, transform: `translateY(${interpolate(head, [0, 1], [30, 0])}px) scale(${interpolate(head, [0, 1], [0.96, 1])})`,
        }}>
          {title}
        </div>
      </div>
    </AbsoluteFill>
  );
};
