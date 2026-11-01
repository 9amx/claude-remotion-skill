// 3D explainers: mechanisms and physical events a chart or a stock clip can't show.
// Everything is built from code (no model files) and driven only by the frame, so
// parallel render tabs always agree. Each stage lands on its own spoken words:
//   { "on": "roller-delayed", "graphic": { "type": "model3d", "model": "roller", "title": "Roller-delayed",
//     "items": [{ "text": "Two rollers in the bolt head", "on": "two small rollers" }, ...] } }
// These are teaching schematics: proportions are simplified, except the cartridges,
// which are drawn to true scale from their published dimensions.
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import React, { useLayoutEffect, useMemo } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { clamp, ease, springs, type Style } from "../theme";
import type { GraphicSpec, Item } from "../types";

export type Model3DSpec = Extract<GraphicSpec, { type: "model3d" }>;
type V3 = [number, number, number];
type Pin = { at: V3; text: string; o: number; dx?: number; dy?: number };
type Built = { node: React.ReactNode; pos: V3; target: V3; fov?: number; pins?: Pin[] };
type Ctx = { f: number; len: number; at: number[]; p: (i: number, dur?: number, delay?: number) => number; gold: string; hot: string };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const text = (it: Item) => (typeof it === "string" ? it : it.text);

// ---------- materials ----------
const Steel: React.FC<{ c?: string; o?: number; r?: number }> = ({ c = "#5a5e65", o = 1, r = 0.38 }) => (
  <meshStandardMaterial color={c} metalness={0.92} roughness={r} transparent={o < 1} opacity={o} depthWrite={o >= 1} side={THREE.DoubleSide} />
);
const Polymer: React.FC<{ c?: string }> = ({ c = "#3a3d42" }) => <meshStandardMaterial color={c} metalness={0.1} roughness={0.62} side={THREE.DoubleSide} />;
const Brass = () => <meshStandardMaterial color="#d2a24a" metalness={0.85} roughness={0.42} />;
const Copper = () => <meshStandardMaterial color="#c4733f" metalness={0.85} roughness={0.42} />;
const Accent: React.FC<{ c: string; glow?: number }> = ({ c, glow = 0.18 }) => <meshStandardMaterial color={c} emissive={c} emissiveIntensity={glow} metalness={0.75} roughness={0.32} side={THREE.DoubleSide} />;

// ---------- geometry ----------
// A half tube along +x: `roll` turns its open side to the camera, so the bore shows.
const halfTube = (outer: number, inner: number, len: number, roll: number) => {
  const s = new THREE.Shape();
  s.absarc(0, 0, outer, 0, Math.PI, false);
  s.lineTo(-inner, 0);
  s.absarc(0, 0, inner, Math.PI, 0, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 40 });
  g.rotateY(Math.PI / 2);
  g.rotateX(roll);
  return g;
};
const HalfTube: React.FC<{ outer: number; inner: number; len: number; roll: number; x?: number; y?: number; children: React.ReactNode }> = ({ outer, inner, len, roll, x = 0, y = 0, children }) => {
  const g = useMemo(() => halfTube(outer, inner, len, roll), [outer, inner, len, roll]);
  return <mesh geometry={g} position={[x, y, 0]} castShadow receiveShadow>{children}</mesh>;
};
const Box: React.FC<{ from: V3; to: V3; children: React.ReactNode; rot?: V3 }> = ({ from, to, children, rot }) => (
  <mesh position={[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2]} rotation={rot} castShadow receiveShadow>
    <boxGeometry args={[Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), Math.abs(to[2] - from[2])]} />
    {children}
  </mesh>
);
const Rod: React.FC<{ x0: number; x1: number; r: number; y?: number; z?: number; children: React.ReactNode }> = ({ x0, x1, r, y = 0, z = 0, children }) => (
  <mesh position={[(x0 + x1) / 2, y, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
    <cylinderGeometry args={[r, r, Math.abs(x1 - x0), 32]} />
    {children}
  </mesh>
);
// A profile [radius, x] spun around the x axis.
const Spun: React.FC<{ pts: [number, number][]; smooth?: boolean; children: React.ReactNode }> = ({ pts, smooth, children }) => {
  const g = useMemo(() => {
    const raw = pts.map(([r, x]) => new THREE.Vector2(r, x));
    const fine = smooth ? new THREE.SplineCurve(raw.slice(1, -1)).getPoints(40) : raw;
    const line = smooth ? [raw[0], ...fine, raw[raw.length - 1]] : raw;
    const l = new THREE.LatheGeometry(line, 72);
    l.rotateZ(-Math.PI / 2);
    return l;
  }, [pts, smooth]);
  return <mesh geometry={g} castShadow>{children}</mesh>;
};
const Spring: React.FC<{ x0: number; x1: number; r?: number; coils?: number; y?: number }> = ({ x0, x1, r = 0.42, coils = 11, y = 0 }) => {
  const L = Math.round((x1 - x0) * 20) / 20;
  const g = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= coils * 16; i++) {
      const t = i / (coils * 16), a = t * coils * Math.PI * 2;
      pts.push(new THREE.Vector3(t * L, Math.cos(a) * r, Math.sin(a) * r));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), coils * 24, 0.05, 10);
  }, [r, coils, L]);
  return <mesh geometry={g} position={[x0, y, 0]} castShadow><Steel c="#9a9ea5" r={0.3} /></mesh>;
};
// Glowing gas: additive, so it reads as heat and not as an object.
const Gas: React.FC<{ x: number; y?: number; z?: number; s: number; o: number; c?: string; sx?: number }> = ({ x, y = 0, z = 0, s, o, c = "#ff9a3c", sx = 1 }) => o <= 0.01 ? null : (
  <group position={[x, y, z]}>
    <mesh scale={[s * sx, s, s]}><sphereGeometry args={[1, 24, 16]} /><meshBasicMaterial color={c} transparent opacity={o * 0.55} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
    <mesh scale={[s * sx * 0.55, s * 0.55, s * 0.55]}><sphereGeometry args={[1, 24, 16]} /><meshBasicMaterial color="#fff0c8" transparent opacity={o * 0.8} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
    <pointLight color={c} intensity={o * 26} distance={8} decay={2} />
  </group>
);
const Arrow: React.FC<{ x: number; y?: number; z?: number; dir?: 1 | -1; o: number; c: string; len?: number }> = ({ x, y = 0, z = 0, dir = -1, o, c, len = 1.3 }) => o <= 0.01 ? null : (
  <group position={[x, y, z]} rotation={[0, 0, dir > 0 ? -Math.PI / 2 : Math.PI / 2]}>
    <mesh position={[0, len / 2, 0]}><cylinderGeometry args={[0.07, 0.07, len, 14]} /><meshBasicMaterial color={c} transparent opacity={o} toneMapped={false} /></mesh>
    <mesh position={[0, len + 0.17, 0]}><coneGeometry args={[0.2, 0.36, 18]} /><meshBasicMaterial color={c} transparent opacity={o} toneMapped={false} /></mesh>
  </group>
);

