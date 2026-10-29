// YouTube thumbnail (1280x720 still), rendered by scripts/thumbnail.mjs.
// One frame from the video's best shot, darkened on the text side, plus 2-4
// huge words. Same five-layer stack as the video: picture -> scrim -> text ->
// grade -> grain + vignette.
import { forwardRef, useEffect, useRef, useState } from "react";
import { AbsoluteFill, Img, continueRender, delayRender, staticFile, useVideoConfig } from "remotion";
import { Background } from "./components/Background";
import { Grade, Grain, Vignette } from "./components/Finish";
import { getStyle, type Style } from "./theme";

export type ThumbnailProps = { text: string; image: string | null; style: string; side: "left" | "right" };

// Split into n lines of roughly equal length.
const split = (words: string[], n: number) => {
  const target = words.join(" ").length / n;
  const lines: string[] = [];
  let cur = "";
  for (const [i, w] of words.entries()) {
    // Break when this line is full, or when the remaining words are needed for the remaining lines.
    const full = (cur + " " + w).length > target * 1.15 || words.length - i <= n - 1 - lines.length;
    if (cur && full && lines.length < n - 1) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  return [...lines, cur];
};

// Manual "\n" wins; otherwise every 1-3 line split is a candidate.
const candidates = (text: string) => {
  if (text.includes("\n")) return [text.split("\n").map((l) => l.trim()).filter(Boolean)];
  const words = text.trim().split(/\s+/);
  return [1, 2, 3].filter((n) => n <= words.length).map((n) => split(words, n));
};

const MEASURE = 100; // px: candidates are measured at this size, then scaled

const TextBlock = forwardRef<HTMLDivElement, { lines: string[]; fontSize: number; style: Style; side: "left" | "right"; hidden?: boolean }>(
  ({ lines, fontSize, style, side, hidden }, ref) => (
    <div ref={ref} style={{
      display: "flex", flexDirection: "column", alignItems: side === "left" ? "flex-start" : "flex-end",
      ...(hidden ? { position: "absolute", visibility: "hidden" } : { transform: `rotate(${side === "left" ? -2 : 2}deg)` }),
    }}>
      {lines.map((l, i) => {
        const hero = i === lines.length - 1 && lines.length > 1;
        return (
          <div key={i} style={{
            fontFamily: style.fonts.emphasis, fontSize, lineHeight: 1.02, whiteSpace: "nowrap",
            color: hero ? style.colors.bg : style.colors.text,
            background: hero ? style.colors.primary : "transparent",
            padding: hero ? `0 ${fontSize * 0.12}px` : 0,
            marginTop: hero ? fontSize * 0.06 : 0,
            textShadow: hero ? "none" : `0 ${fontSize * 0.05}px 0 ${style.colors.outline}, 0 0 ${fontSize * 0.25}px rgba(0,0,0,0.7)`,
            WebkitTextStroke: hero ? undefined : `${Math.max(2, fontSize * 0.025)}px ${style.colors.outline}`,
            paintOrder: "stroke fill",
          }}>{l}</div>
        );
      })}
    </div>
  ),
);

export const Thumbnail: React.FC<ThumbnailProps> = ({ text, image, style: styleName, side }) => {
  const { width, height } = useVideoConfig();
  const style = getStyle(styleName);
  const options = candidates(text.toUpperCase());
  // Measure every split once the fonts are in, keep the one whose text can be
  // biggest inside 56% of the width and 78% of the height. Measuring (not
  // counting characters) keeps Bengali / Hindi as big as Latin text.
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [fit, setFit] = useState<{ lines: string[]; fontSize: number } | null>(null);
  const [handle] = useState(() => delayRender("fit thumbnail text"));
  useEffect(() => {
    document.fonts.ready.then(() => {
      let best = { lines: options[options.length - 1], fontSize: MEASURE };
      options.forEach((lines, i) => {
        const el = refs.current[i];
        if (!el) return;
        const fontSize = Math.min(height * 0.36, MEASURE * Math.min((width * 0.56) / el.scrollWidth, (height * 0.78) / el.scrollHeight));
        if (fontSize > best.fontSize || i === 0) best = { lines, fontSize };
      });
      setFit(best);
      continueRender(handle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, width, height, handle]);
  const dir = side === "left" ? "90deg" : "270deg";

  return (
    <AbsoluteFill>
      <Background style={style} />
      {image ? (
        <Img src={staticFile(image)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.06)",
          filter: "saturate(1.25) contrast(1.12) brightness(1.04)" }} />
      ) : null}
      <AbsoluteFill style={{ background: `linear-gradient(${dir}, ${style.colors.bg}EE 0%, ${style.colors.bg}B3 38%, transparent 68%)` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: side === "left" ? "flex-start" : "flex-end", padding: `0 ${width * 0.05}px` }}>
        {fit
          ? <TextBlock lines={fit.lines} fontSize={fit.fontSize} style={style} side={side} />
          : options.map((lines, i) => (
            <TextBlock key={i} ref={(el) => { refs.current[i] = el; }} lines={lines} fontSize={MEASURE} style={style} side={side} hidden />
          ))}
      </AbsoluteFill>
      <Grade style={style} />
      <Grain style={style} />
      <Vignette />
    </AbsoluteFill>
  );
};
