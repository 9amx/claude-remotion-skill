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
      {/* Soft glows from radial gradients alone: a CSS blur() on these full-frame
          layers halved the render speed for no visible difference. */}
      <div style={{ position: "absolute", width: s, height: s, top: -s * 0.35, left: -s * 0.25 + d1,
        background: `radial-gradient(circle, ${style.colors.primary}30, ${style.colors.primary}12 35%, transparent 62%)` }} />
      <div style={{ position: "absolute", width: s * 0.8, height: s * 0.8, bottom: -s * 0.3, right: -s * 0.2 - d2,
        background: `radial-gradient(circle, ${style.colors.accent}26, ${style.colors.accent}0e 38%, transparent 65%)` }} />
    </AbsoluteFill>
  );
};