// ---------- cartridges, true scale (1 unit = 10 mm) ----------
const NINE_CASE: [number, number][] = [[0, 0], [0.49, 0], [0.49, 0.09], [0.41, 0.12], [0.41, 0.17], [0.48, 0.21], [0.47, 1.92], [0.44, 1.92], [0, 1.92]];
const NINE_BULLET: [number, number][] = [[0, 1.9], [0.45, 1.9], [0.45, 2.3], [0.41, 2.55], [0.29, 2.82], [0.11, 2.97], [0, 2.97]];
const HK_CASE: [number, number][] = [[0, 0], [0.4, 0], [0.4, 0.08], [0.33, 0.12], [0.33, 0.18], [0.4, 0.22], [0.37, 2.2], [0.27, 2.42], [0.265, 3.05], [0, 3.05]];
const HK_BULLET: [number, number][] = [[0, 3], [0.232, 3], [0.232, 3.3], [0.19, 3.62], [0.1, 3.9], [0.02, 4.05], [0, 4.05]];
const Case: React.FC<{ kind?: "9" | "4.6" }> = ({ kind = "9" }) => <Spun pts={kind === "9" ? NINE_CASE : HK_CASE}><Brass /></Spun>;
const Bullet: React.FC<{ kind?: "9" | "4.6" }> = ({ kind = "9" }) => <Spun smooth pts={kind === "9" ? NINE_BULLET : HK_BULLET}><Copper /></Spun>;

// ---------- the MP5-family action, seen from above and cut open ----------
const RAIL: [number, number][] = [[0, 0.95], [-0.45, 0.95], [-0.62, 1.34], [-1.02, 1.34], [-1.36, 0.95], [-3.4, 0.95], [-3.4, 1.8], [0, 1.8]];
const Rail: React.FC<{ side: 1 | -1 }> = ({ side }) => {
  const g = useMemo(() => {
    const s = new THREE.Shape(RAIL.map(([x, z]) => new THREE.Vector2(x, z)));
    const e = new THREE.ExtrudeGeometry(s, { depth: 1.5, bevelEnabled: false });
    e.rotateX(Math.PI / 2);
    e.translate(0, 0.75, 0);
    return e;
  }, []);
  return <mesh geometry={g} scale={[1, 1, side]} castShadow receiveShadow><Steel c="#6a6e76" /></mesh>;
};
const Wedge: React.FC<{ c: string }> = ({ c }) => {
  const g = useMemo(() => {
    const pts: [number, number][] = [[-0.72, 0.13], [-1.28, 0.62], [-1.9, 0.62], [-1.9, -0.62], [-1.28, -0.62], [-0.72, -0.13]];
    const e = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z))), { depth: 0.8, bevelEnabled: false });
    e.rotateX(Math.PI / 2);
    e.translate(0, 0.4, 0);
    return e;
  }, []);
  return <mesh geometry={g} castShadow><Accent c={c} glow={0.1} /></mesh>;
};
const RollerAction: React.FC<{ head: number; carrier: number; roller: number; caseX: number; caseUp: number; bulletX: number; gas: number; gold: string; rollerGlow?: number; wall?: number }> = ({ head, carrier, roller, caseX, caseUp, bulletX, gas, gold, rollerGlow = 0.15, wall = -11 }) => (
  <group>
    <HalfTube outer={0.95} inner={0.52} len={9.5} roll={Math.PI}><Steel c="#4b4e54" /></HalfTube>
    <Rail side={1} /><Rail side={-1} />
    <Box from={[wall - 0.4, -0.8, -1.8]} to={[wall, 0.8, 1.8]}><Steel c="#33353a" /></Box>
    <Box from={[wall, -0.86, -1.8]} to={[-3.4, -0.75, 1.8]}><Steel c="#26282c" /></Box>
    <group position={[head, 0, 0]}>
      <Box from={[-1.6, -0.7, -0.92]} to={[0, 0.7, 0.92]}><Steel c="#7c8088" o={0.42} r={0.25} /></Box>
      {[1, -1].map((s) => (
        <mesh key={s} position={[-0.82, 0, roller * s]} castShadow><cylinderGeometry args={[0.3, 0.3, 1.05, 32]} /><Accent c={gold} glow={rollerGlow} /></mesh>
      ))}
    </group>
    <group position={[carrier, 0, 0]}>
      <Wedge c="#d8d3c5" />
      <Box from={[-5.2, -0.7, -0.92]} to={[-1.9, 0.7, 0.92]}><Steel c="#55585e" /></Box>
    </group>
    <Spring x0={carrier - 5.2} x1={wall} />
    <group position={[caseX, caseUp, 0]} rotation={[0, 0, caseUp * 0.9]}><Case /></group>
    <group position={[bulletX, 0, 0]}><Bullet /></group>
    <Gas x={bulletX + 1.75} s={0.42 + gas * 0.42} o={gas} sx={2.2} />
  </group>
);

