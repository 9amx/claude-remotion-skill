// Big on-screen text for a scene's key idea ("emphasis" in project.json).
// Scene 0's emphasis is the hook: larger, lands on frame 0.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";

export const Emphasis: React.FC<{ text: string; style: Style; hook: boolean; duration: number }> = ({ text, style, hook, duration }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const words = text.split(/\s+/);
  const longest = Math.max(...words.map((w) => w.length));
  const base = (portrait ? width * 0.15 : width * 0.075) * (hook ? 1.12 : 1);
  const fontSize = Math.min(base, (width * 0.84) / (longest * 0.5));
  const exitY = interpolate(frame, [duration - 10, duration - 2], [0, -40], { ...clamp, easing: ease.in });
  const exitO = interpolate(frame, [duration - 10, duration - 2], [1, 0], clamp);
  const breathe = 1 + Math.sin(frame / 22) * 0.012;

  return (
    <AbsoluteFill style={{ pointerEvents: "none", alignItems: "center" }}>
      <div style={{
        position: "absolute", top: portrait ? height * 0.17 : height * 0.12, width: width * 0.86,
        display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: fontSize * 0.22,
        transform: `translateY(${exitY}px) scale(${breathe})`, opacity: exitO,
      }}>
        {words.map((w, i) => {
          const p = spring({ frame: frame - i * 4, fps, config: springs.snappy });
          return (
            <span key={i} style={{
              display: "inline-block",
              fontFamily: style.fonts.emphasis, fontSize, lineHeight: 1.02, textTransform: "uppercase",
              color: i === words.length - 1 && words.length > 1 ? style.colors.primary : style.colors.text,
              textShadow: `0 ${fontSize * 0.04}px 0 ${style.colors.outline}, 0 ${fontSize * 0.1}px ${fontSize * 0.3}px rgba(0,0,0,0.55)`,
              opacity: p,
              transform: `translateY(${interpolate(p, [0, 1], [fontSize * 0.5, 0])}px) scale(${interpolate(p, [0, 1], [hook ? 1.4 : 0.85, 1])})`,
            }}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
