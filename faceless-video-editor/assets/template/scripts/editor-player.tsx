// The Studio's live preview: the real composition playing in the browser from the
// timeline, so the edit can be watched and checked before anything is rendered.
// editor.mjs bundles this with esbuild and serves it as /player.js.
import { Player, type PlayerRef } from "@remotion/player";
import { createRef, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { FacelessVideo } from "../src/FacelessVideo";
import type { Timeline } from "../src/types";

type Events = { onFrame: (frame: number) => void; onPlay: () => void; onPause: () => void; onEnded: () => void; onError: (message: string) => void };

const Video = FacelessVideo as unknown as ComponentType<Record<string, unknown>>;

function mount(element: HTMLElement, first: Timeline, events: Events) {
  const root = createRoot(element);
  const ref = createRef<PlayerRef>();
  let timeline = first, rate = 1, attached = false;
  const draw = () => root.render(
    <Player
      ref={ref}
      component={Video}
      inputProps={{ timeline }}
      durationInFrames={timeline.durationInFrames}
      fps={timeline.fps}
      compositionWidth={timeline.width}
      compositionHeight={timeline.height}
      style={{ width: "100%", height: "100%" }}
      playbackRate={rate}
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      moveToBeginningWhenEnded={false}
      numberOfSharedAudioTags={12}
      acknowledgeRemotionLicense
      errorFallback={({ error }) => { events.onError(error.message); return null; }}
    />,
  );
  draw();
  const attach = () => {
    const p = ref.current;
    if (!p) return requestAnimationFrame(attach);
    if (attached) return;
    attached = true;
    p.addEventListener("frameupdate", (e) => events.onFrame(e.detail.frame));
    p.addEventListener("seeked", (e) => events.onFrame(e.detail.frame));
    p.addEventListener("play", events.onPlay);
    p.addEventListener("pause", events.onPause);
    p.addEventListener("ended", events.onEnded);
    p.addEventListener("error", (e) => events.onError(e.detail.error.message));
  };
  attach();
  return {
    play: (gesture?: unknown) => ref.current?.play(gesture as Parameters<PlayerRef["play"]>[0]),
    pause: () => ref.current?.pause(),
    seek: (frame: number) => ref.current?.seekTo(frame),
    frame: () => ref.current?.getCurrentFrame() ?? 0,
    setRate: (value: number) => { rate = value; draw(); },
    setMuted: (muted: boolean) => { if (muted) ref.current?.mute(); else ref.current?.unmute(); },
    update: (next: Timeline) => { timeline = next; draw(); },
    destroy: () => root.unmount(),
  };
}

(window as unknown as { FacelessPlayer: { mount: typeof mount } }).FacelessPlayer = { mount };
