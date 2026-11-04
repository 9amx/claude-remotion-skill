// Motion-graphics shots: facts drawn from data, so they are exactly right.
// counter (a number), bars (a comparison), map (places, countries, a route),
// globe (a 3D earth that flies in to the place, with a route and a moving plane),
// radar (an ATC scope; a blip that drops off), profile (a value over time with a moving readout),
// aircraft (a technical airliner drawing in 3D: parts light up, it banks or pitches),
// timeline (dates), quote (someone's words); explainers for what footage can't
// show: list, steps (a process), compare (two sides), statement (the key line),
// ui (a screenshot in a browser / phone frame with a highlight). A beat in project.json:
//   { "on": "3.5 million", "graphic": { "type": "counter", "value": 3500000, "label": "...", "source": "..." } }
// Content stays in the safe zone above the captions; every entrance is a
// spring with a stagger, idle elements breathe.
import { geoCircle, geoDistance, geoGraticule10, geoInterpolate, geoMercator, geoNaturalEarth1, geoOrthographic, geoPath, type GeoProjection } from "d3-geo";
import { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, Img, cancelRender, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { clamp, ease, springs, type Style } from "../theme";
import type { GraphicSpec, Item } from "../types";
import { Aircraft3D } from "./Aircraft3D";
import { Earth3D } from "./Earth3D";

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
          fontFamily: style.editorial ? style.fonts.emphasis : style.fonts.caption, fontWeight: style.editorial ? 600 : style.captionWeight,
          fontSize: z.unit * (style.editorial ? 0.054 : 0.05), color: style.colors.text, letterSpacing: style.editorial ? "-0.01em" : undefined,
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


// ---------- globe ----------
// A 3D earth: it turns in from the side, pushes in on the place(s), draws the route
// and flies a plane along it; the last place (or "marker") pulses. Aviation and
// disaster stories open well on this.
const PLANE = "M0,-11 L1.7,-3.4 L10,1.6 L10,3.4 L1.7,1.3 L1.3,7 L3.9,9 L3.9,10.3 L0,9.3 L-3.9,10.3 L-3.9,9 L-1.3,7 L-1.7,1.3 L-10,3.4 L-10,1.6 L-1.7,-3.4 Z";
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const GlobeG: React.FC<{ g: Extract<GraphicSpec, { type: "globe" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const z = useZone();
  const geo = useCountries();
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const box = { x: z.x, y: top, w: z.w, h: z.h - (top - z.y) };
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const R0 = Math.min(box.w, box.h) * 0.44;
  const pts = g.places.map((p) => [p.lon, p.lat] as [number, number]);
  const first = pts[0], last = pts[pts.length - 1];
  const focus: [number, number] = pts.length > 1 ? (geoInterpolate(first, last)(0.5) as [number, number]) : first;
  const span = pts.length > 1 ? Math.max(...pts.slice(1).map((p, i) => geoDistance(pts[i], p))) : 0;
  // Zoom so the route fills about 60% of the frame (a single place: a regional view).
  const zoomTo = span > 0 ? Math.min(7, Math.max(1.1, (0.62 * Math.min(box.w, box.h)) / (span * R0))) : 3.4;

  const fly = spring({ frame, fps, config: { damping: 200, stiffness: 14, mass: 1.2 } });
  const push = interpolate(frame, [fps * 0.9, fps * 3.2], [0, 1], { ...clamp, easing: ease.inOut });
  const drift = 1 + Math.max(0, frame - fps * 3.2) * 0.0009;
  const k = lerp(1, zoomTo, push) * drift;
  const rotate: [number, number, number] = [lerp(-focus[0] + 80, -focus[0], fly), lerp(-focus[1] * 0.4 - 12, -focus[1], fly), 0];
  const projection = geoOrthographic().translate([cx, cy]).scale(R0 * k).rotate(rotate).clipAngle(90);
  const path = geoPath(projection);
  const center: [number, number] = [-rotate[0], -rotate[1]];
  const visible = (p: [number, number]) => geoDistance(p, center) < Math.PI / 2 - 0.02;

  const highlight = new Set((g.countries ?? []).map((c) => c.toLowerCase()));
  const lit = spring({ frame: frame - fps * 1.2, fps, config: springs.smooth });
  const routeP = g.route ? interpolate(frame, [fps * 1.6, fps * 3.6], [0, 1], { ...clamp, easing: ease.inOut }) : 0;
  const arcs = g.route ? pts.slice(1).map((p, i) => geoInterpolate(pts[i], p)) : [];
  const legs = arcs.length;
  const legOf = (t: number) => Math.min(legs - 1, Math.floor(t * legs));
  const plane = (() => {
    if (!legs || routeP <= 0 || routeP >= 1) return null;
    const li = legOf(routeP), lt = routeP * legs - li;
    const here = arcs[li](lt) as [number, number], ahead = arcs[li](Math.min(1, lt + 0.02)) as [number, number];
    if (!visible(here)) return null;
    const a = projection(here), b = projection(ahead);
    if (!a || !b) return null;
    return { x: a[0], y: a[1], deg: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 90 };
  })();
  const labels = interpolate(frame, [fps * 2.4, fps * 3], [0, 1], clamp);
  const marker = g.marker ?? g.places.length - 1;
  const R = R0 * k;
  return (
    <Frame style={style} title={g.title} source={g.source}>
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <clipPath id="globe-zone"><rect x={box.x} y={box.y} width={box.w} height={box.h} rx={z.unit * 0.02} /></clipPath>
          <radialGradient id="globe-ocean" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor={style.colors.bgAlt} />
            <stop offset="100%" stopColor={style.colors.bg} />
          </radialGradient>
          <radialGradient id="globe-air" cx="50%" cy="50%" r="50%">
            <stop offset="86%" stopColor={style.colors.primary} stopOpacity={0.35} />
            <stop offset="100%" stopColor={style.colors.primary} stopOpacity={0} />
          </radialGradient>
          <radialGradient id="globe-shine" cx="34%" cy="28%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity={0.16} />
            <stop offset="55%" stopColor="#ffffff" stopOpacity={0} />
            <stop offset="100%" stopColor="#000000" stopOpacity={0.45} />
          </radialGradient>
        </defs>
        <g clipPath="url(#globe-zone)">
          <circle cx={cx} cy={cy} r={R * 1.09} fill="url(#globe-air)" />
          <circle cx={cx} cy={cy} r={R} fill="url(#globe-ocean)" />
          <path d={path(geoGraticule10()) ?? ""} fill="none" stroke={style.colors.text} strokeOpacity={0.08} strokeWidth={1} />
          {geo ? geo.features.map((f, i) => {
            const on = highlight.has(f.properties.name.toLowerCase());
            return <path key={i} d={path(f as never) ?? ""} fill={on ? style.colors.primary : style.colors.text} fillOpacity={on ? 0.18 + 0.5 * lit : 0.16}
              stroke={style.colors.text} strokeOpacity={0.3} strokeWidth={z.unit * 0.001} />;
          }) : null}
          {arcs.map((arc, i) => {
            const d = path({ type: "LineString", coordinates: Array.from({ length: 96 }, (_, s) => arc(s / 95)) } as never) ?? "";
            const p = Math.max(0, Math.min(1, routeP * legs - i));
            return <path key={`r${i}`} d={d} fill="none" stroke={style.colors.primary} strokeWidth={z.unit * 0.006} strokeLinecap="round"
              pathLength={1} strokeDasharray="1" strokeDashoffset={1 - p} />;
          })}
          <circle cx={cx} cy={cy} r={R} fill="url(#globe-shine)" />
          {g.places.map((p, i) => {
            if (!visible([p.lon, p.lat])) return null;
            const xy = projection([p.lon, p.lat]);
            if (!xy) return null;
            const s = spring({ frame: frame - fps * 1.4 - i * 5, fps, config: springs.snappy });
            const r = z.unit * 0.013;
            const ring = ((frame - i * 7) % 36) / 36;
            const hot = i === marker;
            return (
              <g key={`p${i}`} transform={`translate(${xy[0]} ${xy[1]})`} opacity={s}>
                {hot ? <circle r={r * (1 + ring * 3)} fill="none" stroke={style.colors.primary} strokeWidth={3} opacity={(1 - ring) * 0.9} /> : null}
                <circle r={r * (hot ? 1.2 : 0.85) * s} fill={hot ? style.colors.primary : style.colors.text} stroke={style.colors.outline} strokeWidth={2} />
                <text x={0} y={-r * 2.2} textAnchor="middle" fill={style.colors.text} fontFamily={style.fonts.caption} fontWeight={style.captionWeight}
                  fontSize={z.unit * 0.036} stroke={style.colors.outline} strokeWidth={z.unit * 0.008} paintOrder="stroke" opacity={labels}>{p.label ?? p.name}</text>
              </g>
            );
          })}
          {plane ? (
            <g transform={`translate(${plane.x} ${plane.y}) rotate(${plane.deg}) scale(${z.unit * 0.0032})`}>
              <path d={PLANE} fill={style.colors.text} stroke={style.colors.outline} strokeWidth={1.2} />
            </g>
          ) : null}
        </g>
      </svg>
    </Frame>
  );
};


// ---------- radar ----------
// An ATC radar scope: rings, a turning sweep, the aircraft's blip with its data tag and
// track. With "vanish" the blip blinks and drops off the scope (vanishAt: share of the
// shot, default 0.62) and a "last contact" mark stays. altitude -> altitudeTo descends.
const RadarG: React.FC<{ g: Extract<GraphicSpec, { type: "radar" }>; style: Style; dur: number }> = ({ g, style, dur }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const z = useZone();
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const box = { x: z.x, y: top, w: z.w, h: z.h - (top - z.y) };
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const R = Math.min(box.w, box.h) * 0.47;
  const open = spring({ frame, fps, config: springs.smooth });
  const sweep = ((frame / (fps * 2.2)) * 360) % 360; // degrees, clockwise from north
  const vanishF = g.vanish ? Math.round(dur * (g.vanishAt ?? 0.62)) : Infinity;
  const head = ((g.heading ?? 55) * Math.PI) / 180;
  // The aircraft crawls across the scope along its heading, ending near the centre-right.
  const travel = interpolate(frame, [0, Math.min(dur, vanishF)], [0, 1], clamp);
  const start = { x: cx - Math.sin(head) * R * 0.55, y: cy + Math.cos(head) * R * 0.55 };
  const pos = (t: number) => ({ x: start.x + Math.sin(head) * R * 0.5 * t, y: start.y - Math.cos(head) * R * 0.5 * t });
  const now = pos(travel);
  const lost = frame >= vanishF;
  const blink = lost && frame < vanishF + 24 ? Math.floor((frame - vanishF) / 5) % 2 === 0 : !lost;
  const alt = g.altitude != null ? Math.round(interpolate(frame, [0, Math.min(dur, vanishF)], [g.altitude, g.altitudeTo ?? g.altitude], clamp) / 100) * 100 : null;
  const angleOf = (p: { x: number; y: number }) => ((Math.atan2(p.x - cx, -(p.y - cy)) * 180) / Math.PI + 360) % 360;
  const since = (sweep - angleOf(now) + 360) % 360; // degrees since the sweep passed the blip
  const glow = interpolate(since, [0, 120], [1, 0.45], clamp);
  const ring = (i: number) => R * (i / 4);
  const tagFont = z.unit * 0.04;
  const lostColor = "#ff5a52";
  const label = g.label ?? "LAST CONTACT";
  return (
    <Frame style={style} title={g.title} source={g.source}>
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible",
        transform: `perspective(${z.unit * 2.4}px) rotateX(${interpolate(open, [0, 1], [38, 18])}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
        <defs>
          <filter id="radar-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={z.unit * 0.006} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <pattern id="radar-scan" width="4" height="6" patternUnits="userSpaceOnUse"><rect width="4" height="1.5" fill="#000" opacity="0.28" /></pattern>
          <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={style.colors.primary} stopOpacity={0.12} />
            <stop offset="100%" stopColor={style.colors.bg} stopOpacity={0.95} />
          </radialGradient>
          <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={style.colors.primary} stopOpacity={0} />
            <stop offset="100%" stopColor={style.colors.primary} stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <g opacity={open} transform={`translate(${cx} ${cy}) scale(${interpolate(open, [0, 1], [0.9, 1])}) translate(${-cx} ${-cy})`}>
          <circle cx={cx} cy={cy} r={R * 1.04} fill="none" stroke={style.colors.text} strokeOpacity={0.12} strokeWidth={z.unit * 0.02} />
          <circle cx={cx} cy={cy} r={R} fill="url(#radar-bg)" stroke={style.colors.primary} strokeOpacity={0.75} strokeWidth={z.unit * 0.004} filter="url(#radar-glow)" />
          {[1, 2, 3].map((i) => <circle key={i} cx={cx} cy={cy} r={ring(i)} fill="none" stroke={style.colors.text} strokeOpacity={0.2} strokeWidth={2} />)}
          <path d={`M${cx - R},${cy} L${cx + R},${cy} M${cx},${cy - R} L${cx},${cy + R}`} stroke={style.colors.text} strokeOpacity={0.1} strokeWidth={1.5} />
          {Array.from({ length: 36 }, (_, i) => {
            const a = (i * 10 * Math.PI) / 180, l = i % 3 === 0 ? 0.06 : 0.03;
            return <line key={i} x1={cx + Math.sin(a) * R} y1={cy - Math.cos(a) * R} x2={cx + Math.sin(a) * R * (1 - l)} y2={cy - Math.cos(a) * R * (1 - l)}
              stroke={style.colors.text} strokeOpacity={0.35} strokeWidth={1.5} />;
          })}
          {/* sweep: a fading wedge behind the beam */}
          <g transform={`rotate(${sweep} ${cx} ${cy})`} filter="url(#radar-glow)">
            {Array.from({ length: 10 }, (_, i) => {
              const a0 = (-(i + 1) * 4 * Math.PI) / 180, a1 = (-i * 4 * Math.PI) / 180;
              return <path key={i} d={`M${cx},${cy} L${cx + Math.sin(a0) * R},${cy - Math.cos(a0) * R} A${R},${R} 0 0 1 ${cx + Math.sin(a1) * R},${cy - Math.cos(a1) * R} Z`}
                fill={style.colors.primary} opacity={0.22 * (1 - i / 10)} />;
            })}
            <line x1={cx} y1={cy} x2={cx} y2={cy - R} stroke={style.colors.primary} strokeWidth={z.unit * 0.004} opacity={0.9} />
          </g>
          {/* track history */}
          {Array.from({ length: 7 }, (_, i) => {
            const t = travel - (i + 1) * 0.07;
            if (t < 0) return null;
            const p = pos(t);
            return <circle key={i} cx={p.x} cy={p.y} r={z.unit * 0.005} fill={style.colors.text} opacity={0.55 * (1 - i / 7)} />;
          })}
          {/* the aircraft */}
          {blink ? (
            <g filter="url(#radar-glow)">
              <rect x={now.x - z.unit * 0.011} y={now.y - z.unit * 0.011} width={z.unit * 0.022} height={z.unit * 0.022} fill="none"
                stroke={lost ? lostColor : style.colors.text} strokeWidth={z.unit * 0.004} opacity={lost ? 1 : glow} />
              <line x1={now.x + z.unit * 0.011} y1={now.y - z.unit * 0.011} x2={now.x + z.unit * 0.05} y2={now.y - z.unit * 0.05} stroke={style.colors.text} strokeOpacity={0.7} strokeWidth={1.5} />
              <g transform={`translate(${now.x + z.unit * 0.055} ${now.y - z.unit * 0.06})`} fontFamily={style.fonts.label ?? style.fonts.caption} fontSize={tagFont}
                fill={lost ? lostColor : style.colors.text} fontWeight={700}>
                <text>{g.callsign}</text>
                {alt != null ? <text y={tagFont * 1.15} fontWeight={500} opacity={0.85}>{alt >= 18000 ? `FL${Math.round(alt / 100)}` : `${alt.toLocaleString("en-US")} ft`}</text> : null}
                {g.speed != null ? <text y={tagFont * (alt != null ? 2.3 : 1.15)} fontWeight={500} opacity={0.85}>{`${g.speed} kt`}</text> : null}
              </g>
            </g>
          ) : null}
          <circle cx={cx} cy={cy} r={R} fill="url(#radar-scan)" />
          {lost ? (
            <g opacity={interpolate(frame, [vanishF + 18, vanishF + 30], [0, 1], clamp)} fontFamily={style.fonts.caption} filter="url(#radar-glow)">
              <path d={`M${now.x - 12},${now.y - 12} L${now.x + 12},${now.y + 12} M${now.x + 12},${now.y - 12} L${now.x - 12},${now.y + 12}`} stroke={lostColor} strokeWidth={z.unit * 0.004} />
              <text x={cx} y={cy + R * 0.62} textAnchor="middle" fill={lostColor} fontWeight={800} fontSize={z.unit * 0.05} letterSpacing="0.06em"
                stroke={style.colors.outline} strokeWidth={z.unit * 0.01} paintOrder="stroke">{label}</text>
            </g>
          ) : null}
        </g>
      </svg>
    </Frame>
  );
};

// ---------- profile ----------
// A value over time as a line that draws itself (altitude, speed, wind, water level),
// a plane or dot riding its head and a live readout. points: [["9:03", 35000], ...].
const ProfileG: React.FC<{ g: Extract<GraphicSpec, { type: "profile" }>; style: Style; dur: number }> = ({ g, style, dur }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const z = useZone();
  const top = z.y + (g.title ? z.unit * 0.12 : z.unit * 0.04);
  const pad = { l: z.unit * 0.15, r: z.unit * 0.06, t: z.unit * 0.1, b: z.unit * 0.1 };
  const box = { x: z.x + pad.l, y: top + pad.t, w: z.w - pad.l - pad.r, h: z.h - (top - z.y) - pad.t - pad.b };
  const vals = g.points.map((p) => p[1]);
  const lo = Math.min(0, ...vals), hi = Math.max(...vals) * 1.12 || 1;
  const X = (i: number) => box.x + (g.points.length > 1 ? (i / (g.points.length - 1)) * box.w : box.w / 2);
  const Y = (v: number) => box.y + box.h - ((v - lo) / (hi - lo)) * box.h;
  const pts = g.points.map((p, i) => [X(i), Y(p[1])] as [number, number]);
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0) || 1;
  const prog = interpolate(frame, [fps * 0.4, Math.max(fps * 1.2, dur * 0.82)], [0, 1], { ...clamp, easing: ease.inOut });
  // head position and value along the polyline
  let left = prog * total, k = 0;
  while (k < seg.length - 1 && left > seg[k]) { left -= seg[k]; k++; }
  const f = seg.length ? Math.min(1, left / (seg[k] || 1)) : 0;
  const hx = pts.length > 1 ? lerp(pts[k][0], pts[k + 1][0], f) : pts[0][0];
  const hy = pts.length > 1 ? lerp(pts[k][1], pts[k + 1][1], f) : pts[0][1];
  const hv = pts.length > 1 ? lerp(vals[k], vals[k + 1], f) : vals[0];
  const ang = pts.length > 1 ? (Math.atan2(pts[k + 1][1] - pts[k][1], pts[k + 1][0] - pts[k][0]) * 180) / Math.PI : 0;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${box.y + box.h} L${pts[0][0]},${box.y + box.h} Z`;
  const grid = [0, 0.5, 1].map((t) => lo + (hi / 1.12 - lo) * t);
  const fmt = (v: number) => `${formatNumber(Math.round(v), 0)}${g.unit ? ` ${g.unit}` : ""}`;
  const axis = useEnter(0);
  const reached = (i: number) => prog * total >= seg.slice(0, i).reduce((a, b) => a + b, 0) - 0.5;
  return (
    <Frame style={style} title={g.title} source={g.source}>
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <defs>
          <linearGradient id="profile-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={style.colors.primary} stopOpacity={0.4} />
            <stop offset="100%" stopColor={style.colors.primary} stopOpacity={0} />
          </linearGradient>
          <filter id="profile-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation={z.unit * 0.008} result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <clipPath id="profile-reveal"><rect x={box.x - 4} y={box.y - z.unit * 0.2} width={Math.max(0, hx - box.x + 4)} height={box.h + z.unit * 0.4} /></clipPath>
        </defs>
        <g opacity={axis}>
          {grid.map((v, i) => (
            <g key={i}>
              <line x1={box.x} x2={box.x + box.w} y1={Y(v)} y2={Y(v)} stroke={style.colors.text} strokeOpacity={i === 0 ? 0.4 : 0.12} strokeWidth={1.5} strokeDasharray={i === 0 ? undefined : "6 8"} />
              <text x={box.x - z.unit * 0.02} y={Y(v) + z.unit * 0.012} textAnchor="end" fill={style.colors.text} fillOpacity={0.7} fontFamily={style.fonts.caption} fontSize={z.unit * 0.034} fontWeight={600}>
                {formatNumber(Math.round(v), 0)}
              </text>
            </g>
          ))}
          {g.points.map((p, i) => (
            <text key={i} x={X(i)} y={box.y + box.h + z.unit * 0.055} textAnchor="middle" fill={style.colors.text} fontFamily={style.fonts.caption} fontSize={z.unit * 0.036}
              fontWeight={600} opacity={reached(i) ? 0.9 : 0.25}>{p[0]}</text>
          ))}
        </g>
        <g clipPath="url(#profile-reveal)">
          <path d={area} fill="url(#profile-fill)" />
          <path d={line} fill="none" stroke={style.colors.primary} strokeWidth={z.unit * 0.008} strokeLinejoin="round" strokeLinecap="round" filter="url(#profile-glow)" />
        </g>
        {g.highlight != null && reached(g.highlight) ? (() => {
          const [x, y] = pts[g.highlight];
          const r = ((frame % 30) / 30);
          return <g><circle cx={x} cy={y} r={z.unit * (0.014 + r * 0.04)} fill="none" stroke={style.colors.primary} strokeWidth={3} opacity={1 - r} />
            <circle cx={x} cy={y} r={z.unit * 0.012} fill={style.colors.primary} /></g>;
        })() : null}
        {prog > 0 ? (
          <g transform={`translate(${hx} ${hy})`}>
            {g.icon === "dot" ? <circle r={z.unit * 0.014} fill={style.colors.text} stroke={style.colors.outline} strokeWidth={3} />
              : <g transform={`rotate(${ang + 90}) scale(${z.unit * 0.0034})`}><path d={PLANE} fill={style.colors.text} stroke={style.colors.outline} strokeWidth={1.2} /></g>}
            <g transform={`translate(0 ${-z.unit * 0.06})`}>
              <text textAnchor={hx > box.x + box.w * 0.7 ? "end" : hx < box.x + box.w * 0.3 ? "start" : "middle"} fill={style.colors.text} fontFamily={style.fonts.caption}
                fontWeight={800} fontSize={z.unit * 0.05} stroke={style.colors.outline} strokeWidth={z.unit * 0.01} paintOrder="stroke">{fmt(hv)}</text>
            </g>
          </g>
        ) : null}
      </svg>
    </Frame>
  );
};

// ---------- aircraft ----------
// A clean technical drawing of an airliner that explains a mechanism: parts light up
// ("engine-left", "wing-right", "tail", "fin", "cockpit", "door", "gear"...), the top view
// tilts into 3D and can bank ("roll"), the side view pitches nose up/down ("pitch") against
// a level horizon with the angle read out. Labels point at parts.
type Part = { d: string; at: [number, number]; stroke?: boolean };
const TOP: Record<string, Part> = {
  fuselage: { d: "M100,8 C106,8 109,20 109,34 L109,180 C109,192 104,204 100,208 C96,204 91,192 91,180 L91,34 C91,20 94,8 100,8 Z", at: [100, 60] },
  cockpit: { d: "M95,20 L105,20 L104,29 L96,29 Z", at: [100, 24] },
  "wing-left": { d: "M91,86 L16,126 L16,137 L91,117 Z", at: [40, 124] },
  "wing-right": { d: "M109,86 L184,126 L184,137 L109,117 Z", at: [160, 124] },
  "engine-left": { d: "M51,96 h11 v27 h-11 Z", at: [56, 110] },
  "engine-right": { d: "M138,96 h11 v27 h-11 Z", at: [144, 110] },
  "tail-left": { d: "M93,176 L62,195 L62,202 L93,191 Z", at: [72, 196] },
  "tail-right": { d: "M107,176 L138,195 L138,202 L107,191 Z", at: [128, 196] },
  fin: { d: "M98.5,168 h3 v40 h-3 Z", at: [100, 190] },
};
const SIDE: Record<string, Part> = {
  fuselage: { d: "M18,54 C18,45 24,40 38,40 L208,40 C228,40 246,46 254,56 C246,65 230,68 208,68 L38,68 C24,68 18,63 18,54 Z", at: [130, 44] },
  cockpit: { d: "M229,47 L241,50 L239,54 L227,52 Z", at: [235, 50] },
  wing: { d: "M108,57 L162,57 L152,63 L102,63 Z", at: [130, 60] },
  engine: { d: "M116,64 h36 a6,6 0 0 1 0,12 h-36 a6,6 0 0 1 0,-12 Z", at: [134, 70] },
  fin: { d: "M22,42 L8,6 L28,6 L58,40 Z", at: [26, 20] },
  tail: { d: "M10,47 L46,47 L42,52 L8,52 Z", at: [26, 50] },
  door: { d: "M66,44 h7 v19 h-7 Z", at: [70, 52] },
  gear: { d: "M126,76 v14 M200,68 v22 M120,92 a5,5 0 1 0 12,0 a5,5 0 1 0 -12,0 M194,92 a5,5 0 1 0 12,0 a5,5 0 1 0 -12,0", at: [200, 86], stroke: true },
};
const PART_ALIAS: Record<string, string> = { "left-engine": "engine-left", "right-engine": "engine-right", "left-wing": "wing-left", "right-wing": "wing-right",
  "landing-gear": "gear", stabilizer: "tail", "horizontal-stabilizer": "tail", "vertical-stabilizer": "fin", rudder: "fin", nose: "cockpit", "door-plug": "door" };
const AircraftG: React.FC<{ g: Extract<GraphicSpec, { type: "aircraft" }>; style: Style; dur: number }> = ({ g, style, dur }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const z = useZone();
  const side = g.view === "side";
  const parts = side ? SIDE : TOP;
  const norm = (n: string) => { const k = n.toLowerCase().replace(/\s+/g, "-"); return PART_ALIAS[k] ?? k; };
  const lit = new Set((g.highlight ?? []).map(norm).flatMap((k) => (side ? [k.replace(/-(left|right)$/, "")] : k === "tail" ? ["tail-left", "tail-right"] : [k])));
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const box = { x: z.x, y: top, w: z.w, h: z.h - (top - z.y) };
  const [vw, vh] = side ? [262, 100] : [200, 216];
  const k = Math.min((box.w * (side ? 0.9 : 0.8)) / vw, (box.h * (side ? 0.78 : 0.95)) / vh);
  const ox = box.x + (box.w - vw * k) / 2, oy = box.y + (box.h - vh * k) / 2;
  const draw = interpolate(frame, [0, fps * 0.9], [0, 1], { ...clamp, easing: ease.out });
  const tilt = side ? 0 : interpolate(spring({ frame: frame - fps * 0.5, fps, config: { damping: 30, stiffness: 40 } }), [0, 1], [0, 52]);
  const spin = side ? 0 : interpolate(frame, [0, dur], [-8, 10]);
  const rollNow = g.roll ? interpolate(frame, [fps * 1.4, fps * 2.6], [0, g.roll], { ...clamp, easing: ease.inOut }) : 0;
  const pitchNow = g.pitch ? interpolate(frame, [fps * 1.1, fps * 2.4], [0, g.pitch], { ...clamp, easing: ease.inOut }) : 0;
  const pulse = 0.55 + 0.45 * Math.sin(frame / 5);
  const litOn = interpolate(frame, [fps * 0.9, fps * 1.3], [0, 1], clamp);
  const S = (p: [number, number]) => [ox + p[0] * k, oy + p[1] * k] as [number, number];
  // Where a part is on screen after the motion (so label lines stay on their part).
  const deg = Math.PI / 180;
  const place = (p: [number, number]): [number, number] => {
    if (side) {
      const [cx0, cy0] = S([136, 54]), [x, y] = S(p), a = -pitchNow * deg;
      return [cx0 + (x - cx0) * Math.cos(a) - (y - cy0) * Math.sin(a), cy0 + (x - cx0) * Math.sin(a) + (y - cy0) * Math.cos(a)];
    }
    // CSS: rotateX(tilt) rotateZ(spin) rotateY(roll) around 50% 55%, then perspective from the box centre
    const o = [ox + vw * k * 0.5, oy + vh * k * 0.55], c = [ox + vw * k * 0.5, oy + vh * k * 0.5];
    let x = ox + p[0] * k - o[0], y = oy + p[1] * k - o[1], zz = 0;
    const ry = rollNow * deg, rz = spin * deg, rx = tilt * deg;
    [x, zz] = [x * Math.cos(ry) + zz * Math.sin(ry), -x * Math.sin(ry) + zz * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    [y, zz] = [y * Math.cos(rx) - zz * Math.sin(rx), y * Math.sin(rx) + zz * Math.cos(rx)];
    const X = o[0] + x, Y = o[1] + y, d = z.unit * 2.2, f = d / (d - zz);
    return [c[0] + (X - c[0]) * f, c[1] + (Y - c[1]) * f];
  };
  const labels = (g.labels ?? []).map((l, i) => ({ ...l, key: norm(l.part), i }));
  const labelOn = (i: number) => interpolate(frame, [fps * (1.3 + i * 0.25), fps * (1.6 + i * 0.25)], [0, 1], clamp);
  const model = (
    <svg width={vw * k} height={vh * k} viewBox={`0 0 ${vw} ${vh}`} style={{ overflow: "visible" }}>
      <defs>
        <filter id="ac-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {side ? <g opacity={0.5}>{Array.from({ length: 20 }, (_, i) => <circle key={i} cx={84 + i * 7} cy={48} r={1.3} fill={style.colors.text} />)}</g> : null}
      {Object.entries(parts).map(([name, part]) => {
        const on = lit.has(name);
        return (
          <path key={name} d={part.d} pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw}
            fill={part.stroke ? "none" : on ? style.colors.primary : style.colors.text} fillOpacity={part.stroke ? 0 : on ? (0.35 + 0.5 * pulse) * litOn + 0.08 * (1 - litOn) : 0.08 * draw}
            stroke={on ? style.colors.primary : style.colors.text} strokeOpacity={on ? 1 : 0.75} strokeWidth={on ? 1.6 : 1}
            filter={on && litOn > 0.5 ? "url(#ac-glow)" : undefined} strokeLinejoin="round" />
        );
      })}
    </svg>
  );
  const pivot = side ? S([136, 54]) : S([100, 108]);
  return (
    <Frame style={style} title={g.title} source={g.source}>
      {side ? (
        <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
          <line x1={box.x} x2={box.x + box.w} y1={pivot[1]} y2={pivot[1]} stroke={style.colors.text} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="10 10" />
          {g.pitch ? (() => {
            // a protractor at the nose: the level line, the nose line, the angle between them
            const r = 118 * k, a = (pitchNow * Math.PI) / 180;
            const nose = [pivot[0] + Math.cos(a) * r, pivot[1] - Math.sin(a) * r];
            return <g>
              <line x1={pivot[0]} y1={pivot[1]} x2={nose[0]} y2={nose[1]} stroke={style.colors.primary} strokeWidth={3} strokeDasharray="8 8" opacity={0.8} />
              <path d={`M${pivot[0] + r},${pivot[1]} A${r},${r} 0 0 ${pitchNow > 0 ? 0 : 1} ${nose[0]},${nose[1]}`} fill="none" stroke={style.colors.primary} strokeWidth={6} />
            </g>;
          })() : null}
        </svg>
      ) : null}
      <div style={{ position: "absolute", left: ox, top: oy, width: vw * k, height: vh * k, perspective: z.unit * 2.2 }}>
        <div style={{ transformOrigin: side ? `${136 * k}px ${54 * k}px` : "50% 55%",
          transform: side ? `rotate(${-pitchNow}deg)` : `rotateX(${tilt}deg) rotateZ(${spin}deg) rotateY(${rollNow}deg)`, transformStyle: "preserve-3d" }}>
          {!side ? (
            // the shadow on the "ground" sells the 3D tilt
            <div style={{ position: "absolute", inset: 0, transform: `translateZ(${-z.unit * 0.12}px)`, opacity: 0.35 * (tilt / 52), filter: "blur(10px)" }}>
              <svg width={vw * k} height={vh * k} viewBox={`0 0 ${vw} ${vh}`}>{Object.values(parts).map((p, i) => <path key={i} d={p.d} fill="#000" />)}</svg>
            </div>
          ) : null}
          {model}
        </div>
      </div>
      {side && g.pitch ? (
        <div style={{ position: "absolute", left: box.x, width: box.w, top: box.y + box.h * 0.84, display: "flex", justifyContent: "center",
          opacity: interpolate(frame, [fps * 1.1, fps * 1.4], [0, 1], clamp) }}>
          <div style={{ background: style.colors.primary, color: style.colors.outline, borderRadius: z.unit, padding: `${z.unit * 0.012}px ${z.unit * 0.035}px`,
            fontFamily: style.fonts.caption, fontWeight: 800, fontSize: z.unit * 0.05, letterSpacing: "0.02em" }}>
            {`NOSE ${pitchNow < 0 ? "DOWN" : "UP"} ${Math.abs(Math.round(pitchNow))}°`}
          </div>
        </div>
      ) : null}
      <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {labels.map((l) => {
          const part = parts[l.key] ?? (side ? parts[l.key.replace(/-(left|right)$/, "")] : undefined);
          if (!part) return null;
          const [px, py] = place(part.at);
          const right = px > box.x + box.w / 2;
          const ty = box.y + box.h * (0.12 + 0.22 * (l.i % 4)) + (side ? box.h * 0.1 : 0);
          const tx = right ? box.x + box.w - z.unit * 0.02 : box.x + z.unit * 0.02;
          const o = labelOn(l.i);
          return (
            <g key={l.i} opacity={o}>
              <path d={`M${px},${py} L${right ? tx - z.unit * 0.2 : tx + z.unit * 0.2},${ty}`} stroke={style.colors.primary} strokeWidth={2.5} fill="none" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - o} />
              <circle cx={px} cy={py} r={z.unit * 0.008} fill={style.colors.primary} />
              <text x={tx} y={ty - z.unit * 0.01} textAnchor={right ? "end" : "start"} fill={style.colors.text} fontFamily={style.fonts.caption} fontWeight={800}
                fontSize={z.unit * 0.04} stroke={style.colors.outline} strokeWidth={z.unit * 0.009} paintOrder="stroke">{l.text}</text>
            </g>
          );
        })}
      </svg>
    </Frame>
  );
};


// ---------- explainers ----------
// Each item lands on its own words: `at` holds frames from the shot's start
// (build-timeline fills it from the items' "on" phrases, or spreads them evenly).
const itemText = (it: Item) => (typeof it === "string" ? it : it.text);
const itemIcon = (it: Item) => (typeof it === "string" ? undefined : it.icon);
const atOf = (at: number[] | undefined, i: number, gap = 8) => at?.[i] ?? 4 + i * gap;

// Every slot is laid out as a faint outline from the first frame (so the screen is
// never empty while the voice gets to item 1); an item fills its slot on its words.
const Card: React.FC<{ style: Style; active: boolean; p: number; children: React.ReactNode; css?: React.CSSProperties }> = ({ style, active, p, children, css }) => {
  const z = useZone();
  const ghost = useEnter(0);
  return (
    <div style={{
      background: `linear-gradient(180deg, ${style.colors.bgAlt}F2, ${style.colors.bg}F2)`,
      border: `${Math.max(2, z.unit * 0.0025)}px solid ${active ? style.colors.primary : `${style.colors.text}26`}`,
      borderRadius: z.unit * 0.022, boxShadow: active ? `0 0 ${z.unit * 0.04}px ${style.colors.primary}55, 0 ${z.unit * 0.012}px ${z.unit * 0.04}px rgba(0,0,0,0.45)` : `0 ${z.unit * 0.01}px ${z.unit * 0.03}px rgba(0,0,0,0.4)`,
      opacity: Math.max(0.28 * ghost, interpolate(p, [0, 0.4], [0, 1], clamp)), ...css,
    }}>{children}</div>
  );
};

const Bullet: React.FC<{ style: Style; label: string; size: number; active: boolean }> = ({ style, label, size, active }) => (
  <div style={{
    flex: "0 0 auto", width: size, height: size, borderRadius: size * 0.3, display: "flex", alignItems: "center", justifyContent: "center",
    background: active ? style.colors.primary : `${style.colors.text}1F`, color: active ? style.colors.outline : style.colors.text,
    fontFamily: style.fonts.emphasis, fontSize: size * 0.52, lineHeight: 1,
  }}>{label}</div>
);

const ListG: React.FC<{ g: Extract<GraphicSpec, { type: "list" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const n = g.items.length;
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const area = z.h - (top - z.y);
  const gapY = z.unit * 0.018;
  const row = Math.min((area - gapY * (n - 1)) / n, z.unit * 0.13);
  const w = Math.min(z.w, z.unit * 1.1);
  const longest = Math.max(...g.items.map((it) => itemText(it).length));
  const fontSize = Math.min(row * 0.34, (w * 0.78) / Math.max(10, longest * 0.5));
  const current = g.items.reduce((c, _, i) => (frame >= atOf(g.at, i) ? i : c), -1);
  return (
    <Frame style={style} title={g.title}>
      {g.items.map((it, i) => {
        const p = spring({ frame: frame - atOf(g.at, i), fps, config: springs.smooth });
        const active = i === current;
        return (
          <Card key={i} style={style} active={active} p={p} css={{
            position: "absolute", left: z.x + (z.w - w) / 2, width: w, top: top + (area - (row * n + gapY * (n - 1))) / 2 + i * (row + gapY), height: row,
            display: "flex", alignItems: "center", gap: row * 0.25, padding: `0 ${row * 0.25}px`,
            transform: `translateY(${interpolate(p, [0, 1], [row * 0.15, 0])}px) scale(${active ? 1 + 0.02 * p : 1})`,
            filter: i < current ? "saturate(0.6) brightness(0.8)" : "none",
          }}>
            <Bullet style={style} label={itemIcon(it) ?? (g.numbered === false ? "•" : String(i + 1))} size={row * 0.6} active={active} />
            <div style={{ fontFamily: style.fonts.caption, fontWeight: style.captionWeight, fontSize, color: style.colors.text, lineHeight: 1.12, opacity: interpolate(p, [0.2, 0.7], [0, 1], clamp) }}>{itemText(it)}</div>
          </Card>
        );
      })}
    </Frame>
  );
};

const StepsG: React.FC<{ g: Extract<GraphicSpec, { type: "steps" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const n = g.items.length;
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const area = z.h - (top - z.y);
  // Landscape: a row of nodes; portrait: a column.
  const across = !z.portrait;
  const gap = z.unit * (across ? 0.06 : 0.035);
  const nodeW = across ? Math.min((z.w - gap * (n - 1)) / n, z.unit * 0.42) : Math.min(z.w, z.unit * 0.9);
  const nodeH = across ? Math.min(area * 0.62, nodeW * 0.95) : Math.min((area - gap * (n - 1)) / n, z.unit * 0.15);
  const total = across ? nodeW * n + gap * (n - 1) : nodeH * n + gap * (n - 1);
  const x0 = across ? z.x + (z.w - total) / 2 : z.x + (z.w - nodeW) / 2;
  const y0 = across ? top + (area - nodeH) / 2 : top + (area - total) / 2;
  const longest = Math.max(...g.items.map((it) => itemText(it).length));
  const fontSize = across ? Math.min(nodeW * 0.13, (nodeW * 0.85 * 3) / Math.max(12, longest * 0.55)) : Math.min(nodeH * 0.32, (nodeW * 0.7) / Math.max(10, longest * 0.5));
  const current = g.items.reduce((c, _, i) => (frame >= atOf(g.at, i, 12) ? i : c), -1);
  const pos = (i: number) => (across ? { x: x0 + i * (nodeW + gap), y: y0 } : { x: x0, y: y0 + i * (nodeH + gap) });
  return (
    <Frame style={style} title={g.title}>
      {g.items.slice(1).map((_, k) => {
        const i = k + 1;
        const a = pos(i - 1), b = pos(i);
        const p = interpolate(frame, [atOf(g.at, i, 12) - 6, atOf(g.at, i, 12) + 4], [0, 1], { ...clamp, easing: ease.out });
        const thick = Math.max(3, z.unit * 0.005);
        const style2: React.CSSProperties = across
          ? { left: a.x + nodeW + gap * 0.15, top: a.y + nodeH / 2 - thick / 2, width: gap * 0.7 * p, height: thick }
          : { left: a.x + nodeW / 2 - thick / 2, top: a.y + nodeH + gap * 0.15, width: thick, height: gap * 0.7 * p };
        return (
          <div key={`c${i}`} style={{ position: "absolute", ...style2, background: style.colors.primary, borderRadius: thick }}>
            <div style={{
              position: "absolute", [across ? "right" : "bottom"]: -thick * 2, [across ? "top" : "left"]: -thick * 1.5, opacity: p,
              width: 0, height: 0, borderStyle: "solid",
              borderWidth: across ? `${thick * 2}px 0 ${thick * 2}px ${thick * 3}px` : `${thick * 3}px ${thick * 2}px 0 ${thick * 2}px`,
              borderColor: across ? `transparent transparent transparent ${style.colors.primary}` : `${style.colors.primary} transparent transparent transparent`,
            }} />
          </div>
        );
      })}
      {g.items.map((it, i) => {
        const p = spring({ frame: frame - atOf(g.at, i, 12), fps, config: springs.smooth });
        const active = i === current;
        const { x, y } = pos(i);
        return (
          <Card key={i} style={style} active={active} p={p} css={{
            position: "absolute", left: x, top: y, width: nodeW, height: nodeH, display: "flex",
            flexDirection: across ? "column" : "row", alignItems: "center", justifyContent: across ? "center" : "flex-start",
            gap: z.unit * 0.02, padding: z.unit * 0.02, textAlign: across ? "center" : "left",
            transform: `scale(${interpolate(p, [0, 1], [0.94, active ? 1.04 : 1])})`,
          }}>
            <Bullet style={style} label={itemIcon(it) ?? String(i + 1)} size={across ? nodeW * 0.24 : nodeH * 0.55} active={active || i < current} />
            <div style={{ fontFamily: style.fonts.caption, fontWeight: style.captionWeight, fontSize, color: style.colors.text, lineHeight: 1.12, opacity: interpolate(p, [0.2, 0.7], [0, 1], clamp) }}>{itemText(it)}</div>
          </Card>
        );
      })}
    </Frame>
  );
};

const CompareG: React.FC<{ g: Extract<GraphicSpec, { type: "compare" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const top = z.y + (g.title ? z.unit * 0.1 : 0);
  const area = z.h - (top - z.y);
  const gap = z.unit * 0.04;
  const colW = (z.w - gap) / 2;
  const rows = Math.max(g.left.items.length, g.right.items.length);
  const head = Math.min(z.unit * 0.1, area * 0.2);
  const row = Math.min((area - head - z.unit * 0.03) / rows, z.unit * 0.1);
  const longest = Math.max(...[...g.left.items, ...g.right.items].map((it) => itemText(it).length), g.left.label.length, g.right.label.length);
  const fontSize = Math.min(row * 0.36, (colW * 0.8) / Math.max(10, longest * 0.5));
  const toneColor = (t?: string) => (t === "good" ? "#34D399" : t === "bad" ? "#F87171" : style.colors.primary);
  const sides = [g.left, g.right];
  let k = 0;
  return (
    <Frame style={style} title={g.title}>
      {sides.map((side, si) => {
        const x = z.x + si * (colW + gap);
        const hp = spring({ frame: frame - atOf(g.at, k, 8) + 4, fps, config: springs.snappy });
        const color = toneColor(side.tone);
        return (
          <div key={si}>
            <div style={{
              position: "absolute", left: x, top, width: colW, height: head, borderRadius: z.unit * 0.02, background: `${color}26`,
              border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: style.fonts.emphasis, fontSize: head * 0.45, color, opacity: hp, transform: `translateY(${interpolate(hp, [0, 1], [-head * 0.4, 0])}px)`,
            }}>{side.label}</div>
            {side.items.map((it, i) => {
              const idx = k++;
              const p = spring({ frame: frame - atOf(g.at, idx, 8), fps, config: springs.smooth });
              return (
                <div key={i} style={{
                  position: "absolute", left: x + z.unit * 0.01, width: colW - z.unit * 0.02, top: top + head + z.unit * 0.03 + i * row, height: row,
                  display: "flex", alignItems: "center", gap: row * 0.22, opacity: interpolate(p, [0, 0.4], [0, 1], clamp),
                  transform: `translateX(${interpolate(p, [0, 1], [(si ? 1 : -1) * colW * 0.08, 0])}px)`,
                }}>
                  <div style={{ flex: "0 0 auto", width: row * 0.42, height: row * 0.42, borderRadius: "50%", background: color, color: style.colors.outline,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: row * 0.28, fontFamily: style.fonts.emphasis }}>
                    {itemIcon(it) ?? (side.tone === "bad" ? "✕" : "✓")}
                  </div>
                  <div style={{ fontFamily: style.fonts.caption, fontWeight: style.captionWeight, fontSize, color: style.colors.text, lineHeight: 1.1 }}>{itemText(it)}</div>
                </div>
              );
            })}
          </div>
        );
      })}
    </Frame>
  );
};

const StatementG: React.FC<{ g: Extract<GraphicSpec, { type: "statement" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const words = g.text.split(/\s+/);
  const hl = new Set((g.highlight ?? "").toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")));
  const fontSize = Math.min(z.unit * 0.1, Math.sqrt((z.w * z.h * 0.42) / (g.text.length * 0.55)));
  const kick = useEnter(0, springs.snappy);
  const last = 6 + words.length * 3;
  return (
    <Frame style={style}>
      <AbsoluteFill style={{ top: z.y, height: z.h, left: z.x, width: z.w, justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
        {g.kicker ? (
          <div style={{
            fontFamily: style.fonts.caption, fontWeight: 800, fontSize: fontSize * 0.32, letterSpacing: "0.12em", textTransform: "uppercase",
            color: style.colors.primary, marginBottom: fontSize * 0.3, opacity: kick, transform: `translateY(${interpolate(kick, [0, 1], [fontSize * 0.3, 0])}px)`,
          }}>{g.kicker}</div>
        ) : null}
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: fontSize * 0.26, maxWidth: z.w }}>
          {words.map((w, i) => {
            const p = spring({ frame: frame - 4 - i * 3, fps, config: springs.snappy });
            const isHl = hl.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
            const under = interpolate(frame, [last, last + 12], [0, 1], { ...clamp, easing: ease.out });
            return (
              <span key={i} style={{
                position: "relative", display: "inline-block", fontFamily: style.fonts.emphasis, fontSize, lineHeight: 1.15,
                color: isHl ? style.colors.primary : style.colors.text, opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [fontSize * 0.45, 0])}px)`,
              }}>
                {w}
                {isHl ? <span style={{ position: "absolute", left: 0, bottom: fontSize * 0.02, height: fontSize * 0.08, width: `${under * 100}%`, background: style.colors.primary, borderRadius: fontSize }} /> : null}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </Frame>
  );
};

const UiG: React.FC<{ g: Extract<GraphicSpec, { type: "ui" }>; style: Style }> = ({ g, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const z = useZone();
  const phone = g.device === "phone";
  const enter = useEnter(0);
  const bar = z.unit * (phone ? 0.04 : 0.05);
  const h = z.h * 0.98;
  const w = phone ? Math.min(z.w, h * 0.5) : Math.min(z.w, (h - bar) * 1.6);
  const x = z.x + (z.w - w) / 2, y = z.y + (z.h - h) / 2;
  const radius = z.unit * (phone ? 0.05 : 0.018);
  const hlAt = atOf(g.at, 0, 0) || Math.round(fps * 0.6);
  const hp = interpolate(frame, [hlAt, hlAt + 14], [0, 1], { ...clamp, easing: ease.out });
  const screenH = h - (phone ? 0 : bar);
  // Slow push toward the highlighted area once it is drawn.
  const [hx, hy, hw, hh] = g.highlight ?? [0, 0, 100, 100];
  const push = g.highlight ? interpolate(frame, [hlAt, hlAt + fps * 2], [1, 1.12], { ...clamp, easing: ease.inOut }) : 1 + frame * 0.0006;
  const origin = `${hx + hw / 2}% ${hy + hh / 2}%`;
  return (
    <Frame style={style}>
      <div style={{
        position: "absolute", left: x, top: y, width: w, height: h, borderRadius: radius, overflow: "hidden",
        background: "#0E0E14", border: `${Math.max(2, z.unit * 0.003)}px solid ${style.colors.text}33`,
        boxShadow: `0 ${z.unit * 0.03}px ${z.unit * 0.08}px rgba(0,0,0,0.6)`,
        opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [z.unit * 0.06, 0])}px) scale(${interpolate(enter, [0, 1], [0.94, 1])})`,
      }}>
        {!phone && (
          <div style={{ height: bar, display: "flex", alignItems: "center", gap: bar * 0.18, padding: `0 ${bar * 0.35}px`, background: "#1B1B24" }}>
            {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <div key={c} style={{ width: bar * 0.24, height: bar * 0.24, borderRadius: "50%", background: c }} />)}
            <div style={{
              marginLeft: bar * 0.3, flex: 1, height: bar * 0.56, borderRadius: bar, background: "#2A2A36", color: "#B8B8C8",
              display: "flex", alignItems: "center", padding: `0 ${bar * 0.35}px`, fontFamily: style.fonts.caption, fontWeight: 600, fontSize: bar * 0.3,
            }}>{g.url ?? ""}</div>
          </div>
        )}
        <div style={{ position: "relative", width: "100%", height: screenH, overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, transform: `scale(${push})`, transformOrigin: origin }}>
            <Img src={staticFile(g.image)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
            {g.highlight ? (
              <>
                {/* Spotlight: everything but the highlighted area dims. */}
                <div style={{
                  position: "absolute", left: `${hx}%`, top: `${hy}%`, width: `${hw}%`, height: `${hh}%`, borderRadius: z.unit * 0.012,
                  boxShadow: `0 0 0 ${z.unit * 2}px rgba(0,0,0,${0.55 * hp})`,
                }} />
                <svg style={{ position: "absolute", left: `${hx}%`, top: `${hy}%`, width: `${hw}%`, height: `${hh}%`, overflow: "visible" }} viewBox="0 0 100 100" preserveAspectRatio="none">
                  <rect x={0} y={0} width={100} height={100} rx={3} fill="none" stroke={style.colors.primary} strokeWidth={Math.max(2, z.unit * 0.004)}
                    vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - hp} />
                </svg>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {g.caption ? (
        <div style={{
          position: "absolute", left: z.x, width: z.w, top: y + h - z.unit * 0.09, display: "flex", justifyContent: "center", opacity: hp,
          transform: `translateY(${interpolate(hp, [0, 1], [z.unit * 0.02, 0])}px)`,
        }}>
          <div style={{
            background: style.colors.primary, color: style.colors.outline, borderRadius: z.unit, padding: `${z.unit * 0.012}px ${z.unit * 0.03}px`,
            fontFamily: style.fonts.caption, fontWeight: 800, fontSize: z.unit * 0.034, boxShadow: `0 ${z.unit * 0.01}px ${z.unit * 0.03}px rgba(0,0,0,0.5)`,
          }}>{g.caption}</div>
        </div>
      ) : null}
    </Frame>
  );
};

export const Graphic: React.FC<{ graphic: GraphicSpec; style: Style; dur?: number }> = ({ graphic, style, dur }) => {
  const { fps } = useVideoConfig();
  const d = dur ?? fps * 4;
  switch (graphic.type) {
    case "counter": return <Counter g={graphic} style={style} />;
    case "bars": return <Bars g={graphic} style={style} />;
    case "timeline": return <TimelineG g={graphic} style={style} />;
    case "quote": return <Quote g={graphic} style={style} />;
    case "map": return <MapG g={graphic} style={style} />;
    case "globe": return graphic.look === "vector" ? <GlobeG g={graphic} style={style} /> : <Earth3D g={graphic} style={style} dur={d} />;
    case "radar": return <RadarG g={graphic} style={style} dur={d} />;
    case "profile": return <ProfileG g={graphic} style={style} dur={d} />;
    case "aircraft": return graphic.look === "vector" ? <AircraftG g={graphic} style={style} dur={d} /> : <Aircraft3D g={graphic} style={style} dur={d} />;
    case "list": return <ListG g={graphic} style={style} />;
    case "steps": return <StepsG g={graphic} style={style} />;
    case "compare": return <CompareG g={graphic} style={style} />;
    case "statement": return <StatementG g={graphic} style={style} />;
    case "ui": return <UiG g={graphic} style={style} />;
    default: return null;
  }
};
