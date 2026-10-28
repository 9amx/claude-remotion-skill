// Bottom layer: a drifting gradient mesh. Never a flat solid background.
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Style } from "../theme";

export const Background: React.FC<{ style: Style }> = ({ style }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const s = Math.max(width, height);
  const d1 = Math.sin(frame / 55) * s * 0.04;
  const d2 = Math.cos(frame / 70) * s * 0.035;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${style.colors.bg}, ${style.colors.bgAlt})` }}>
      <div style={{ position: "absolute", width: s, height: s, borderRadius: "50%", top: -s * 0.35, left: -s * 0.25 + d1, filter: "blur(60px)",
        background: `radial-gradient(circle, ${style.colors.primary}30, transparent 62%)` }} />
      <div style={{ position: "absolute", width: s * 0.8, height: s * 0.8, borderRadius: "50%", bottom: -s * 0.3, right: -s * 0.2 - d2, filter: "blur(80px)",
        background: `radial-gradient(circle, ${style.colors.accent}26, transparent 65%)` }} />
    </AbsoluteFill>
  );
};
