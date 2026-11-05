// The whole edit, rendered from public/timeline.json.
// Layer stack (bottom -> top): background mesh -> PICTURE (B-roll through
// camera / look / transition) -> scrim -> emphasis / lower third / chapter card /
// badge -> captions -> grade -> grain -> vignette -> progress bar.
import { useMemo } from "react";
import { AbsoluteFill, Audio, Freeze, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Captions } from "./components/Captions";
import { Callout } from "./components/Callout";
import { ChapterCard } from "./components/ChapterCard";
import { Badge, Camera, Dip, LookFilter, OVERLAY_LEAD, Split, TransitionIn, TransitionOut, TransitionOverlay } from "./components/Edit";
import { Emphasis } from "./components/Emphasis";
import { Grade, Grain, Letterbox, Vignette } from "./components/Finish";
import { LowerThird } from "./components/LowerThird";
import { Overlay } from "./components/Overlay";
import { ProgressBar } from "./components/ProgressBar";
import { Shot, type Motion } from "./components/Shot";
import type { Props } from "./Root";
import { clamp, getStyle, type Style } from "./theme";
import type { Scene, Timeline } from "./types";

const HideDuring: React.FC<{ ranges: number[][]; children: React.ReactNode }> = ({ ranges, children }) => {
  const frame = useCurrentFrame();
  return ranges.some(([a, b]) => frame >= a && frame < b) ? null : <>{children}</>;
};

// Freeze frame: the picture stops on a white flash with a slight push-in.
const FreezeFlash: React.FC = () => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#fff", opacity: interpolate(frame, [0, 6], [0.7, 0], clamp) }} />;
};

const Picture: React.FC<{ scene: Scene; si: number; style: Style; motion: Motion }> = ({ scene, si, style, motion }) => {
  const frozen = scene.fx.includes("freeze");
  const shot = (k: number) => {
    const s = <Shot shot={scene.shots[k]} style={style} seed={si * 7 + k} motion={motion} />;
    return frozen ? <Freeze frame={0}>{s}</Freeze> : s;
  };
  return (
    <TransitionOut type={scene.exit} start={scene.durationInFrames}>
      <TransitionIn type={scene.transition}>
        <LookFilter look={frozen && scene.look === "normal" ? "dramatic" : scene.look}>
          <Camera punches={scene.punches} shake={scene.shake || frozen}>
            {scene.layout === "split" ? (
              <Split a={shot(0)} b={shot(1)} style={style} />
            ) : (
              scene.shots.map((sh, k) => (
                <Sequence key={k} from={sh.from} durationInFrames={sh.durationInFrames + (k === scene.shots.length - 1 ? scene.visualExtend : scene.shots[k + 1].fadeIn ?? 0)} name={`${scene.id}-${k + 1} ${sh.type}`}>
                  {shot(k)}
                </Sequence>
              ))
            )}
          </Camera>
        </LookFilter>
      </TransitionIn>
      {frozen && <FreezeFlash />}
    </TransitionOut>
  );
};

// Headroom for the whole mix (~-5 dB). The voice alone peaks near -2 dBFS, so voice + a
// transition sound clipped at 0 dBFS (audible crackle). Balance is unchanged; the master
// step (two-pass loudnorm to -14 LUFS) restores the loudness.
const MIX_GAIN = 0.55;

// One sound effect, started early by its alignment offset so it lands exactly on
// `at` (the cut, the word, the reveal) whatever library it came from: whooshes
// and risers peak there, impacts and UI sounds start there.
const Sfx: React.FC<{ timeline: Timeline; name: string; i?: number; at: number; volume: number; src?: string }> = ({ timeline, name, i = 0, at, volume, src: own }) => {
  const { fps } = useVideoConfig();
  const list = timeline.sfxFiles?.[name] ?? [`audio/${name}.wav`];
  const src = own ?? list[i % list.length];
  const lead = Math.round(((timeline.sfxPeaks?.[src] ?? 0) / 1000) * fps);
  return (
    <Sequence from={at - lead} durationInFrames={Math.round(fps * 4)} name={`sfx ${name}`}>
      <Audio src={staticFile(src)} volume={MIX_GAIN * volume * (timeline.sfxLevel ?? 1)} />
    </Sequence>
  );
};

// Each transition has its own sound, its loudest moment on the picture's fastest moment.
const TRANSITION_SLOT: Partial<Record<string, string>> = { whip: "trwhip", push: "trpush", wipe: "trwipe", zoom: "trzoom", flash: "trflash", light: "trlight", dip: "trdip", fade: "trfade", burn: "trburn", shutter: "trshutter", leak: "trleak", glitch: "glitch" };
const TRANSITION_PEAK: Partial<Record<string, number>> = { whip: 3, push: 6, wipe: 7, zoom: 4, fade: 6, burn: 7 };

