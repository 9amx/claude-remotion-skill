// Long form: chapter title card over the first seconds of each chapter.
// Landscape: left-aligned block with an accent rule; portrait: centered.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";
import { Reveal } from "./Reveal";

export const ChapterCard: React.FC<{ index: number; title: string; style: Style; duration: number }> = ({ index, title, style, duration }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const unit = portrait ? width : height;
  const rule = spring({ frame, fps, config: springs.smooth });
  const label = spring({ frame: frame - 4, fps, config: springs.snappy });
  const head = spring({ frame: frame - 9, fps, config: springs.smooth });
  const exit = interpolate(frame, [duration - 12, duration - 2], [1, 0], { ...clamp, easing: ease.in });
  const exitX = interpolate(frame, [duration - 12, duration - 2], [0, -60], { ...clamp, easing: ease.in });
  const drift = interpolate(frame, [0, duration], [0, portrait ? 0 : -14], clamp); // idle motion while held

  if (style.editorial) {
    const size = unit * (portrait ? 0.09 : 0.08);
    const ruleW = interpolate(frame, [0, 16], [0, 1], { ...clamp, easing: ease.out });
    return (
      <AbsoluteFill style={{ pointerEvents: "none", justifyContent: "center", alignItems: portrait ? "center" : "flex-start" }}>
        <AbsoluteFill style={{ background: `linear-gradient(${portrait ? "180deg" : "90deg"}, rgba(0,0,0,0.62), transparent 70%)`, opacity: exit }} />
        <div style={{ marginLeft: portrait ? 0 : width * 0.07, maxWidth: portrait ? width * 0.84 : width * 0.5, textAlign: portrait ? "center" : "left", opacity: exit, transform: `translateX(${drift * 0.5}px)` }}>
          <Reveal delay={2} frames={12}>
            <span style={{ fontFamily: style.fonts.label, fontWeight: 600, fontSize: unit * 0.024, letterSpacing: "0.32em", color: style.colors.primary }}>
              CHAPTER {String(index + 1).padStart(2, "0")}
            </span>
          </Reveal>
          <div style={{ height: 2, width: unit * 0.22 * ruleW, background: `${style.colors.text}88`, margin: portrait ? `${unit * 0.025}px auto` : `${unit * 0.025}px 0` }} />
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
    <AbsoluteFill style={{ pointerEvents: "none", justifyContent: "center", alignItems: portrait ? "center" : "flex-start" }}>
      {/* darken the footage so the card reads at a glance */}
      <AbsoluteFill style={{ background: `linear-gradient(${portrait ? "180deg" : "90deg"}, ${style.colors.scrim}, transparent 75%)`, opacity: exit * rule }} />
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
