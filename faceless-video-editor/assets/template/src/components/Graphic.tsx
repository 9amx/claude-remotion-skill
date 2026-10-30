// Motion-graphics shots: facts drawn from data, so they are exactly right.
// counter (a number), bars (a comparison), map (places, countries, a route),
// timeline (dates), quote (someone's words). A beat in project.json:
//   { "on": "3.5 million", "graphic": { "type": "counter", "value": 3500000, "label": "...", "source": "..." } }
// Content stays in the safe zone above the captions; every entrance is a
// spring with a stagger, idle elements breathe.
import { geoCircle, geoInterpolate, geoMercator, geoNaturalEarth1, geoPath, type GeoProjection } from "d3-geo";
import { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { clamp, ease, springs, type Style } from "../theme";
import type { GraphicSpec } from "../types";

// Safe zone: above the captions (portrait ~64%, landscape subtitles ~86%).
const useZone = () => {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return { portrait, x: width * 0.08, y: height * (portrait ? 0.12 : 0.1), w: width * 0.84, h: height * (portrait ? 0.44 : 0.62), unit: Math.min(width, height) };
};

const useEnter = (delay = 0, config = springs.smooth) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config });
};

const formatNumber = (v: number, decimals: number) =>
  v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

// ---------- shared frame: background, title, source ----------
const Frame: React.FC<{ style: Style; title?: string; source?: string; children: React.ReactNode }> = ({ style, title, source, children }) => {
  const frame = useCurrentFrame();
  const z = useZone();
  const t = useEnter(0);
  const s = useEnter(10);
  const grid = z.unit / 12;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 30%, ${style.colors.bgAlt}, ${style.colors.bg} 75%)` }}>
      <AbsoluteFill style={{
        opacity: 0.07,
        backgroundImage: `linear-gradient(${style.colors.text} 1px, transparent 1px), linear-gradient(90deg, ${style.colors.text} 1px, transparent 1px)`,
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${(frame * 0.4) % grid}px ${(frame * 0.6) % grid}px`,
      }} />
      {title ? (
        <div style={{
          position: "absolute", left: z.x, width: z.w, top: z.y, textAlign: "center",
          fontFamily: style.fonts.caption, fontWeight: style.captionWeight, fontSize: z.unit * 0.05, color: style.colors.text,
          textTransform: style.uppercase ? "uppercase" : "none", lineHeight: 1.1,
          opacity: t, transform: `translateY(${interpolate(t, [0, 1], [z.unit * 0.03, 0])}px) scale(${interpolate(t, [0, 1], [0.94, 1])})`,
        }}>{title}</div>
      ) : null}
      {children}
      {source ? (
        <div style={{
          position: "absolute", left: z.x, width: z.w, top: z.y + z.h + z.unit * 0.015, textAlign: "center",
          fontFamily: style.fonts.caption, fontWeight: 600, fontSize: z.unit * 0.022, color: style.colors.text, opacity: 0.6 * s,
        }}>Source: {source}</div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------- counter ----------
const Counter: React.FC<{ g: Extract<GraphicSpec, { type: "counter" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const enter = useEnter(0, springs.snappy);
  const count = spring({ frame: frame - 3, fps, config: { damping: 30, stiffness: 60 } });
  const decimals = g.decimals ?? (Number.isInteger(g.value) ? 0 : 1);
  const text = `${g.prefix ?? ""}${formatNumber(g.value * count, decimals)}${g.suffix ?? ""}`;
  const final = `${g.prefix ?? ""}${formatNumber(g.value, decimals)}${g.suffix ?? ""}`;
  const fontSize = Math.min(z.unit * 0.2, (z.w * 0.95) / (final.length * 0.52));
  const label = useEnter(12);
  const breathe = 1 + Math.sin(frame / 22) * 0.01;
  return (
    <Frame style={style} title={g.title} source={g.source}>
      <AbsoluteFill style={{ top: z.y, height: z.h, left: z.x, width: z.w, alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
        <div style={{
          fontFamily: style.fonts.emphasis, fontSize, lineHeight: 1, color: style.colors.primary, fontVariantNumeric: "tabular-nums",
          textShadow: `0 ${fontSize * 0.04}px 0 ${style.colors.outline}, 0 0 ${fontSize * 0.3}px rgba(0,0,0,0.5)`,
          opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [fontSize * 0.3, 0])}px) scale(${interpolate(enter, [0, 1], [0.8, 1]) * breathe})`,
        }}>{text}</div>
        {g.label ? (
          <div style={{
            marginTop: z.unit * 0.03, maxWidth: z.w, textAlign: "center", fontFamily: style.fonts.caption, fontWeight: style.captionWeight,
            fontSize: z.unit * 0.045, color: style.colors.text, textTransform: style.uppercase ? "uppercase" : "none",
            opacity: label, transform: `translateY(${interpolate(label, [0, 1], [z.unit * 0.02, 0])}px)`,
          }}>{g.label}</div>
        ) : null}
      </AbsoluteFill>
    </Frame>
  );
};

// ---------- bars ----------
const Bars: React.FC<{ g: Extract<GraphicSpec, { type: "bars" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const max = Math.max(...g.data.map(([, v]) => Math.abs(v)), 1e-9);
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const area = z.h - (top - z.y);
  const row = Math.min(area / g.data.length, z.unit * 0.17);
  const labelW = z.w * 0.3;
  // Labels shrink to fit their column instead of being cut ("Bangladesh" in a Short).
  const longest = Math.max(...g.data.map(([l]) => l.length));
  const labelSize = Math.min(row * 0.27, (labelW * 0.92) / (longest * 0.56));
  const decimals = g.data.some(([, v]) => !Number.isInteger(v)) ? 1 : 0;
  return (
    <Frame style={style} title={g.title} source={g.source}>
      {g.data.map(([label, value], i) => {
        const p = spring({ frame: frame - 6 - i * 4, fps, config: springs.smooth });
        const hero = g.highlight == null ? false : g.highlight === i;
        const barMax = z.w - labelW - z.unit * 0.04;
        const w = Math.max(2, (Math.abs(value) / max) * barMax * 0.78 * p);
        const color = g.highlight == null || hero ? style.colors.primary : style.colors.text;
        return (
          <div key={i} style={{
            position: "absolute", left: z.x, width: z.w, top: top + (area - row * g.data.length) / 2 + row * i, height: row,
            display: "flex", alignItems: "center", opacity: interpolate(p, [0, 0.3], [0, 1], clamp),
          }}>
            <div style={{
              width: labelW, paddingRight: z.unit * 0.02, textAlign: "right", fontFamily: style.fonts.caption, fontWeight: style.captionWeight,
              fontSize: labelSize, color: style.colors.text, lineHeight: 1.05, whiteSpace: "nowrap",
            }}>{label}</div>
            <div style={{
              height: row * 0.56, width: w, borderRadius: row * 0.1, background: color, opacity: g.highlight == null || hero ? 1 : 0.35,
              boxShadow: hero ? `0 0 ${row * 0.4}px ${style.colors.primary}88` : "none",
            }} />
            <div style={{
              marginLeft: z.unit * 0.015, fontFamily: style.fonts.emphasis, fontSize: row * 0.38, color: hero || g.highlight == null ? style.colors.primary : style.colors.text,
              fontVariantNumeric: "tabular-nums", opacity: interpolate(p, [0.4, 1], [0, 1], clamp),
            }}>{`${formatNumber(value * p, decimals)}${g.unit ?? ""}`}</div>
          </div>
        );
      })}
    </Frame>
  );
};

// ---------- timeline ----------
const TimelineG: React.FC<{ g: Extract<GraphicSpec, { type: "timeline" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const area = z.h - (top - z.y);
  const row = Math.min(area / g.events.length, z.unit * 0.14);
  const x = z.x + z.w * 0.3;
  const line = interpolate(frame, [0, Math.round(fps * 0.8)], [0, 1], { ...clamp, easing: ease.out });
  const y0 = top + (area - row * g.events.length) / 2;
  return (
    <Frame style={style} title={g.title} source={g.source}>
      <div style={{ position: "absolute", left: x - 2, width: 4, top: y0 + row * 0.5, height: row * (g.events.length - 1) * line, background: style.colors.text, opacity: 0.35 }} />
      {g.events.map(([date, what], i) => {
        const p = spring({ frame: frame - 4 - i * 5, fps, config: springs.snappy });
        const hero = g.highlight === i;
        const dot = row * (hero ? 0.26 : 0.18);
        const pulse = hero ? 1 + Math.sin(frame / 8) * 0.12 : 1;
        return (
          <div key={i} style={{ position: "absolute", left: z.x, width: z.w, top: y0 + row * i, height: row, opacity: p }}>
            <div style={{
              position: "absolute", right: z.w - (x - z.x) + row * 0.25, top: "50%", transform: `translateY(-50%) translateX(${interpolate(p, [0, 1], [-row * 0.3, 0])}px)`,
              fontFamily: style.fonts.emphasis, fontSize: row * 0.4, color: hero ? style.colors.primary : style.colors.text, whiteSpace: "nowrap",
            }}>{date}</div>
            <div style={{
              position: "absolute", left: x - z.x - dot / 2, top: (row - dot) / 2, width: dot, height: dot, borderRadius: "50%",
              background: hero ? style.colors.primary : style.colors.text, transform: `scale(${p * pulse})`,
              boxShadow: hero ? `0 0 ${row * 0.3}px ${style.colors.primary}` : "none",
            }} />
            <div style={{
              position: "absolute", left: x - z.x + row * 0.3, right: 0, top: "50%", transform: `translateY(-50%) translateX(${interpolate(p, [0, 1], [row * 0.3, 0])}px)`,
              fontFamily: style.fonts.caption, fontWeight: style.captionWeight, fontSize: row * 0.27, lineHeight: 1.1,
              color: style.colors.text, opacity: hero || g.highlight == null ? 1 : 0.75,
            }}>{what}</div>
          </div>
        );
      })}
    </Frame>
  );
};

// ---------- quote ----------
const Quote: React.FC<{ g: Extract<GraphicSpec, { type: "quote" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const words = g.text.split(/\s+/);
  const fontSize = Math.min(z.unit * 0.065, Math.sqrt((z.w * z.h * 0.55) / (g.text.length * 0.55)));
  const mark = useEnter(0, springs.snappy);
  const by = spring({ frame: frame - 6 - words.length * 2, fps, config: springs.smooth });
  return (
    <Frame style={style} source={g.source}>
      <AbsoluteFill style={{ top: z.y, height: z.h, left: z.x, width: z.w, justifyContent: "center", alignItems: "flex-start", flexDirection: "column" }}>
        <div style={{
          fontFamily: style.fonts.emphasis, fontSize: fontSize * 2.4, lineHeight: 0.6, color: style.colors.primary,
          opacity: mark, transform: `scale(${interpolate(mark, [0, 1], [0.6, 1])}) rotate(${interpolate(mark, [0, 1], [-10, 0])}deg)`,
        }}>“</div>
        <div style={{ display: "flex", flexWrap: "wrap", columnGap: fontSize * 0.28, marginTop: fontSize * 0.3 }}>
          {words.map((w, i) => {
            const p = spring({ frame: frame - 4 - i * 2, fps, config: springs.snappy });
            return (
              <span key={i} style={{
                fontFamily: style.fonts.caption, fontWeight: style.captionWeight, fontSize, lineHeight: 1.2, color: style.colors.text,
                opacity: p, transform: `translateY(${interpolate(p, [0, 1], [fontSize * 0.35, 0])}px)`, display: "inline-block",
              }}>{w}</span>
            );
          })}
        </div>
        {g.by ? (
          <div style={{
            marginTop: fontSize * 0.6, fontFamily: style.fonts.caption, fontWeight: 600, fontSize: fontSize * 0.6, color: style.colors.primary,
            opacity: by, transform: `translateX(${interpolate(by, [0, 1], [-fontSize, 0])}px)`,
          }}>— {g.by}</div>
        ) : null}
      </AbsoluteFill>
    </Frame>
  );
};

// ---------- map ----------
type Geo = { features: { properties: { name: string }; type: string; geometry: unknown }[] };
let geoCache: Geo | null = null;
const useCountries = () => {
  const [geo, setGeo] = useState<Geo | null>(geoCache);
  const [handle] = useState(() => (geoCache ? null : delayRender("loading map data")));
  useEffect(() => {
    if (geoCache || handle === null) return;
    fetch(staticFile("geo/countries-50m.json"))
      .then((r) => r.json())
      .then((topo: Topology) => {
        geoCache = feature(topo, topo.objects.countries) as unknown as Geo;
        setGeo(geoCache);
        continueRender(handle);
      })
      .catch((e) => cancelRender(e));
  }, [handle]);
  return geo;
};

const MapG: React.FC<{ g: Extract<GraphicSpec, { type: "map" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const z = useZone();
  const geo = useCountries();
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const box = { x: z.x, y: top, w: z.w, h: z.h - (top - z.y) };
  const highlight = new Set((g.countries ?? []).map((c) => c.toLowerCase()));

  const drawn = useMemo(() => {
    if (!geo) return null;
    const lit = geo.features.filter((f) => highlight.has(f.properties.name.toLowerCase()));
    // Frame what matters: the highlighted countries and a circle around each place,
    // big enough that pins and their labels never touch the edge.
    const lons = g.places.map((p) => p.lon), lats = g.places.map((p) => p.lat);
    const span = g.places.length > 1 ? Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats)) : 0;
    const pad = g.places.length > 1 ? Math.max(4, span * 0.18) : 9;
    const focus = [
      ...lit,
      ...g.places.map((p) => ({ type: "Feature", properties: {}, geometry: geoCircle().center([p.lon, p.lat]).radius(pad)() })),
    ];
    const wide = lons.length > 1 && Math.max(...lons) - Math.min(...lons) > 110;
    const projection: GeoProjection = (wide ? geoNaturalEarth1() : geoMercator())
      .fitExtent([[box.x, box.y], [box.x + box.w, box.y + box.h]], { type: "FeatureCollection", features: focus } as never);
    const path = geoPath(projection);
    return {
      countries: geo.features.map((f) => ({ d: path(f as never) ?? "", lit: highlight.has(f.properties.name.toLowerCase()) })),
      places: g.places.map((p) => ({ ...p, xy: projection([p.lon, p.lat]) ?? [0, 0] })),
      routes: g.route ? g.places.slice(1).map((p, i) => {
        const arc = geoInterpolate([g.places[i].lon, g.places[i].lat], [p.lon, p.lat]);
        return path({ type: "LineString", coordinates: Array.from({ length: 64 }, (_, k) => arc(k / 63)) } as never) ?? "";
      }) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, g, box.x, box.y, box.w, box.h]);

  if (!drawn) return <Frame style={style} title={g.title} source={g.source}>{null}</Frame>;
  // Camera: a slow push in on the focus area.
  const push = interpolate(spring({ frame, fps, config: { damping: 40, stiffness: 30 } }), [0, 1], [0.86, 1]) * (1 + frame * 0.0004);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const lit = spring({ frame: frame - 8, fps, config: springs.smooth }); // highlighted countries fill in
  return (
    <Frame style={style} title={g.title} source={g.source}>
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <clipPath id="map-zone"><rect x={box.x} y={box.y} width={box.w} height={box.h} rx={z.unit * 0.02} /></clipPath>
        </defs>
        <g clipPath="url(#map-zone)">
          <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={style.colors.bg} opacity={0.6} />
          <g transform={`translate(${cx} ${cy}) scale(${push}) translate(${-cx} ${-cy})`}>
            {drawn.countries.map((c, i) => (
              <path key={i} d={c.d} fill={c.lit ? style.colors.primary : style.colors.text} fillOpacity={c.lit ? 0.15 + 0.55 * lit : 0.1}
                stroke={style.colors.text} strokeOpacity={0.35} strokeWidth={z.unit * 0.0012} />
            ))}
            {drawn.routes.map((d, i) => {
              const p = interpolate(frame, [12 + i * 10, 12 + i * 10 + fps], [0, 1], { ...clamp, easing: ease.inOut });
              return <path key={`r${i}`} d={d} fill="none" stroke={style.colors.primary} strokeWidth={z.unit * 0.006} strokeLinecap="round"
                pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} />;
            })}
            {drawn.places.map((p, i) => {
              const s = spring({ frame: frame - 6 - i * 6, fps, config: springs.snappy });
              const ring = ((frame - i * 6) % 40) / 40;
              const r = z.unit * 0.014;
              return (
                <g key={`p${i}`} transform={`translate(${p.xy[0]} ${p.xy[1]})`} opacity={s}>
                  <circle r={r * (1 + ring * 2.2)} fill="none" stroke={style.colors.primary} strokeWidth={2} opacity={(1 - ring) * 0.8} />
                  <circle r={r * s} fill={style.colors.primary} stroke={style.colors.outline} strokeWidth={2} />
                  <text x={0} y={-r * 2} textAnchor={p.xy[0] < box.x + box.w * 0.18 ? "start" : p.xy[0] > box.x + box.w * 0.82 ? "end" : "middle"} fill={style.colors.text} fontFamily={style.fonts.caption} fontWeight={style.captionWeight}
                    fontSize={z.unit * 0.038} stroke={style.colors.outline} strokeWidth={z.unit * 0.008} paintOrder="stroke"
                    transform={`translate(0 ${interpolate(s, [0, 1], [r, 0])})`}>{p.label ?? p.name}</text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>
    </Frame>
  );
};

export const Graphic: React.FC<{ graphic: GraphicSpec; style: Style }> = ({ graphic, style }) => {
  switch (graphic.type) {
    case "counter": return <Counter g={graphic} style={style} />;
    case "bars": return <Bars g={graphic} style={style} />;
    case "timeline": return <TimelineG g={graphic} style={style} />;
    case "quote": return <Quote g={graphic} style={style} />;
    case "map": return <MapG g={graphic} style={style} />;
    default: return null;
  }
};