// Ticks on highlighted caption words (dense edit styles only), at most ~1/sec.
const useHighlightTicks = (timeline: Timeline, fps: number) =>
  useMemo(() => {
    if (timeline.sfxLevel < 0.8) return [];
    const out: number[] = [];
    for (const w of timeline.words) {
      const f = Math.round((w.startMs / 1000) * fps);
      if (w.hl && (!out.length || f - out[out.length - 1] > fps)) out.push(f);
    }
    return out;
  }, [timeline, fps]);

// Music and ambience sit under the voice and come up in the gaps between lines
// (pauses over ~0.3s): gain 1 while someone speaks, musicGapBoost in the gaps.
// It ducks a few frames before each line, so the first word is never masked.
const useSpeechDuck = (timeline: Timeline | null, fps: number, total: number) =>
  useMemo(() => {
    const gain = new Float32Array(total).fill(1);
    const boost = timeline?.musicGapBoost ?? 1.7;
    if (!timeline || boost <= 1) return gain;
    const speaking = new Uint8Array(total);
    const words = timeline.words;
    for (let i = 0; i < words.length; ) {
      let end = words[i].endMs, j = i + 1;
      while (j < words.length && words[j].startMs - end < 300) end = Math.max(end, words[j++].endMs);
      speaking.fill(1, Math.max(0, Math.floor((words[i].startMs / 1000) * fps) - 4), Math.min(total, Math.ceil((end / 1000) * fps) + 5));
      i = j;
    }
    const up = (boost - 1) / 10, down = (boost - 1) / 4; // rise over ~10 frames, duck in 4
    let g = speaking[0] ? 1 : boost;
    for (let f = 0; f < total; f++) {
      const target = speaking[f] ? 1 : boost;
      g = target > g ? Math.min(target, g + up) : Math.max(target, g - down);
      gain[f] = g;
    }
    return gain;
  }, [timeline, fps, total]);

