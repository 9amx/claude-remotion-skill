// Editorial text entrance: the line rises out of an invisible mask (like a
// title sequence), no bounce, no scale. Used by the editorial styles.
import { interpolate, useCurrentFrame } from "remotion";
import { clamp, ease } from "../theme";

export const Reveal: React.FC<{ delay?: number; frames?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ delay = 0, frames = 16, children, style }) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [delay, delay + frames], [0, 1], { ...clamp, easing: ease.out });
  return (
    <span style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", paddingBottom: "0.08em", marginBottom: "-0.08em", ...style }}>
      <span style={{ display: "inline-block", transform: `translateY(${(1 - p) * 105}%)`, opacity: interpolate(p, [0, 0.3], [0, 1], clamp) }}>{children}</span>
    </span>
  );
};
