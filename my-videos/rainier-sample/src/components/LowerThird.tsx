// Name / place / date tag, bottom-left: scene.lowerThird = { title, subtitle }.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";

export const LowerThird: React.FC<{ title: string; subtitle?: string; style: Style; duration: number }> = ({ title, subtitle, style, duration }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const unit = portrait ? width : height;
  const bar = spring({ frame, fps, config: springs.smooth });
  const t1 = spring({ frame: frame - 5, fps, config: springs.snappy });
  const t2 = spring({ frame: frame - 9, fps, config: springs.snappy });
  const exit = interpolate(frame, [duration - 10, duration - 2], [1, 0], { ...clamp, easing: ease.in });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{
        position: "absolute", left: portrait ? width * 0.08 : width * 0.05, top: portrait ? height * 0.48 : height * 0.66,
        display: "flex", gap: unit * 0.018, opacity: exit, transform: `translateX(${interpolate(exit, [0, 1], [-30, 0])}px)`,
      }}>
        <div style={{ width: unit * 0.008, borderRadius: 99, background: style.colors.primary, transform: `scaleY(${bar})`, transformOrigin: "top" }} />
        <div style={{ padding: `${unit * 0.01}px ${unit * 0.02}px`, background: "rgba(0,0,0,0.45)", borderRadius: unit * 0.01 }}>
          <div style={{
            fontFamily: style.fonts.caption, fontWeight: 800, fontSize: unit * 0.042, color: style.colors.text,
            opacity: t1, transform: `translateY(${interpolate(t1, [0, 1], [14, 0])}px)`,
          }}>{title}</div>
          {subtitle && (
            <div style={{
              fontFamily: style.fonts.caption, fontWeight: 600, fontSize: unit * 0.026, color: style.colors.text, opacity: t2 * 0.8,
              transform: `translateY(${interpolate(t2, [0, 1], [10, 0])}px)`, marginTop: unit * 0.004,
            }}>{subtitle}</div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
