// The whole edit, rendered from public/timeline.json.
// Layer stack (bottom -> top): background mesh -> B-roll shots -> scrim ->
// emphasis / lower third / chapter card -> captions -> grade -> grain ->
// vignette -> progress bar.
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Captions } from "./components/Captions";
import { ChapterCard } from "./components/ChapterCard";
import { Emphasis } from "./components/Emphasis";
import { Grade, Grain, Vignette } from "./components/Finish";
import { LowerThird } from "./components/LowerThird";
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
  const XF = Math.round(fps * 1.5); // music crossfade between chapter moods
  const cardLen = Math.round(fps * 3.2);
  const cuts = timeline.scenes.filter((s, i) => i > 0 && (timeline.transitions === "scene" || (timeline.transitions === "chapter" && s.chapterStart)));

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
          {scene.lowerThird && (
            <Sequence from={Math.round(fps * 0.3)} durationInFrames={Math.min(Math.round(fps * 4.5), scene.durationInFrames - Math.round(fps * 0.3))}>
              <LowerThird {...scene.lowerThird} style={style} duration={Math.min(Math.round(fps * 4.5), scene.durationInFrames - Math.round(fps * 0.3))} />
            </Sequence>
          )}
          {timeline.showChapterCards && scene.chapterStart && (
            <Sequence durationInFrames={Math.min(cardLen, scene.durationInFrames)}>
              <ChapterCard index={scene.chapter} title={timeline.chapters[scene.chapter]?.title ?? ""} style={style} duration={Math.min(cardLen, scene.durationInFrames)} />
            </Sequence>
          )}
          {scene.audio && <Audio src={staticFile(scene.audio)} />}
          {timeline.sfx && scene.emphasis && si > 0 && <Audio src={staticFile("audio/pop.wav")} volume={0.35} />}
        </Sequence>
      ))}

      {/* Transition flash + whoosh on scene changes (Shorts) or chapter changes (long form). */}
      {cuts.map((scene) => (
        <Sequence key={`t-${scene.id}`} from={scene.startFrame - 4} durationInFrames={12}>
          {timeline.sfx && <Audio src={staticFile("audio/whoosh.wav")} volume={0.3} />}
          <Sequence from={4}>
            <Flash />
          </Sequence>
        </Sequence>
      ))}
      {timeline.sfx && <Audio src={staticFile("audio/hit.wav")} volume={0.55} />}

      {timeline.music.segments.map((seg, i) => {
        const from = Math.max(0, seg.from - (i > 0 ? XF : 0));
        const len = seg.from + seg.durationInFrames - from;
        return (
          <Sequence key={`m-${i}`} from={from} durationInFrames={len} name={`music ${seg.mood ?? ""}`}>
            <Audio
              src={staticFile(seg.src)}
              loop
              // Crossfade between segments, duck under the voice, swell in the outro.
              volume={(f) =>
                timeline.music.volume *
                interpolate(f, [0, i > 0 ? XF : 12], [0, 1], clamp) *
                (i < timeline.music.segments.length - 1 ? interpolate(f, [len - XF, len], [1, 0], clamp) : 1) *
                interpolate(from + f, [lastWordEnd, lastWordEnd + 10], [1, 2.2], clamp) *
                interpolate(from + f, [durationInFrames - 20, durationInFrames - 1], [1, 0], clamp)
              }
            />
          </Sequence>
        );
      })}

      <Captions timeline={timeline} style={style} />
      <Grade style={style} />
      <Grain style={style} />
      <Vignette />
      {timeline.progressBar && <ProgressBar style={style} />}
    </AbsoluteFill>
  );
};