// ---------- models ----------
const blowback = ({ f, at, p, gold, hot, len }: Ctx): Built => {
  const fire = p(1, 24);
  const back = p(2, 24);
  const ret = interpolate(f, [at[2] + 75, at[2] + 118], [0, 1], { ...clamp, easing: ease.inOut });
  const travel = Math.min(1, back) * (1 - ret);
  const bolt = -4.4 * travel;
  const eject = interpolate(f, [at[2] + 30, at[2] + 64], [0, 1], clamp);
  const bulletX = fire * 9;
  const heat = fire * (1 - interpolate(f, [at[2] + 18, at[2] + 50], [0, 1], clamp));
  const closeIn = p(0, 30);
  const wall = -10;
  return {
    pos: lerp3(lerp3([-5.5, 9, 9], [-3.2, 8.6, 11], closeIn), [-5, 9.6, 12.5], travel),
    target: lerp3(lerp3([-3, -0.2, 0], [-1.6, -0.2, 0], closeIn), [-4.2, -0.2, 0], travel),
    fov: 36,
    pins: [
      { at: [bolt - 2, 0.85, 0], text: "Bolt", o: p(0, 14) },
      { at: [(bolt - 4 + wall) / 2, 0.55, 0], text: "Spring", o: p(0, 14, 10) * (1 - back), dy: -0.03 },
    ],
    node: (
      <group>
        <HalfTube outer={0.95} inner={0.52} len={9.5} roll={Math.PI}><Steel c="#4b4e54" /></HalfTube>
        <Box from={[wall - 0.4, -0.95, -1.5]} to={[wall, 0.95, 1.5]}><Steel c="#33353a" /></Box>
        <Box from={[wall, -1.02, -1.5]} to={[0.05, -0.95, 1.5]}><Steel c="#26282c" /></Box>
        <group position={[bolt, 0, 0]}>
          <Box from={[-4, -0.85, -0.85]} to={[0, 0.85, 0.85]}><Steel c="#6b6f76" r={0.3} /></Box>
        </group>
        <Spring x0={bolt - 4} x1={wall} r={0.5} />
        <group position={[bolt * (1 - eject) + eject * -1, eject * 1.5, eject * 4.5]} rotation={[0, 0, eject * 3]}><group visible={eject < 0.8}><Case /></group></group>
        <group position={[bulletX, 0, 0]}><group visible={bulletX < 8.9}><Bullet /></group></group>
        <Gas x={bulletX * 0.65 + 1.6} s={0.45 + heat * 0.35} o={heat} sx={Math.max(1.6, bulletX * 0.5)} />
        <Arrow x={bolt - 4.4} y={1.45} o={interpolate(back, [0, 0.1, 0.8, 1], [0, 1, 1, 0], clamp)} c={hot} len={1.5} />
      </group>
    ),
  };
};

const roller = ({ f, at, p, gold, hot }: Ctx): Built => {
  const zoom = p(0, 34);
  const delay = interpolate(f, [at[1] + 6, at[2] + 8], [0, 1], { ...clamp, easing: ease.inOut });
  const run = p(3, 42);
  const open = run * 4.6;
  const head = -0.42 * delay - open;
  const carrier = -1.68 * delay - open; // the carrier runs about four times the head's speed
  const rollerZ = lerp(1.03, 0.63, delay);
  const fired = f >= at[1];
  const bulletX = interpolate(f, [at[1], at[1] + 90], [0, 7.5], clamp);
  const gas = (fired ? 1 : 0) * interpolate(f, [at[1], at[1] + 8], [0, 1], clamp) * (1 - p(3, 26) * 0.92);
  const pull = p(3, 40);
  const speedO = p(2, 12) * (1 - p(3, 12));
  return {
    pos: lerp3(lerp3([-4, 11.5, 8.5], [-1.2, 9, 4.8], zoom), [-3.4, 12.5, 8], pull),
    target: lerp3(lerp3([-3, 0, 0], [-0.9, 0, 0], zoom), [-3, 0, 0], pull),
    fov: 36,
    pins: [
      { at: [head - 0.82, 0.55, rollerZ], text: "Roller", o: p(0, 14) * (1 - p(2, 10)), dx: 0.09, dy: 0.05 },
      { at: [head - 0.82, 0.55, -rollerZ], text: "Roller", o: p(0, 14) * (1 - p(2, 10)), dx: 0.09, dy: -0.05 },
      { at: [head - 0.8, 0.8, 0], text: "Bolt head: slow", o: speedO, dy: -0.15 },
      { at: [carrier - 3.5, 0.8, 0], text: "Carrier: fast", o: speedO, dy: -0.1 },
    ],
    node: (
      <group>
        <RollerAction head={head} carrier={carrier} roller={rollerZ} caseX={head} caseUp={0} bulletX={bulletX} gas={gas} gold={gold} rollerGlow={0.18 + p(1, 14) * 0.3 * (1 - p(3, 20))} />
        <Arrow x={head - 0.8} y={1.2} z={-1.5} o={speedO} c={hot} len={0.6} />
        <Arrow x={carrier - 3.5} y={1.2} z={-1.5} o={speedO} c={hot} len={1.7} />
      </group>
    ),
  };
};

