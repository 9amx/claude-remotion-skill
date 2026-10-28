// The whole edit, rendered from public/timeline.json.
// Layer stack (bottom -> top): background mesh -> B-roll shots -> scrim ->
// emphasis -> captions -> grade -> grain -> vignette -> progress bar.
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Captions } from "./components/Captions";
import { Emphasis } from "./components/Emphasis";
import { Grade, Grain, Vignette } from "./components/Finish";
import { ProgressBar } from "./components/ProgressBar";
import { Shot } from "./components/Shot";
import type { Props } from "./Root";
import { clamp, getStyle } from "./theme";

const Flash: React.FC = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#fff", mixBlendMode: "overlay", opacity: interpolate(frame, [0, 7], [0.55, 0], clamp) }} />;
};

export const FacelessVideo: React.FC<Props> = ({ timeline }) => {
  const { fps, durationInFrames } = useVideoConfig();
  if (!timeline) return <AbsoluteFill style={{ background: "#111", color: "#fff", fontSize: 48, padding: 80 }}>Run `npm run auto` first: public/timeline.json is missing.</AbsoluteFill>;
  const style = getStyle(timeline.style);
  const lastWordEnd = Math.round(((timeline.words[timeline.words.length - 1]?.endMs ?? 0) / 1000) * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: style.colors.bg }}>
      <Background style={style} />

      {timeline.scenes.map((scene, si) => (
        <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames} name={scene.id}>
          {scene.shots.map((shot, k) => (
            <Sequence key={k} from={shot.from} durationInFrames={shot.durationInFrames} name={`${scene.id}-${k + 1} ${shot.type}`}>
              <Shot shot={shot} style={style} seed={si * 7 + k} />
            </Sequence>
          ))}
          {/* Scrim keeps captions readable over any footage. */}
          <AbsoluteFill style={{ background: `linear-gradient(180deg, ${style.colors.scrim} 0%, transparent 34%, transparent 48%, ${style.colors.scrim} 100%)`, opacity: 0.85 }} />
          {scene.emphasis && <Emphasis text={scene.emphasis} style={style} hook={si === 0} duration={scene.durationInFrames} />}
          {scene.audio && <Audio src={staticFile(scene.audio)} />}
          {timeline.sfx && scene.emphasis && si > 0 && <Audio src={staticFile("audio/pop.wav")} volume={0.35} />}
        </Sequence>
      ))}

      {/* Transition flash + whoosh on every scene change (not on the first scene). */}
      {timeline.scenes.slice(1).map((scene) => (
        <Sequence key={`t-${scene.id}`} from={scene.startFrame - 4} durationInFrames={12}>
          {timeline.sfx && <Audio src={staticFile("audio/whoosh.wav")} volume={0.3} />}
          <Sequence from={4}>
            <Flash />
          </Sequence>
        </Sequence>
      ))}
      {timeline.sfx && <Audio src={staticFile("audio/hit.wav")} volume={0.55} />}

      {timeline.music.src && (
        <Audio
          src={staticFile(timeline.music.src)}
          loop
          // Duck under the voice, swell in the outro after the last word.
          volume={(f) =>
            timeline.music.volume *
            interpolate(f, [0, 12], [0, 1], clamp) *
            interpolate(f, [lastWordEnd, lastWordEnd + 10], [1, 2.2], clamp) *
            interpolate(f, [durationInFrames - 20, durationInFrames - 1], [1, 0], clamp)
          }
        />
      )}

      <Captions timeline={timeline} style={style} />
      <Grade style={style} />
      <Grain style={style} />
      <Vignette />
      {timeline.progressBar && <ProgressBar style={style} />}
    </AbsoluteFill>
  );
};