export const FacelessVideo: React.FC<Props> = ({ timeline }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const ticks = useHighlightTicks(timeline ?? ({ sfxLevel: 0, words: [] } as unknown as Timeline), fps);
  const duck = useSpeechDuck(timeline, fps, durationInFrames);
  const duckAt = (f: number) => duck[Math.min(duck.length - 1, Math.max(0, f))];
  if (!timeline) return <AbsoluteFill style={{ background: "#111", color: "#fff", fontSize: 48, padding: 80 }}>Run `npm run auto` first: public/timeline.json is missing.</AbsoluteFill>;
  const style = getStyle(timeline.style, timeline.textRules ?? false);
  const motion: Motion = timeline.editStyle === "viral" || timeline.editStyle === "explainer" ? "punchy" : "cinematic";
  // A title-card fallback already shows its line: no captions on top of it.
  const cardRanges = timeline.scenes.flatMap((sc) => sc.shots.filter((sh) => sh.type === "kinetic").map((sh) => [sc.startFrame + sh.from, sc.startFrame + sh.from + sh.durationInFrames]));
  const cleanRanges = timeline.scenes.flatMap((sc) => sc.shots.filter((sh) => sh.type === "graphic" && sh.graphic?.type === "weapon").map((sh) => [sc.startFrame + sh.from, sc.startFrame + sh.from + sh.durationInFrames]));
  const sfx = timeline.sfxLevel ?? (timeline.sfx ? 1 : 0);
  // Your own SFX (public/sfx/) when present, rotating through variants; else the synthesized kit.
  const riserSrc = (timeline.sfxFiles?.riser ?? ["audio/riser.wav"])[0];
  const lastWordEnd = Math.round(((timeline.words[timeline.words.length - 1]?.endMs ?? 0) / 1000) * fps);
  const XF = Math.round(fps * 1.5); // music crossfade between chapter moods
  const cardLen = Math.round(fps * 3.2);
  const CARD_TAIL = 14; // frames a gap card stays over the incoming picture (its fade-out happens over the new scene, not the old one)
  // Music drops out from the riser's start (its peak sits on the reveal).
  const riserLen = Math.max(8, Math.round((((timeline.sfxPeaks?.[riserSrc] ?? 1200)) / 1000) * fps));
  // Music drops out under a riser and comes back on the reveal's hit.
  // Chapter starts and reveals: the music lifts ~40% for a beat, then settles.
  const swell = (f: number) =>
    (timeline.swells ?? []).reduce((m, s) => m * interpolate(f, [s - 6, s + 4, s + fps * 1.6, s + fps * 2.8], [1, 1.4, 1.4, 1], clamp), 1);
  const revealDuck = (f: number) =>
    (timeline.reveals ?? []).reduce((m, r) => m * interpolate(f, [r - riserLen, r - riserLen + 8, r, r + 10], [1, 0.12, 0.12, 1], clamp), 1);

  return (
    <AbsoluteFill style={{ backgroundColor: style.colors.bg }}>
      <Background style={style} />

      {/* Pictures first, in order, so an incoming scene sits on top of the outgoing one during overlaps. */}
      {timeline.scenes.map((scene, si) => (
        <Sequence key={`p-${scene.id}`} from={scene.startFrame} durationInFrames={scene.durationInFrames + scene.visualExtend} name={`${scene.id} picture`}>
          <Picture scene={scene} si={si} style={style} motion={motion} />
        </Sequence>
      ))}

      {timeline.scenes.map((scene, si) => (
        <Sequence key={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames} name={scene.id}>
          {/* Scrim keeps text readable over any footage; a light studio card has none. */}
          <HideDuring ranges={scene.shots.filter((sh) => sh.type === "graphic" && sh.graphic?.type === "weapon").map((sh) => [sh.from, sh.from + sh.durationInFrames])}>
            <AbsoluteFill style={{ background: `linear-gradient(180deg, ${style.colors.scrim} 0%, transparent 34%, transparent 48%, ${style.colors.scrim} 100%)`, opacity: 0.85 }} />
          </HideDuring>
          {scene.emphasis && (
            <Sequence from={scene.emphasisFrom ?? 0} layout="none">
              <Emphasis text={scene.emphasis} style={style} hook={si === 0} duration={scene.durationInFrames - (scene.emphasisFrom ?? 0)} />
            </Sequence>
          )}
          {scene.shots.flatMap((sh) => sh.overlays ?? []).map((o, oi) => (
            <Sequence key={`ov${oi}`} from={o.from} durationInFrames={o.duration} layout="none">
              <Overlay o={o} style={style} duration={o.duration ?? 60} />
            </Sequence>
          ))}
          {scene.badge && <Badge text={scene.badge} style={style} />}
          {(scene.callouts ?? []).map((c, ci) => (
            <Sequence key={`c${ci}`} from={c.from} durationInFrames={c.duration} layout="none">
              <Callout text={c.text} style={style} duration={c.duration} index={si + ci} subtitle={timeline.calloutStyle === "subtitle"} />
            </Sequence>
          ))}
          {scene.lowerThird && (
            <Sequence from={Math.round(fps * 0.3)} durationInFrames={Math.min(Math.round(fps * 4.5), scene.durationInFrames - Math.round(fps * 0.3))}>
              <LowerThird {...scene.lowerThird} style={style} duration={Math.min(Math.round(fps * 4.5), scene.durationInFrames - Math.round(fps * 0.3))} />
            </Sequence>
          )}
          {timeline.showChapterCards && !timeline.chapterCardLead && scene.chapterStart && scene.chapter > 0 && (
            <Sequence durationInFrames={Math.min(cardLen, scene.durationInFrames)}>
              <ChapterCard index={scene.chapter} title={timeline.chapters[scene.chapter]?.title ?? ""} sub={timeline.chapters[scene.chapter]?.sub} style={style} duration={Math.min(cardLen, scene.durationInFrames)} overGraphic={scene.shots[0]?.type === "graphic"} />
            </Sequence>
          )}
          {scene.audio && <Audio src={staticFile(scene.audio)} volume={MIX_GAIN} />}
        </Sequence>
      ))}

      {/* Dips get a black overlay across the cut. */}
      {timeline.scenes.map((scene) =>
        scene.transition === "dip" ? (
          <Sequence key={`d-${scene.id}`} from={scene.startFrame - 8} durationInFrames={28}>
            <Dip half={8} />
          </Sequence>
        ) : null,
      )}

      {/* Chapter cards in their own silent beat before the chapter's first words,
          held a few frames past the cut so the card hands over to the new picture. */}
      {timeline.showChapterCards && !!timeline.chapterCardLead && timeline.scenes.map((scene) =>
        scene.chapterStart && scene.chapter > 0 ? (
          <Sequence key={`cc-${scene.id}`} from={scene.startFrame - timeline.chapterCardLead!} durationInFrames={timeline.chapterCardLead! + CARD_TAIL} name={`chapter card ${scene.chapter}`}>
            <ChapterCard index={scene.chapter} title={timeline.chapters[scene.chapter]?.title ?? ""} sub={timeline.chapters[scene.chapter]?.sub} style={style} duration={timeline.chapterCardLead! + CARD_TAIL} />
          </Sequence>
        ) : null,
      )}

      {/* Flash, film burn and shutter sit above both pictures. */}
      {timeline.scenes.map((scene, si) =>
        ["flash", "burn", "shutter", "leak"].includes(scene.transition) ? (
          <Sequence key={`o-${scene.id}`} from={Math.max(0, scene.startFrame - OVERLAY_LEAD)} durationInFrames={OVERLAY_LEAD + 26}>
            <TransitionOverlay type={scene.transition} seed={si} />
          </Sequence>
        ) : null,
      )}

      {/* SFX, each peak-aligned to its moment. */}
      {sfx > 0 && (
        <>
          {timeline.scenes.map((scene, si) => {
            const t = scene.transition;
            return (
              <Sequence key={`s-${scene.id}`} layout="none">
                {si > 0 && t !== "cut" && <Sfx timeline={timeline} name={TRANSITION_SLOT[t] ?? "whoosh"} i={si} at={scene.startFrame + (TRANSITION_PEAK[t] ?? 0) - (timeline.chapterCardLead && timeline.showChapterCards && scene.chapterStart ? timeline.chapterCardLead : 0)} volume={1} />}
                {scene.shots.filter((sh, k) => k > 0 && sh.fadeIn && (sh.graphic?.type === "weapon" || scene.shots[k - 1].graphic?.type === "weapon")).map((sh) => <Sfx key={sh.from} timeline={timeline} name="trfade" i={si} at={scene.startFrame + sh.from + Math.round((sh.fadeIn ?? 0) / 2)} volume={0.9} />)}
                {si > 0 && scene.emphasis && <Sfx timeline={timeline} name="pop" i={si} at={scene.startFrame + (scene.emphasisFrom ?? 0) + 3} volume={0.35} />}
                {scene.fx.includes("freeze") && <Sfx timeline={timeline} name="scratch" i={si} at={scene.startFrame} volume={0.5} />}
              </Sequence>
            );
          })}
          {/* Reveals: riser peaking into the cut, music dropped out under it, then the hit. */}
          {(timeline.reveals ?? []).map((r, ri) => (
            <Sequence key={`r-${r}`} layout="none">
              <Sfx timeline={timeline} name="riser" i={ri} at={r} volume={0.45} />
              <Sfx timeline={timeline} name="hit" i={ri + 1} at={r} volume={0.5} />
            </Sequence>
          ))}
          {/* Beat sounds: what the picture shows, heard as it appears. */}
          {(timeline.spots ?? []).map((sp, k) => <Sfx key={`sp-${k}`} timeline={timeline} name="spot" src={sp.src} at={sp.at} volume={sp.volume} />)}
        </>
      )}

      {/* Ambience beds: the place the footage shows, quietly under the voice. */}
      {(timeline.ambience ?? []).map((seg, k) => ({ ...seg, fade: Math.max(1, Math.min(12, Math.floor(seg.durationInFrames / 3))) })).map((a, k) => (
        <Sequence key={`a-${k}`} from={a.from} durationInFrames={a.durationInFrames} name={`ambience ${a.file}`}>
          <Audio
            src={staticFile(a.src)}
            loop
            volume={(f) =>
              MIX_GAIN *
              a.volume *
              interpolate(f, [0, a.fade, a.durationInFrames - a.fade, a.durationInFrames], [0, 1, 1, 0], clamp) *
              (1 + (duckAt(a.from + f) - 1) * 0.5)
            }
          />
        </Sequence>
      ))}

      {timeline.music.segments.map((seg, i) => {
        const from = Math.max(0, seg.from - (i > 0 ? XF : 0));
        const len = seg.from + seg.durationInFrames - from;
        return (
          <Sequence key={`m-${i}`} from={from} durationInFrames={len} name={`music ${seg.mood ?? ""}`}>
            <Audio
              src={staticFile(seg.src)}
              loop
              // Crossfade between segments, duck under the voice (up in the gaps), drop out before reveals, swell in the outro.
              volume={(f) =>
                MIX_GAIN *
                timeline.music.volume *
                interpolate(f, [0, i > 0 ? XF : 12], [0, 1], clamp) *
                (i < timeline.music.segments.length - 1 ? interpolate(f, [len - XF, len], [1, 0], clamp) : 1) *
                revealDuck(from + f) *
                swell(from + f) *
                duckAt(from + f) *
                // Outro swell on top of the gap lift (together ~2.2x).
                interpolate(from + f, [lastWordEnd, lastWordEnd + 10], [1, 1.3], clamp) *
                interpolate(from + f, [durationInFrames - 20, durationInFrames - 1], [1, 0], clamp)
              }
            />
          </Sequence>
        );
      })}

      <HideDuring ranges={cardRanges}><Captions timeline={timeline} style={style} /></HideDuring>
      <HideDuring ranges={cleanRanges}><Grade style={style} /></HideDuring>
      <Grain style={style} />
      <HideDuring ranges={cleanRanges}><Vignette /></HideDuring>
      {style.letterbox ? <Letterbox ratio={style.letterbox} /> : null}
      {timeline.progressBar && <ProgressBar style={style} />}
    </AbsoluteFill>
  );
};
