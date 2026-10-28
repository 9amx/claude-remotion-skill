// One B-roll shot: stock video, still (Ken Burns), or the kinetic fallback.
// Every cut opens with a zoom-punch so the edit feels cut on purpose.
import { AbsoluteFill, Img, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, ease, springs, type Style } from "../theme";
import type { Shot as ShotT } from "../types";

const Kinetic: React.FC<{ style: Style; seed: number }> = ({ style, seed }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const s = Math.min(width, height);
  const rot = frame * 0.4 + seed * 47;
  const ringIn = spring({ frame, fps, config: springs.smooth });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {/* drifting grid */}
      <AbsoluteFill style={{
        opacity: 0.12,
        backgroundImage: `linear-gradient(${style.colors.text} 1px, transparent 1px), linear-gradient(90deg, ${style.colors.text} 1px, transparent 1px)`,
        backgroundSize: `${s / 9}px ${s / 9}px`,
        backgroundPosition: `0px ${(frame * 1.5) % (s / 9)}px`,
        maskImage: "radial-gradient(ellipse at center, black 20%, transparent 70%)",
      }} />
      {[0, 1, 2].map((i) => (
        <div key={i} style={{
          position: "absolute",
          width: s * (0.5 + i * 0.22),
          height: s * (0.5 + i * 0.22),
          borderRadius: "50%",
          border: `${3 - i}px solid ${i === 0 ? style.colors.primary : style.colors.text}`,
          opacity: interpolate(ringIn, [0, 1], [0, 0.5 - i * 0.14]),
          transform: `scale(${interpolate(ringIn, [0, 1], [0.6 + i * 0.1, 1]) * (1 + Math.sin((frame + i * 20) / 26) * 0.02)}) rotate(${rot * (i % 2 ? -1 : 1)}deg)`,
          borderStyle: i === 1 ? "dashed" : "solid",
        }} />
      ))}
      {Array.from({ length: 14 }).map((_, i) => {
        const a = (i * 137.5 + seed * 31) % 360;
        const r = s * (0.25 + ((i * 53) % 40) / 100);
        const drift = frame * (0.15 + (i % 4) * 0.05);
        return (
          <div key={i} style={{
            position: "absolute",
            width: 6 + (i % 3) * 4,
            height: 6 + (i % 3) * 4,
            borderRadius: "50%",
            background: i % 5 === 0 ? style.colors.primary : style.colors.text,
            opacity: 0.25 + (i % 3) * 0.12,
            transform: `rotate(${a + drift}deg) translateX(${r}px)`,
          }} />
        );
      })}
    </AbsoluteFill>
  );
};

export const Shot: React.FC<{ shot: ShotT; style: Style; seed: number }> = ({ shot, style, seed }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const punch = interpolate(spring({ frame, fps, config: springs.punch }), [0, 1], [1.12, 1]);
  const kb = interpolate(frame, [0, shot.durationInFrames], shot.zoomIn ? [1, 1.08] : [1.08, 1], { ...clamp, easing: ease.inOut });
  const pan = interpolate(frame, [0, shot.durationInFrames], [0, seed % 2 ? -18 : 18], clamp);
  const media: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: `scale(${punch * kb}) translateX(${pan}px)` }}>
        {shot.type === "video" && shot.src ? (
          <OffthreadVideo
            src={staticFile(shot.src)}
            muted
            playbackRate={shot.playbackRate ?? 1}
            trimBefore={shot.trimBefore || undefined}
            style={{ ...media, filter: "saturate(1.08) contrast(1.06)" }}
          />
        ) : shot.type === "image" && shot.src ? (
          <Img src={staticFile(shot.src)} style={{ ...media, filter: "saturate(1.05) contrast(1.05)" }} />
        ) : (
          <Kinetic style={style} seed={seed} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