const closedBolt = ({ f, at, p, gold, hot, len }: Ctx): Built => {
  const close = interpolate(f, [0, Math.max(20, at[0] + 28)], [0, 1], { ...clamp, easing: ease.out });
  const lock = interpolate(close, [0.82, 1], [0, 1], clamp);
  const off = (1 - close) * 3.6;
  const carrier = -1.68 * (1 - lock) - off;
  const fire = p(1, 10);
  return {
    pos: lerp3([-5, 10, 7.5], [-1.2, 9, 4.8], close),
    target: [-0.9, 0, 0],
    fov: 36,
    pins: [{ at: [-0.82, 0.55, lerp(0.63, 1.03, lock)], text: "Locked", o: lock * (1 - fire), dx: 0.09, dy: 0.05 }],
    node: (
      <RollerAction head={-0.42 * (1 - lock) - off} carrier={carrier} roller={lerp(0.63, 1.03, lock)} caseX={-0.42 * (1 - lock) - off} caseUp={0} bulletX={fire * 3.6 + (-0.42 * (1 - lock) - off)} gas={fire * (1 - interpolate(f, [at[1] + 8, at[1] + 34], [0, 1], clamp))} gold={gold} rollerGlow={0.15 + lock * 0.5} />
    ),
  };
};

// The MP7-style action from the side: gas leaves the barrel, a short piston hits the
// carrier, the carrier turns the bolt and pulls it back. The open side faces the camera.
const GasAction: React.FC<{ piston: number; carrier: number; bolt: number; spin: number; gas: number; gasFlow: number; bulletX: number; pistonGlow: number; boltGlow: number; gold: string }> = ({ piston, carrier, bolt, spin, gas, gasFlow, bulletX, pistonGlow, boltGlow, gold }) => (
  <group>
    <HalfTube outer={0.62} inner={0.3} len={9.5} roll={-Math.PI / 2}><Steel c="#4b4e54" /></HalfTube>
    <HalfTube outer={0.44} inner={0.3} len={4.9} x={1} y={1.28} roll={-Math.PI / 2}><Steel c="#44474d" /></HalfTube>
    <Box from={[5.72, 0.55, -0.16]} to={[5.9, 1.2, 0.0]}><Steel c="#6a6e75" /></Box>
    <Gas x={5.8} y={0.88} s={0.24} sx={0.9} o={gasFlow} />
    <Gas x={5.1 + piston} y={1.28} s={0.34} sx={1.4} o={gasFlow} />
    <group position={[piston, 0, 0]}>
      <Rod x0={5.2} x1={4.9} r={0.28} y={1.28}><Accent c={gold} glow={0.1 + pistonGlow * 0.55} /></Rod>
      <Rod x0={4.9} x1={-0.12} r={0.14} y={1.28}><Accent c={gold} glow={0.05 + pistonGlow * 0.4} /></Rod>
    </group>
    <group position={[carrier, 0, 0]}>
      <Box from={[-5.4, 0.72, -0.72]} to={[-0.12, 1.75, 0.72]}><Steel c="#5b5f66" /></Box>
      <Box from={[-5.4, -0.72, -0.72]} to={[-1.6, 0.72, 0.72]}><Steel c="#4c4f55" /></Box>
    </group>
    <group position={[bolt, 0, 0]} rotation={[spin, 0, 0]}>
      <Rod x0={-1.6} x1={0} r={0.56}><Steel c="#8a8e95" r={0.26} /></Rod>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <group key={i} rotation={[(i * Math.PI) / 3, 0, 0]}>
          <Box from={[-0.42, 0.5, -0.16]} to={[-0.06, 0.74, 0.16]}><Accent c={gold} glow={0.12 + boltGlow * 0.6} /></Box>
        </group>
      ))}
    </group>
    <Spring x0={carrier - 5.4} x1={-11.2} r={0.46} />
    <Box from={[-11.5, -0.85, -1]} to={[-11.2, 1.8, 1]}><Steel c="#33353a" /></Box>
    <group position={[bolt, 0, 0]} scale={[1, 0.72, 0.72]}><group position={[0, 0, 0]}><Case kind="4.6" /></group></group>
    <group position={[bulletX, 0, 0]}><Bullet kind="4.6" /></group>
    <Gas x={Math.max(3.2, bulletX + 2.4)} s={0.3} sx={Math.max(1.6, bulletX * 0.4)} o={gas} />
  </group>
);

