// One B-roll shot: stock video, still (slow camera move), a motion graphic, or
// the title-card fallback when nothing matched.
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";
import type { Shot as ShotT } from "../types";
import { Graphic } from "./Graphic";

// No footage: the line itself, set as a title card on a slow light sweep. It is
// a fallback - the check report counts these, and the review should replace them.
const Kinetic: React.FC<{ style: Style; seed: number; words?: string }> = ({ style, seed, words }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const unit = Math.min(width, height);
  const text = (words ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, 9);
  const sweep = interpolate(frame, [0, fps * 6], [-30, 130]);
  const fontSize = Math.min(unit * 0.085, (width * 0.8) / Math.max(8, Math.sqrt(text.join(" ").length) * 3.2));
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at ${30 + (seed % 5) * 10}% 40%, ${style.colors.bgAlt}, ${style.colors.bg} 70%)`, alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill style={{ background: `linear-gradient(105deg, transparent ${sweep - 20}%, ${style.colors.primary}14 ${sweep}%, transparent ${sweep + 20}%)` }} />
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: fontSize * 0.28, width: width * 0.78, marginTop: -height * 0.06 }}>
        {text.map((w, i) => {
          const p = spring({ frame: frame - 3 - i * 3, fps, config: springs.smooth });
          return (
            <span key={i} style={{
              fontFamily: style.fonts.emphasis, fontSize, lineHeight: 1.15, color: i === text.length - 1 ? style.colors.primary : style.colors.text,
              opacity: p, transform: `translateY(${interpolate(p, [0, 1], [fontSize * 0.4, 0])}px)`, display: "inline-block",
            }}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Picture motion by edit style. "cinematic" (story, calm): real footage plays as
// shot, no zoom on top of it; stills get one slow, eased camera move (push in,
// pull out or a drift) so a photo reads as a shot, not a slide. "punchy" (viral,
// explainer): a small zoom-punch on each cut, a bit more movement on stills.
export type Motion = "cinematic" | "punchy";
const STILL_MOVES = [
  { from: [1.04, 0, 0], to: [1.16, 0, 0] }, // push in
  { from: [1.16, 0, 0], to: [1.04, 0, 0] }, // pull out
  { from: [1.12, 2.5, 0], to: [1.12, -2.5, 0] }, // drift left (% of width)
  { from: [1.12, -2.5, 0], to: [1.12, 2.5, 0] }, // drift right
  { from: [1.12, 0, 2], to: [1.08, 0, -2] }, // tilt up
];

export const Shot: React.FC<{ shot: ShotT; style: Style; seed: number; motion?: Motion }> = ({ shot, style, seed, motion = "punchy" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Graphics have their own motion; no Ken Burns or cut punch on top of a chart.
  if (shot.type === "graphic" && shot.graphic) return <Graphic graphic={shot.graphic} style={style} />;
  if (shot.type !== "video" && shot.type !== "image" || !shot.src) return <Kinetic style={style} seed={seed} words={shot.words} />;
  const t = interpolate(frame, [0, shot.durationInFrames], [0, 1], { ...clamp, easing: ease.inOut });
  const punch = motion === "punchy" ? interpolate(spring({ frame, fps, config: springs.punch }), [0, 1], [1.06, 1]) : 1;
  let scale = 1, x = 0, y = 0;
  if (shot.type === "image") {
    const m = STILL_MOVES[seed % STILL_MOVES.length];
    const k = motion === "punchy" ? 1.4 : 1;
    scale = 1 + (interpolate(t, [0, 1], [m.from[0], m.to[0]]) - 1) * k;
    x = interpolate(t, [0, 1], [m.from[1], m.to[1]]) * k;
    y = interpolate(t, [0, 1], [m.from[2], m.to[2]]) * k;
  } else if (motion === "punchy") {
    // Footage already moves: only a slight push so held clips don't feel parked.
    scale = interpolate(t, [0, 1], shot.zoomIn ? [1, 1.04] : [1.04, 1]);
  }
  const media: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${punch * scale}) translate(${x}%, ${y}%)` }}>
        {shot.type === "video" ? (
          <OffthreadVideo
            src={staticFile(shot.src)}
            muted
            playbackRate={shot.playbackRate ?? 1}
            trimBefore={shot.trimBefore || undefined}
            style={{ ...media, filter: "saturate(1.08) contrast(1.06)" }}
          />
        ) : (
          <Img src={staticFile(shot.src)} style={{ ...media, filter: "saturate(1.05) contrast(1.05)" }} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
