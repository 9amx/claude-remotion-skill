// Word-synced captions, 1-4 words per page, active word highlighted.
// Styles: pop (outlined, active word colored + scaled), karaoke (unspoken
// words dimmed), boxed (active word on a colored pill), subtitle (long form:
// calm sentence-case line at the bottom, no per-word motion), none.
import { useMemo } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { clamp, springs, type Style } from "../theme";
import type { Timeline, Word } from "../types";

type Page = { words: Word[]; startMs: number; endMs: number; fadeOut: boolean };

const paginate = (words: Word[], maxWords: number, maxChars: number): Page[] => {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    const last = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
    if (last && (cur.length >= maxWords || w.startMs - last.endMs > 350 || /[.!?।]$/.test(last.text) ||
      chars + w.text.length > maxChars || w.scene !== last.scene)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  return groups.map((g, i) => {
    const next = groups[i + 1];
    const end = g[g.length - 1].endMs + 500;
    // Fade out only into silence; back-to-back pages just cut (a fade there reads as flicker).
    return { words: g, startMs: g[0].startMs, endMs: next ? Math.min(next[0].startMs, end) : end, fadeOut: !next || next[0].startMs > end };
  });
};

const outline = (c: string, px: number) =>
  [...Array(16)].map((_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return `${(Math.cos(a) * px).toFixed(1)}px ${(Math.sin(a) * px).toFixed(1)}px 0 ${c}`;
  }).join(", ") + `, 0 ${px * 2}px ${px * 4}px rgba(0,0,0,0.5)`;

export const Captions: React.FC<{ timeline: Timeline; style: Style }> = ({ timeline, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const portrait = height > width;
  const cfg = timeline.captions;
  const kind = cfg.style ?? "pop";
  const subtitle = kind === "subtitle";
  const maxChars = subtitle ? (portrait ? 32 : 44) : portrait ? 18 : 30;
  const pages = useMemo(() => paginate(timeline.words, cfg.maxWords ?? 3, maxChars), [timeline.words, cfg.maxWords, maxChars]);

  const ms = (frame / fps) * 1000;
  const page = pages.find((p) => ms >= p.startMs && ms < p.endMs);
  if (!page || kind === "none") return null;
  const toF = (t: number) => Math.round((t / 1000) * fps);

  if (subtitle) {
    const fontSize = portrait ? width * 0.052 : height * 0.044;
    const p = spring({ frame: frame - toF(page.startMs), fps, config: springs.snappy });
    const out = page.fadeOut ? interpolate(frame, [toF(page.endMs) - 4, toF(page.endMs)], [1, 0], clamp) : 1;
    return (
      // Landscape: keep clear of the Host standing in the right ~22% of the frame.
      <AbsoluteFill style={{ pointerEvents: "none", alignItems: "center", paddingRight: portrait ? 0 : width * 0.2 }}>
        <div style={{
          position: "absolute", top: (cfg.position ?? (portrait ? 0.7 : 0.86)) * height, maxWidth: portrait ? width * 0.8 : width * 0.62,
          transform: `translateY(-50%) translateY(${interpolate(p, [0, 1], [8, 0])}px)`, opacity: Math.min(p, out),
          padding: `${fontSize * 0.18}px ${fontSize * 0.45}px`, borderRadius: fontSize * 0.25, background: "rgba(0,0,0,0.55)",
          fontFamily: style.fonts.caption, fontWeight: 600, fontSize, lineHeight: 1.25, color: style.colors.text, textAlign: "center",
        }}>
          {page.words.map((w, i) => (
            <span key={i} style={{ color: w.hl ? style.colors.primary : undefined, fontWeight: w.hl ? 800 : undefined }}>
              {i ? " " : ""}{w.text}
            </span>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  const upper = cfg.uppercase ?? style.uppercase;
  const chars = page.words.reduce((n, w) => n + w.text.length + 1, 0);
  const base = portrait ? width * 0.088 : width * 0.046;
  const fontSize = Math.min(base, (width * 0.86) / (chars * 0.62));

  const enter = spring({ frame: frame - toF(page.startMs), fps, config: springs.snappy });
  const exit = page.fadeOut ? interpolate(frame, [toF(page.endMs) - 4, toF(page.endMs)], [1, 0], clamp) : 1;
  const activeIdx = page.words.reduce((a, w, i) => (w.startMs <= ms ? i : a), -1);
  const top = (cfg.position ?? (portrait ? 0.64 : 0.8)) * height;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{
        position: "absolute", left: width * 0.07, right: width * 0.07, top, transform: `translateY(-50%) translateY(${interpolate(enter, [0, 1], [24, 0])}px) scale(${interpolate(enter, [0, 1], [0.86, 1])})`,
        opacity: Math.min(enter, exit),
        display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center",
        columnGap: fontSize * 0.34, rowGap: fontSize * 0.05,
        fontFamily: style.fonts.caption, fontWeight: style.captionWeight, fontSize, lineHeight: 1.1,
        textTransform: upper ? "uppercase" : "none", letterSpacing: upper ? "0.01em" : "-0.01em",
      }}>
        {page.words.map((w, i) => {
          const active = i === activeIdx;
          const spoken = i <= activeIdx;
          const pop = spring({ frame: frame - toF(w.startMs), fps, config: springs.snappy });
          // Highlighted (*marked* or numeric) words stay in the accent color and a touch larger.
          const scale = active ? interpolate(pop, [0, 1], [0.94, w.hl ? 1.14 : 1.07]) : w.hl ? 1.05 : 1;
          const text = w.text.replace(/[.,;:।]+$/, "");
          const color =
            kind === "boxed" ? (active ? style.colors.outline : w.hl ? style.colors.accent : style.colors.text) :
            w.hl ? style.colors.accent : active ? style.colors.primary : style.colors.text;
          return (
            <span key={i} style={{
              display: "inline-block",
              position: "relative",
              color,
              opacity: kind === "karaoke" && !spoken ? 0.45 : 1,
              transform: `scale(${scale})`,
              // A scaled word grows into its neighbours' space: give it that space back.
              marginInline: Math.max(0, ((scale - 1) / 2) * text.length * fontSize * 0.62),
              textShadow: kind === "boxed" && active ? "none" : outline(style.colors.outline, fontSize * 0.055),
              padding: kind === "boxed" ? `0 ${fontSize * 0.14}px` : 0,
            }}>
              {kind === "boxed" && active && (
                <span style={{
                  position: "absolute", inset: `${-fontSize * 0.04}px 0`, borderRadius: fontSize * 0.16, background: style.colors.primary, zIndex: -1,
                  transform: `scaleX(${interpolate(pop, [0, 1], [0.6, 1])})`, boxShadow: `0 ${fontSize * 0.08}px ${fontSize * 0.3}px rgba(0,0,0,0.45)`,
                }} />
              )}
              {text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