const gasIntro = ({ f, at, p, gold }: Ctx): Built => {
  const a = p(0, 30), b = p(1, 30);
  const spinT = interpolate(f, [at[1] + 8, at[1] + 34], [0, 1], { ...clamp, easing: ease.inOut });
  return {
    pos: lerp3(lerp3([-1, 3.4, 15], [3.2, 2.6, 8.4], a), [-1.2, 2.3, 6.5], b),
    target: lerp3(lerp3([-1, 0.5, 0], [2.6, 0.9, 0], a), [-0.8, 0.3, 0], b),
    fov: 32,
    pins: [
      { at: [2.2, 1.45, 0], text: "Short piston", o: a * (1 - b), dy: -0.1 },
      { at: [-0.25, 0.75, 0], text: "Rotating bolt", o: b, dy: -0.14, dx: 0.02 },
    ],
    node: <GasAction piston={0} carrier={-0.0} bolt={0} spin={spinT * (Math.PI / 6)} gas={0} gasFlow={0} bulletX={0} pistonGlow={a * (1 - b)} boltGlow={b} gold={gold} />,
  };
};

const gasCycle = ({ f, at, p, gold }: Ctx): Built => {
  const flow = p(0, 10) * (1 - p(2, 22));
  const bulletX = interpolate(f, [0, at[0] + 6], [2.2, 8.4], clamp);
  const stroke = interpolate(f, [at[1], at[1] + 12, at[1] + 34, at[1] + 50], [0, -1.05, -1.05, 0], { ...clamp, easing: ease.inOut });
  const free = interpolate(f, [at[1] + 3, at[1] + 14], [0, 1], clamp);
  const run = p(2, 24);
  const carrier = -1.05 * free - 3.9 * run;
  const spin = free * (Math.PI / 6);
  const bolt = -3.9 * run - 0.25 * free;
  return {
    pos: lerp3([2.2, 3.2, 12], [-1.8, 3.2, 13.5], p(2, 30)),
    target: lerp3([2.2, 0.7, 0], [-1.8, 0.5, 0], p(2, 30)),
    fov: 32,
    node: <GasAction piston={stroke} carrier={carrier} bolt={bolt} spin={spin} gas={flow * 0.5} gasFlow={flow} bulletX={bulletX} pistonGlow={p(1, 10) * (1 - p(2, 18))} boltGlow={free * (1 - run)} gold={gold} />,
  };
};

// Soft armor: a stack of thin fabric layers.
const Panel: React.FC<{ x: number; z?: number; dent?: number; hole?: number; gold: string }> = ({ x, z = 0, dent = 0, gold }) => (
  <group position={[x, 0, z]}>
    {[0, 1, 2, 3, 4, 5, 6].map((i) => (
      <mesh key={i} position={[i * 0.13, 0, 0]} scale={[1, 1, 1]} castShadow receiveShadow>
        <boxGeometry args={[0.09, 4.2, 2.6]} />
        <meshStandardMaterial color={i % 2 ? "#3f3a2e" : "#55503f"} roughness={0.92} metalness={0} />
      </mesh>
    ))}
    {dent > 0 ? (
      <mesh position={[-0.02, 0, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, dent * 0.35, 1]}>
        <cylinderGeometry args={[0.55 * dent + 0.1, 0.55 * dent + 0.1, 0.3, 30]} />
        <meshBasicMaterial color={gold} transparent opacity={0.28} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    ) : null}
  </group>
);

const armorStop = ({ f, at, gold, hot, p }: Ctx): Built => {
  const hit = at[0];
  const x = interpolate(f, [hit - 42, hit], [-12, -2.98], clamp);
  const after = f - hit;
  const dent = after > 0 ? spring({ frame: after, fps: 30, config: { damping: 11, stiffness: 150 } }) : 0;
  const flash = interpolate(after, [0, 2, 18], [0, 1, 0], clamp);
  return {
    pos: lerp3([-7, 3.6, 12], [-4, 2.6, 10.5], interpolate(f, [hit - 42, hit + 10], [0, 1], { ...clamp, easing: ease.inOut })),
    target: [-1.6, 0, 0],
    fov: 32,
    pins: [
      { at: [x + 2.4, 0.5, 0], text: "9 mm", o: interpolate(f, [hit - 34, hit - 26, hit + 6, hit + 18], [0, 1, 1, 0], clamp), dy: -0.08 },
    ],
    node: (
      <group>
        <group position={[x, 0, 0]}><Bullet /></group>
        <Panel x={0} dent={dent} gold={hot} />
        <Gas x={0} s={0.5} o={flash} c="#ffd27a" />
      </group>
    ),
  };
};

const Lane: React.FC<{ z: number; kind: "9" | "4.6"; x: number; panelX: number; dent: number; flash: number; hot: string; gold: string }> = ({ z, kind, x, panelX, dent, flash, hot, gold }) => (
  <group position={[0, z, 0]}>
    <group position={[x, 0, 0]}><Bullet kind={kind} /></group>
    <Panel x={panelX} dent={dent} gold={kind === "9" ? hot : gold} />
    <Gas x={panelX} s={0.42} o={flash} c="#ffd27a" />
  </group>
);

const armorCompare = ({ f, at, gold, hot, p }: Ctx): Built => {
  const hk = interpolate(f, [at[0] + 4, at[0] + 34], [-9, 2.2], clamp);
  const hkFlash = interpolate(f, [at[0] + 22, at[0] + 24, at[0] + 40], [0, 1, 0], clamp);
  const hitAt = at[1] + 18;
  const nine = interpolate(f, [at[1] - 8, hitAt], [-9, -2.98], clamp);
  const after = f - hitAt;
  const dent = after > 0 ? spring({ frame: after, fps: 30, config: { damping: 11, stiffness: 150 } }) : 0;
  return {
    pos: [-5.5, 2.4, 21],
    target: [-1.6, -0.2, 0],
    fov: 32,
    pins: [
      { at: [-0.05, 4.2, 0], text: "4.6 mm", o: p(0, 14), dy: -0.05 },
      { at: [-0.05, -0.8, 0], text: "9 mm", o: interpolate(f, [at[1] - 12, at[1]], [0, 1], clamp), dy: -0.05 },
    ],
    node: (
      <group>
        <Lane z={2.45} kind="4.6" x={hk} panelX={0} dent={hkFlash} flash={hkFlash} hot={hot} gold={gold} />
        <Lane z={-2.45} kind="9" x={nine} panelX={0} dent={dent} flash={interpolate(after, [0, 2, 18], [0, 1, 0], clamp)} hot={hot} gold={gold} />
      </group>
    ),
  };
};

