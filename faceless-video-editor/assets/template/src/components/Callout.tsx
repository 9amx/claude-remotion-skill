// On-screen text for the words that carry the point: a key term, a number, a
// name, a short phrase - over the footage, on the word it repeats, like an
// editor's text pop (not a caption). A highlighter bar sweeps in behind it.
// scene.callouts = [{ text, from, duration }] (build-timeline: beat "text", or
// automatic from *highlighted* phrases when captions are off).
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";
import { Reveal } from "./Reveal";

export const Callout: React.FC<{ text: string; style: Style; duration: number; index: number }> = ({ text, style, duration, index }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const unit = Math.min(width, height);
  const number = /^[\d$€£৳₹.,%+\-\s]+[a-zA-Z%]*$/.test(text.trim()) || /^\d/.test(text.trim());
  const fontSize = unit * (number ? 0.085 : text.length > 22 ? 0.044 : 0.056);
  const words = text.split(/\s+/);
  const bar = interpolate(frame, [2, 12], [0, 1], { ...clamp, easing: ease.out });
  const exit = interpolate(frame, [duration - 8, duration], [1, 0], { ...clamp, easing: ease.in });
  // Alternate sides so repeated pops don't stamp the same corner.
  const left = portrait ? null : index % 2 === 0;
  if (style.editorial) {
    // A fine accent line draws down, the words rise out of a mask beside it.
    const size = unit * (number ? 0.075 : text.length > 22 ? 0.04 : 0.05);
    const line = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease.out });
    return (
      <AbsoluteFill style={{ pointerEvents: "none", opacity: exit }}>
        <div style={{
          position: "absolute", top: portrait ? height * 0.24 : height * 0.13, display: "flex", gap: size * 0.32, alignItems: "stretch",
          flexDirection: left === false ? "row-reverse" : "row", textAlign: left === false ? "right" : "left",
          ...(portrait ? { left: width * 0.08, right: width * 0.08 } : left ? { left: width * 0.055 } : { right: width * 0.055 }), maxWidth: portrait ? undefined : width * 0.42,
        }}>
          {style.rules && <div style={{ width: Math.max(2, size * 0.06), background: style.colors.primary, transform: `scaleY(${line})`, transformOrigin: "top", borderRadius: 2 }} />}
          <div style={{ display: "flex", flexWrap: "wrap", columnGap: size * 0.24, justifyContent: left === false ? "flex-end" : "flex-start" }}>
            {words.map((w, i) => (
              <Reveal key={i} delay={4 + i * 2} frames={14}>
                <span style={{
                  fontFamily: style.fonts.emphasis, fontWeight: 600, fontSize: size, lineHeight: 1.12, color: number ? style.colors.primary : style.colors.text,
                  textShadow: `0 ${size * 0.04}px ${size * 0.4}px rgba(0,0,0,0.75)`,
                }}>{w}</span>
              </Reveal>
            ))}
          </div>
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: exit }}>
      <div style={{
        position: "absolute", top: portrait ? height * 0.26 : height * 0.12,
        ...(portrait ? { left: width * 0.08, right: width * 0.08, textAlign: "center" as const } : left ? { left: width * 0.05 } : { right: width * 0.05 }),
        maxWidth: portrait ? undefined : width * 0.46,
      }}>
        <span style={{ position: "relative", display: "inline-block", padding: `${fontSize * 0.08}px ${fontSize * 0.22}px` }}>
          <span style={{
            position: "absolute", left: 0, right: 0, top: "12%", bottom: "8%", background: style.colors.primary, opacity: 0.92,
            transform: `scaleX(${bar})`, transformOrigin: left === false ? "right" : "left", borderRadius: fontSize * 0.08,
            boxShadow: `0 ${fontSize * 0.08}px ${fontSize * 0.3}px rgba(0,0,0,0.35)`,
          }} />
          {words.map((w, i) => {
            const p = spring({ frame: frame - 4 - i * 2, fps, config: springs.snappy });
            return (
              <span key={i} style={{
                position: "relative", display: "inline-block", marginRight: i < words.length - 1 ? fontSize * 0.24 : 0,
                fontFamily: number ? style.fonts.emphasis : style.fonts.caption, fontWeight: 800, fontSize, lineHeight: 1.15,
                color: style.colors.outline, opacity: p, transform: `translateY(${interpolate(p, [0, 1], [fontSize * 0.3, 0])}px)`,
                textTransform: style.uppercase ? "uppercase" : "none",
              }}>{w}</span>
            );
          })}
        </span>
      </div>
    </AbsoluteFill>
  );
};
