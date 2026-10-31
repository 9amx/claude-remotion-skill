// Long form: chapter title card over the first seconds of each chapter.
// Landscape: left-aligned block with an accent rule; portrait: centered.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";

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