const energy = ({ f, at, gold, hot, p }: Ctx): Built => {
  const hit = Math.max(at[0] + 10, 16);
  const adv = interpolate(f, [0, hit], [0, 1], { ...clamp, easing: ease.in });
  const ring = interpolate(f, [hit, hit + 16], [0, 1], { ...clamp, easing: ease.out });
  const y9 = lerp(-5, -2.98, adv), yHk = lerp(-5, -4.05, adv);
  return {
    pos: [-5.5, 1.6, 13],
    target: [-1.6, -0.2, 0],
    fov: 32,
    pins: [
      { at: [y9 + 2.4, 1.85, 0], text: "9 mm", o: p(0, 10), dy: -0.05 },
      { at: [yHk + 3.5, -1.05, 0], text: "4.6 mm", o: p(0, 10), dy: -0.05 },
    ],
    node: (
      <group>
        <group position={[y9, 1.4, 0]}><Bullet /></group>
        <group position={[yHk, -1.4, 0]}><Bullet kind="4.6" /></group>
        <Box from={[0, -3, -2.2]} to={[0.32, 3, 2.2]}><Steel c="#47494d" r={0.55} /></Box>
        {[{ z: 1.4, r: 0.45, a: 0.45 }, { z: -1.4, r: 0.1, a: 1 }].map((d) => (
          <mesh key={d.z} position={[-0.012, d.z, 0]} rotation={[0, Math.PI / 2, 0]} scale={ring}>
            <circleGeometry args={[d.r, 40]} />
            <meshBasicMaterial color={d.r < 0.2 ? hot : gold} transparent opacity={d.a * ring} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        ))}
        <Gas x={-0.05} y={-1.4} s={0.3} o={ring * 0.8} c="#ffcf75" />
      </group>
    ),
  };
};

// A compact PDW silhouette: drawn generically, not a measured drawing of any product.
const extrude = (pts: [number, number][], depth: number) => {
  const e = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 });
  e.translate(0, 0, -depth / 2);
  return e;
};
const Pdw: React.FC = () => {
  const body = useMemo(() => extrude([[-4.8, 0.9], [3.2, 0.9], [3.7, 0.5], [3.7, 0], [2.9, -0.32], [0.7, -0.32], [0.5, -0.95], [-0.72, -0.95], [-1.1, -0.32], [-4.8, -0.32], [-5.1, 0.25]], 1.0), []);
  const grip = useMemo(() => extrude([[-0.7, -0.75], [0.48, -0.75], [0.14, -2.3], [0.2, -3.75], [-0.98, -3.75], [-1.08, -2.3]], 0.86), []);
  const fore = useMemo(() => extrude([[1.25, -0.28], [3.1, -0.28], [2.95, -0.72], [1.45, -0.72]], 0.72), []);
  return (
    <group>
      <mesh geometry={body} castShadow><Polymer /></mesh>
      <mesh geometry={grip} castShadow><Polymer c="#2f3236" /></mesh>
      <mesh geometry={fore} castShadow><Polymer c="#44474d" /></mesh>
      <Box from={[-3.9, 0.92, -0.27]} to={[3, 1.1, 0.27]}><Steel c="#2f3136" /></Box>
      {Array.from({ length: 17 }, (_, i) => <Box key={i} from={[-3.8 + i * 0.41, 1.1, -0.27]} to={[-3.6 + i * 0.41, 1.2, 0.27]}><Steel c="#3a3c42" /></Box>)}
      <Rod x0={3.7} x1={5.05} r={0.2} y={0.32}><Steel c="#55585e" /></Rod>
      <Rod x0={4.75} x1={5.15} r={0.28} y={0.32}><Steel c="#3e4046" /></Rod>
      <Rod x0={-6.1} x1={-5} r={0.09} y={0.62} z={0.33}><Steel c="#66696f" /></Rod>
      <Rod x0={-6.1} x1={-5} r={0.09} y={0.62} z={-0.33}><Steel c="#66696f" /></Rod>
      <Box from={[-6.2, -0.45, -0.5]} to={[-6.02, 0.95, 0.5]}><Polymer /></Box>
      <mesh position={[0.92, -0.72, 0]} rotation={[0, 0, 0.1]} castShadow><torusGeometry args={[0.36, 0.05, 10, 30, Math.PI]} /><Polymer /></mesh>
    </group>
  );
};
const size = ({ f, at, p, gold, hot, len }: Ctx): Built => {
  const r = interpolate(f, [0, len], [-0.42, 0.28]);
  const grow = p(1, 36);
  const x0 = -6.2, x1 = 5.15, y = -4.45;
  const mx = lerp((x0 + x1) / 2, x1, grow), mn = lerp((x0 + x1) / 2, x0, grow);
  return {
    pos: [0, 0.6, 18],
    target: [-0.5, -1.9, 0],
    fov: 32,
    pins: [{ at: [(x0 + x1) / 2, y, 0], text: "About a foot and a half", o: grow, dy: -0.012, dx: 0 }, { at: [2.5, 1, 0], text: "About 2 kg", o: p(0, 14), dy: -0.08 }],
    node: (
      <group>
        <group rotation={[0.04, r * (1 - grow * 0.85), 0]}><Pdw /></group>
        {grow > 0.01 ? (
          <group>
            <mesh position={[(mn + mx) / 2, y, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.035, 0.035, mx - mn, 8]} /><meshBasicMaterial color={gold} toneMapped={false} /></mesh>
            {[mn, mx].map((x) => <mesh key={x} position={[x, y, 0]}><cylinderGeometry args={[0.035, 0.035, 0.42, 8]} /><meshBasicMaterial color={gold} toneMapped={false} /></mesh>)}
          </group>
        ) : null}
      </group>
    ),
  };
};

