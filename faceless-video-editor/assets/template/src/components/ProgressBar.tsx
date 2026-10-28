// Thin retention bar along the top edge (Shorts). Viewers stay when they see the end.
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Style } from "../theme";

export const ProgressBar: React.FC<{ style: Style }> = ({ style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 0, left: 0, height: width * 0.008, width: `${(frame / (durationInFrames - 1)) * 100}%`,
        background: style.colors.primary, boxShadow: `0 0 18px ${style.colors.primary}` }} />
    </AbsoluteFill>
  );
};
