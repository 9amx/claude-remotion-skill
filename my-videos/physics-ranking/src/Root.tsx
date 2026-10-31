import { Composition, staticFile } from "remotion";
import { FacelessVideo } from "./FacelessVideo";
import type { Timeline } from "./types";

export type Props = { timeline: Timeline | null };

export const Root: React.FC = () => (
  <Composition
    id="Faceless"
    component={FacelessVideo}
    // Placeholders: real values come from public/timeline.json below.
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ timeline: null }}
    calculateMetadata={async ({ props }) => {
      const timeline: Timeline = props.timeline ?? (await (await fetch(staticFile("timeline.json"))).json());
      return {
        durationInFrames: timeline.durationInFrames,
        fps: timeline.fps,
        width: timeline.width,
        height: timeline.height,
        props: { timeline },
      };
    }}
  />
);