const Mag: React.FC<{ h: number; rise: number; x: number; glow: number; gold: string }> = ({ h, rise, x, glow, gold }) => {
  const g = useMemo(() => {
    const curve = 0.14;
    const e = new THREE.ExtrudeGeometry(new THREE.Shape([[0, 0], [0.92, 0], [0.92 + curve, -h], [curve, -h]].map(([a, b]) => new THREE.Vector2(a, b))), { depth: 0.46, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
    e.translate(-0.46, h, -0.23);
    return e;
  }, [h]);
  const reveal = rise;
  return (
    <group position={[x, lerp(-h - 1, -2, reveal), 0]} rotation={[0, -0.32, 0]} visible={reveal > 0.001}>
      <mesh geometry={g} castShadow receiveShadow><Polymer c="#3f4247" /></mesh>
      {/* The stack of rounds shows through a cut in the side. */}
      <Box from={[-0.05 + 0.02, h - 0.1, 0.235]} to={[0.1, 0.25, 0.29]}><Accent c={gold} glow={0.05 + glow * 0.45} /></Box>
    </group>
  );
};
const magazines = ({ p, gold }: Ctx): Built => {
  const heights = [2.6, 3.8, 5];
  const xs = [-2.6, 0, 2.6];
  return {
    pos: [0, 2.2, 17],
    target: [0, 0.2, 0],
    fov: 30,
    pins: heights.map((h, i) => ({ at: [xs[i] + 0.25, h - 1.9, 0.2] as V3, text: `${[20, 30, 40][i]} rounds`, o: p(i, 14, 4), dy: -0.05 })),
    node: <group>{heights.map((h, i) => <Mag key={i} h={h} x={xs[i]} rise={p(i, 22)} glow={p(i, 16)} gold={gold} />)}</group>,
  };
};

const cartridges = ({ f, len, p, gold }: Ctx): Built => {
  const spin = interpolate(f, [0, len], [0, Math.PI * 1.15]);
  const at9 = p(0, 22), atHk = p(1, 22);
  return {
    pos: [0.15, 1.2, 15],
    target: [0.15, -0.3, 0],
    fov: 30,
    pins: [
      { at: [-1.5, 1.3, 0], text: "9 × 19 mm", o: at9, dy: -0.05 },
      { at: [1.8, 2.48, 0], text: "4.6 × 30 mm", o: atHk, dy: -0.04 },
    ],
    node: (
      <group>
        <group position={[-1.5, -2, 0]} rotation={[0, spin, Math.PI / 2]} scale={lerp(0.001, 1.1, at9)}><Case /><Bullet /></group>
        <group position={[1.8, -2, 0]} rotation={[0, spin, Math.PI / 2]} scale={lerp(0.001, 1.1, atHk)}><Case kind="4.6" /><Bullet kind="4.6" /></group>
      </group>
    ),
  };
};

// Inches, drawn to the ruler; the barrel grows to where the voice says it ends.
const barrel = ({ f, at, p, gold, len }: Ctx): Built => {
  const grow = interpolate(f, [0, Math.max(30, at[0])], [0, 1], { ...clamp, easing: ease.inOut });
  const inches = grow * 10.3;
  const unit = 1;
  const x0 = -5.4;
  return {
    pos: lerp3([-2, 4, 14], [0.4, 3, 13.5], grow),
    target: [0.4, -0.3, 0],
    fov: 32,
    pins: [
      { at: [x0 + inches, 0.45, 0], text: "Just over 10 in", o: p(0, 14), dy: -0.08 },
      ...[0, 5, 10].map((n) => ({ at: [x0 + n, -1.42, 0.4] as V3, text: String(n), o: 1, dy: 0.012 })),
    ],
    node: (
      <group>
        <group position={[x0, 0, 0]}>
          <group scale={[Math.max(0.001, inches), 1, 1]}><Rod x0={0} x1={1} r={0.2}><Steel c="#4b4e54" /></Rod></group>
          <Rod x0={0} x1={0.04} r={0.32}><Steel c="#34363a" /></Rod>
          <group position={[inches, 0, 0]}><Rod x0={-0.1} x1={0.28} r={0.26}><Steel c="#2e3034" /></Rod></group>
        </group>
        <group position={[x0, -1.1, 0]}>
          <Box from={[-0.25, -0.45, -0.4]} to={[12.3, -0.31, 0.4]}><meshStandardMaterial color="#c8bfa9" metalness={0.15} roughness={0.5} /></Box>
          {Array.from({ length: 13 }, (_, i) => <Box key={i} from={[i * unit - 0.018, -0.31, -0.4]} to={[i * unit + 0.018, -0.3, i % 2 ? -0.1 : 0.05]}><meshBasicMaterial color="#1a1712" /></Box>)}
        </group>
      </group>
    ),
  };
};

const MODELS: Record<Model3DSpec["model"], (c: Ctx) => Built> = {
  blowback, roller, closedBolt, gasIntro, gasCycle, armorStop, armorCompare, energy, size, magazines, cartridges, barrel,
};
export const MODEL3D_NAMES = Object.keys(MODELS);

// ---------- staging ----------
const Rig: React.FC<{ pos: V3; target: V3; fov: number }> = ({ pos, target, fov }) => {
  const { camera, gl, scene } = useThree();
  useLayoutEffect(() => {
    camera.position.set(...pos);
    camera.lookAt(...target);
    (camera as THREE.PerspectiveCamera).fov = fov;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }, [camera, pos, target, fov]);
  useLayoutEffect(() => {
    const gen = new THREE.PMREMGenerator(gl);
    const env = gen.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 1.05;
    return () => { scene.environment = null; env.dispose(); gen.dispose(); };
  }, [gl, scene]);
  return null;
};

export const Model3D: React.FC<{ g: Model3DSpec; style: Style; durationInFrames: number }> = ({ g, style, durationInFrames: len }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const unit = Math.min(width, height);
  const at = g.at ?? g.items.map((_, i) => Math.round(((i + 0.2) * len) / Math.max(1, g.items.length)));
  const ctx: Ctx = {
    f: frame, len, at, gold: style.colors.primary, hot: style.colors.accent,
    p: (i, dur = 20, delay = 0) => interpolate(frame, [(at[i] ?? len) + delay, (at[i] ?? len) + delay + dur], [0, 1], { ...clamp, easing: ease.inOut }),
  };
  const built = MODELS[g.model](ctx);
  const fov = built.fov ?? 32;

  // Pins are drawn in HTML, so the type stays crisp: project their 3D points to the screen.
  const camera = useMemo(() => new THREE.PerspectiveCamera(fov, width / height, 0.1, 200), [fov, width, height]);
  camera.position.set(...built.pos);
  camera.lookAt(...built.target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const project = (v: V3) => {
    const s = new THREE.Vector3(...v).project(camera);
    return { x: ((s.x + 1) / 2) * width, y: ((1 - s.y) / 2) * height };
  };

  const current = g.items.reduce((c, _, i) => (frame >= at[i] ? i : c), -1);
  const enter = current >= 0 ? spring({ frame: frame - at[current], fps, config: springs.smooth }) : 0;
  const exit = interpolate(frame, [len - 6, len], [1, 0], clamp);
  const titleIn = spring({ frame, fps, config: springs.smooth });

  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 42%, ${style.colors.bgAlt}, ${style.colors.bg} 78%)` }}>
      <ThreeCanvas width={width} height={height} shadows gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }} camera={{ fov, position: built.pos, near: 0.1, far: 200 }} style={{ position: "absolute", inset: 0 }}>
        <Rig pos={built.pos} target={built.target} fov={fov} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 11, 7]} intensity={3.2} color="#fff4e2" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-16} shadow-camera-right={16} shadow-camera-top={12} shadow-camera-bottom={-12} shadow-camera-far={40} shadow-bias={-0.0006} />
        <directionalLight position={[-8, 4, -6]} intensity={1.6} color={style.colors.primary} />
        <mesh position={[0, -5, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[120, 120]} /><shadowMaterial opacity={0.42} /></mesh>
        {built.node}
      </ThreeCanvas>

      {g.title ? (
        <div style={{ position: "absolute", top: height * 0.075, width: "100%", textAlign: "center", fontFamily: style.fonts.emphasis, fontWeight: 600, fontSize: unit * 0.046, color: style.colors.text, opacity: titleIn }}>{g.title}</div>
      ) : null}

      {(built.pins ?? []).map((pin, i) => {
        if (pin.o <= 0.01) return null;
        const a = project(pin.at);
        const x = a.x + (pin.dx ?? 0) * height, y = a.y + (pin.dy ?? -0.07) * height;
        return (
          <React.Fragment key={i}>
            <svg style={{ position: "absolute", inset: 0, opacity: pin.o, overflow: "visible" }} width={width} height={height}>
              <line x1={a.x} y1={a.y} x2={x} y2={y} stroke={style.colors.primary} strokeWidth={2} />
              <circle cx={a.x} cy={a.y} r={4.5} fill={style.colors.primary} />
            </svg>
            <div style={{
              position: "absolute", left: x, top: y, transform: `translate(-50%, ${y < a.y ? "-112%" : "12%"})`, opacity: pin.o, whiteSpace: "nowrap",
              fontFamily: style.fonts.caption, fontWeight: 600, fontSize: unit * 0.027, color: style.colors.text, textShadow: "0 2px 12px rgba(0,0,0,0.9)",
            }}>{pin.text}</div>
          </React.Fragment>
        );
      })}

      {current >= 0 && text(g.items[current]) ? (
        <div style={{
          position: "absolute", left: "10%", width: "80%", bottom: height * 0.075, textAlign: "center", opacity: enter * exit,
          transform: `translateY(${interpolate(enter, [0, 1], [unit * 0.018, 0])}px)`,
          fontFamily: style.fonts.emphasis, fontWeight: 600, fontSize: unit * 0.046, lineHeight: 1.15, color: style.colors.text, textShadow: "0 2px 18px rgba(0,0,0,0.85)",
        }}>{text(g.items[current])}</div>
      ) : null}
    </AbsoluteFill>
  );
};
