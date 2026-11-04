// A 3D airliner (WebGL) for explaining what happened to the aircraft, filmed like an
// air-to-air shot: flying over a sea of clouds under a real sky (day, dusk or night), lit by
// the sun and the sky it reflects, nav lights and strobes on, engines spinning. Parts named in
// "highlight" glow (emissive + a fresnel shell); "labels" point at parts from 2D (sharp text).
// view "top": high three-quarter view from above that can bank (roll); view "side": level with
// the aircraft, pitching against the real horizon. light "studio": the old dark product look.
// A neutral paint scheme (grey cheatline, charcoal tail, no logo) so it never suggests an
// airline that was not involved.
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import { useEffect, useMemo } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { clamp, ease, type Style } from "../theme";
import type { GraphicSpec } from "../types";

type Spec = Extract<GraphicSpec, { type: "aircraft" }>;
const ALIAS: Record<string, string> = { "left-engine": "engine-left", "right-engine": "engine-right", "left-wing": "wing-left", "right-wing": "wing-right",
  "landing-gear": "gear", stabilizer: "tail", "horizontal-stabilizer": "tail", "vertical-stabilizer": "fin", rudder: "fin", nose: "cockpit", "door-plug": "door",
  engine: "engine-left", wing: "wing-left" };
const norm = (n: string) => { const k = n.toLowerCase().replace(/\s+/g, "-"); return ALIAS[k] ?? k; };

// ---------- the model (nose +X, up +Y, right wing +Z) ----------
type Model = { root: THREE.Group; parts: Record<string, THREE.Object3D>; anchors: Record<string, THREE.Vector3>; fans: THREE.Object3D[];
  lights: { glow: THREE.Sprite; kind: "steady" | "strobe" | "beacon" }[] };
let glowTex: THREE.Texture | null = null;
function glowTexture() {
  // soft round light for lamps (made once, in code)
  if (glowTex) return glowTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const x = c.getContext("2d")!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.2, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
function lathe(profile: [number, number][], segs = 48) {
  // profile: [axial position, radius]; built around Y, then turned so the axis is X
  const g = new THREE.LatheGeometry(profile.map(([y, r]) => new THREE.Vector2(r, y)), segs);
  g.rotateZ(-Math.PI / 2);
  return g;
}
function plate(outline: [number, number][], thick: number) {
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.45, bevelSize: thick * 0.45, bevelSegments: 4, curveSegments: 8 });
  g.translate(0, 0, -thick / 2);
  g.computeVertexNormals();
  return g;
}
function buildModel(): Model {
  const white = new THREE.MeshPhysicalMaterial({ color: "#f1f2f4", roughness: 0.36, metalness: 0.04, clearcoat: 0.65, clearcoatRoughness: 0.2 });
  const belly = new THREE.MeshPhysicalMaterial({ color: "#c5cad2", roughness: 0.42, metalness: 0.12, clearcoat: 0.4 });
  const metal = new THREE.MeshPhysicalMaterial({ color: "#a7adb8", roughness: 0.28, metalness: 0.85 });
  const wingPaint = new THREE.MeshPhysicalMaterial({ color: "#cfd3d9", roughness: 0.42, metalness: 0.3, clearcoat: 0.3 });
  const tailPaint = new THREE.MeshPhysicalMaterial({ color: "#2b323d", roughness: 0.34, metalness: 0.1, clearcoat: 0.7, clearcoatRoughness: 0.15 });
  // fuselage paint, drawn per pixel from the body's own coordinates (crisp at any size):
  // grey belly, a thin grey cheatline under the windows, the charcoal tail sweeping up,
  // and faint panel seams
  const body = white.clone();
  body.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vObj;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vObj;").replace("#include <color_fragment>", `#include <color_fragment>
      float x = vObj.x;
      float cy = (x < -1.1 ? 0.13 * pow((-1.1 - x) / 0.8, 1.7) : 0.0) - (x > 1.45 ? 0.035 * (x - 1.45) / 0.47 : 0.0);
      float y = vObj.y - cy;
      float aa = max(fwidth(y), 0.0015) * 1.2;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.59, 0.64), smoothstep(-0.07 + aa, -0.07 - aa, y));
      float band = smoothstep(0.009 + aa, 0.009 - aa, abs(y - 0.012)) * smoothstep(-1.45, -1.3, x) * smoothstep(1.62, 1.5, x);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.46, 0.52), band);
      float tail = smoothstep(-1.02 - 0.55 * y + aa, -1.02 - 0.55 * y - aa, x) * smoothstep(-0.02, 0.02, y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.032, 0.045), tail);
      float ax = max(fwidth(x), 0.0015);
      float seam = 1.0 - smoothstep(0.0, ax * 1.5, abs(fract(x * 2.6 + 0.5) - 0.5) / 2.6);
      diffuseColor.rgb *= 1.0 - 0.07 * seam * smoothstep(-1.5, -1.2, x) * smoothstep(1.4, 1.2, x);`);
  };
  const darkMetal = new THREE.MeshPhysicalMaterial({ color: "#2a2f38", roughness: 0.35, metalness: 0.9 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#0b1018", roughness: 0.05, metalness: 0.2, clearcoat: 1 });
  const root = new THREE.Group();
  const parts: Record<string, THREE.Object3D> = {};
  const add = (name: string, obj: THREE.Object3D) => { obj.castShadow = true; obj.traverse((o) => { o.castShadow = true; o.receiveShadow = true; }); parts[name] = obj; root.add(obj); };

  // fuselage: tail cone, barrel, nose; the tail sweeps up
  const prof: [number, number][] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push([-1.9 + t * 0.72, 0.02 + 0.17 * Math.sin((t * Math.PI) / 2)]); }
  prof.push([1.32, 0.19]);
  for (let i = 1; i <= 14; i++) { const t = i / 14; prof.push([1.32 + t * 0.6, 0.19 * Math.sqrt(Math.max(0, 1 - t * t)) + 0.002]); }
  const fus = lathe(prof, 64);
  const pos = fus.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x < -1.1) pos.setY(i, pos.getY(i) + 0.13 * Math.pow((-1.1 - x) / 0.8, 1.7));
    if (x > 1.45) pos.setY(i, pos.getY(i) - 0.035 * ((x - 1.45) / 0.47)); // nose droops slightly
  }
  fus.computeVertexNormals();
  const fuselage = new THREE.Group();
  fuselage.add(new THREE.Mesh(fus, body));
  // belly fairing
  const bellyM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), belly);
  bellyM.scale.set(4.2, 0.6, 1.05); bellyM.position.set(0.05, -0.02, 0);
  fuselage.add(bellyM);
  // cabin windows (both sides)
  const win = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.011, 0.012, 4, 8), glass, 64);
  const m = new THREE.Matrix4();
  let n = 0;
  for (const side of [1, -1]) for (let i = 0; i < 32; i++) {
    m.makeTranslation(-0.95 + i * 0.066, 0.055, side * 0.187);
    win.setMatrixAt(n++, m);
  }
  fuselage.add(win);
  add("fuselage", fuselage);

  // cockpit windscreen
  const cockpit = new THREE.Group();
  const screen = new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 16, -0.55, 1.1, Math.PI * 0.3, Math.PI * 0.18), glass);
  screen.rotation.z = -Math.PI / 2; screen.position.set(1.47, 0.0, 0); screen.scale.set(1.0, 1.02, 1.02);
  cockpit.add(screen);
  add("cockpit", cockpit);

  // door (forward left)
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.006), new THREE.MeshPhysicalMaterial({ color: "#dfe3e8", roughness: 0.4, clearcoat: 0.6 }));
  door.position.set(1.12, 0.02, -0.188);
  add("door", door);

  // wings (swept, dihedral), with winglets
  const wingOutline: [number, number][] = [[0.36, 0.16], [-0.48, 0.16], [-0.74, 1.72], [-0.52, 1.74]];
  for (const side of [1, -1]) {
    const g = plate(wingOutline.map(([x, s]) => [x, s * side] as [number, number]), 0.035);
    g.rotateX(Math.PI / 2);
    const w = new THREE.Group();
    const wm = new THREE.Mesh(g, wingPaint);
    w.add(wm);
    const tip = new THREE.Mesh(plate([[0, 0], [-0.16, 0], [-0.22, 0.2], [-0.12, 0.2]], 0.02), tailPaint);
    tip.position.set(-0.52, 0, 1.73 * side); tip.rotation.x = side > 0 ? 0.25 : -0.25;
    w.add(tip);
    w.position.set(0, -0.09, 0);
    w.rotation.x = side * -0.08; // dihedral
    add(side > 0 ? "wing-right" : "wing-left", w);
  }

  // engines under the wings
  const fans: THREE.Object3D[] = [];
  for (const side of [1, -1]) {
    const e = new THREE.Group();
    const nac = new THREE.Mesh(lathe([[-0.34, 0.07], [-0.26, 0.105], [0.0, 0.125], [0.2, 0.128], [0.27, 0.12], [0.285, 0.105]], 40), white);
    e.add(nac);
    const core = new THREE.Mesh(lathe([[-0.44, 0.025], [-0.36, 0.06], [-0.3, 0.075]], 32), metal);
    e.add(core);
    const fan = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.1, 32), darkMetal); disc.rotation.y = Math.PI / 2; disc.position.x = 0.26;
    fan.add(disc);
    for (let b = 0; b < 18; b++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.085, 0.018), metal);
      blade.position.set(0.262, 0.05 * Math.cos((b / 18) * Math.PI * 2), 0.05 * Math.sin((b / 18) * Math.PI * 2));
      blade.rotation.x = (b / 18) * Math.PI * 2; blade.rotation.y = 0.5;
      fan.add(blade);
    }
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.013, 12, 48), metal); lip.rotation.y = Math.PI / 2; lip.position.x = 0.282;
    e.add(lip);
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 32, 1, true), new THREE.MeshStandardMaterial({ color: "#14171c", roughness: 0.7, side: THREE.BackSide }));
    duct.rotation.z = Math.PI / 2; duct.position.x = 0.25;
    e.add(duct);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 24), metal); spinner.rotation.z = -Math.PI / 2; spinner.position.x = 0.29;
    fan.add(spinner);
    e.add(fan); fans.push(fan);
    const pylon = new THREE.Mesh(plate([[0.15, 0], [-0.3, 0], [-0.36, 0.12], [0.02, 0.12]], 0.025), white);
    pylon.position.set(0, 0.06, 0);
    e.add(pylon);
    e.position.set(0.12, -0.23, 0.6 * side);
    add(side > 0 ? "engine-right" : "engine-left", e);
  }

  // tail: horizontal stabilizers and fin
  const tail = new THREE.Group();
  for (const side of [1, -1]) {
    const g = plate([[-1.42, 0.06], [-1.72, 0.06], [-1.93, 0.72], [-1.8, 0.73]].map(([x, s]) => [x, s * side] as [number, number]), 0.025);
    g.rotateX(Math.PI / 2);
    const h = new THREE.Mesh(g, wingPaint); h.position.y = 0.1; h.rotation.x = side * -0.1;
    tail.add(h);
  }
  add("tail", tail);
  const fin = new THREE.Mesh(plate([[-1.15, 0.12], [-1.86, 0.12], [-2.02, 0.98], [-1.72, 0.98]], 0.03), tailPaint);
  add("fin", fin);

  // landing gear (shown when highlighted)
  const gear = new THREE.Group();
  const tire = new THREE.MeshPhysicalMaterial({ color: "#15171b", roughness: 0.8 });
  for (const [x, z] of [[1.15, 0], [-0.1, 0.22], [-0.1, -0.22]] as [number, number][]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 12), metal); strut.position.set(x, -0.3, z);
    const w1 = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 24), tire); w1.rotation.x = Math.PI / 2; w1.position.set(x, -0.43, z + 0.03);
    const w2 = w1.clone(); w2.position.z = z - 0.03;
    gear.add(strut, w1, w2);
  }
  gear.visible = false;
  add("gear", gear);

  // navigation lights: red left tip, green right tip, white tail; strobes and a red beacon flash
  const lights: Model["lights"] = [];
  const lamp = (color: string, at: [number, number, number], kind: "steady" | "strobe" | "beacon") => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    m.position.set(...at);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
    glow.scale.setScalar(0.32);
    m.add(glow);
    root.add(m);
    lights.push({ glow, kind });
  };
  lamp("#ff3b30", [-0.58, -0.02, -1.79], "steady");
  lamp("#34ff7a", [-0.58, -0.02, 1.79], "steady");
  lamp("#ffffff", [-2.02, 0.1, 0], "steady");
  lamp("#ffffff", [-0.62, -0.02, -1.77], "strobe");
  lamp("#ffffff", [-0.62, -0.02, 1.77], "strobe");
  lamp("#ff2a1a", [0.3, 0.205, 0], "beacon");
  lamp("#ff2a1a", [0.1, -0.215, 0], "beacon");

  const anchors: Record<string, THREE.Vector3> = {
    fuselage: new THREE.Vector3(0.2, 0.19, 0), cockpit: new THREE.Vector3(1.55, 0.08, 0), door: new THREE.Vector3(1.12, 0.02, -0.19),
    "wing-left": new THREE.Vector3(-0.55, -0.06, -1.2), "wing-right": new THREE.Vector3(-0.55, -0.06, 1.2),
    "engine-left": new THREE.Vector3(0.12, -0.23, -0.6), "engine-right": new THREE.Vector3(0.12, -0.23, 0.6),
    tail: new THREE.Vector3(-1.75, 0.1, 0.45), fin: new THREE.Vector3(-1.8, 0.75, 0), gear: new THREE.Vector3(-0.1, -0.43, -0.22),
  };
  return { root, parts, anchors, fans, lights };
}

// ---------- sky, cloud sea, light ----------
type Light = "day" | "dusk" | "night" | "studio";
type Sky = { zenith: string; horizon: string; below: string; lit: string; shade: string; gap: string; sunColor: string; sunI: number; hemi: [string, string, number]; exposure: number; stars: number };
const SKIES: Record<Exclude<Light, "studio">, Sky> = {
  day: { zenith: "#2a62b8", horizon: "#c6d9ee", below: "#dfe7f1", lit: "#ffffff", shade: "#93a2b8", gap: "#3d5a7a", sunColor: "#fff3df", sunI: 3.2, hemi: ["#bcd4f5", "#e9eef5", 1.1], exposure: 0.95, stars: 0 },
  dusk: { zenith: "#1b2547", horizon: "#f2a066", below: "#c98a6e", lit: "#ffd0a6", shade: "#5b5674", gap: "#262a42", sunColor: "#ffb070", sunI: 2.6, hemi: ["#6f7bb0", "#d99878", 0.9], exposure: 1.0, stars: 0 },
  night: { zenith: "#03060d", horizon: "#16233b", below: "#121b2c", lit: "#6d7d9e", shade: "#1a2335", gap: "#070b14", sunColor: "#a9bfff", sunI: 0.9, hemi: ["#26365a", "#1b2438", 0.55], exposure: 1.15, stars: 1 },
};
// colours go to the shaders as display values (no colour management in these shaders)
const v3 = (hex: string) => { const n = parseInt(hex.slice(1), 16); return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
const skyVert = `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const skyFrag = `
  uniform vec3 zenith, horizon, below, sunDir, sunColor; uniform float stars;
  varying vec3 vDir;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.42));
    col = mix(col, below, smoothstep(0.0, -0.06, d.y));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 1400.0) * 5.0 + pow(s, 60.0) * 0.35 + pow(s, 6.0) * 0.14) * step(-0.02, d.y);
    if (stars > 0.0 && d.y > 0.02) {
      vec2 g = d.xz / (d.y + 1.0) * 260.0;
      float h = h21(floor(g));
      float r = length(fract(g) - 0.5);
      col += vec3(0.85, 0.9, 1.0) * step(0.985, h) * smoothstep(0.22, 0.0, r) * (0.4 + 0.6 * fract(h * 91.0)) * smoothstep(0.02, 0.2, d.y);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;
const deckVert = `varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const deckFrag = `
  uniform vec3 lit, shade, gap, haze, cam; uniform vec2 sun2; uniform float time, fogNear, fogFar, scale, cover;
  varying vec3 vWorld;
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }
  void main() {
    vec2 p = vWorld.xz * scale + vec2(time, 0.0);
    vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
    vec2 w = p + 0.9 * q;
    float d = fbm(w);
    float toward = fbm(w + sun2 * 0.06);
    float cov = smoothstep(0.5 - cover, 0.76 - cover, d);
    float light = clamp(0.62 + (d - toward) * 7.0, 0.0, 1.0) * (0.75 + 0.25 * smoothstep(0.45, 0.8, d));
    vec3 col = mix(gap, mix(shade, lit, light), cov);
    float dist = length(vWorld.xz - cam.xz);
    col = mix(col, haze, smoothstep(fogNear, fogFar, dist));
    gl_FragColor = vec4(col, 1.0);
  }`;
const DECK_Y = -6;

const Environment: React.FC<{ light: Light; sun: THREE.Vector3; cam: THREE.Vector3; t: number; top: boolean }> = ({ light, sun, cam, t, top }) => {
  const { gl, scene } = useThree();
  const sky = light === "studio" ? null : SKIES[light];
  const mats = useMemo(() => {
    if (!sky) return null;
    const skyMat = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
      uniforms: { zenith: { value: v3(sky.zenith) }, horizon: { value: v3(sky.horizon) }, below: { value: v3(sky.below) }, sunDir: { value: sun.clone() }, sunColor: { value: v3(sky.sunColor) }, stars: { value: sky.stars } } });
    const sun2 = new THREE.Vector2(sun.x, sun.z).normalize();
    const deckMat = new THREE.ShaderMaterial({ vertexShader: deckVert, fragmentShader: deckFrag,
      uniforms: { lit: { value: v3(sky.lit) }, shade: { value: v3(sky.shade) }, gap: { value: v3(sky.gap) }, haze: { value: v3(sky.below) }, cam: { value: new THREE.Vector3() },
        sun2: { value: sun2 }, time: { value: 0 }, fogNear: { value: 40 }, fogFar: { value: 170 }, scale: { value: 0.06 }, cover: { value: 0.1 } } });
    return { skyMat, deckMat };
  }, [sky, sun]);
  // the scene reflects its own sky: an environment map made from the same sky (or a studio room)
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    let tex: THREE.Texture;
    if (mats) {
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), mats.skyMat));
      tex = pmrem.fromScene(envScene, 0.02, 0.1, 200).texture;
    } else tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return tex;
  }, [gl, mats]);
  scene.environment = env;
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;
  gl.toneMappingExposure = sky ? sky.exposure : 1.05;
  useEffect(() => () => env.dispose(), [env]);
  if (!mats) return null;
  // from above the deck is closer: smaller, denser clouds; level with it: broad banks to the horizon
  mats.deckMat.uniforms.scale.value = top ? 0.12 : 0.06;
  mats.deckMat.uniforms.cover.value = top ? 0.3 : 0.12;
  mats.deckMat.uniforms.time.value = t * (top ? 2 : 1);
  mats.deckMat.uniforms.cam.value.copy(cam);
  return (
    <>
      <mesh material={mats.skyMat} position={[cam.x, cam.y, cam.z]} renderOrder={-2}>
        <sphereGeometry args={[300, 64, 32]} />
      </mesh>
      <mesh material={mats.deckMat} rotation-x={-Math.PI / 2} position={[cam.x, DECK_Y, cam.z]} renderOrder={-1}>
        <planeGeometry args={[700, 700]} />
      </mesh>
    </>
  );
};
const Cam: React.FC<{ pos: THREE.Vector3; look: THREE.Vector3 }> = ({ pos, look }) => {
  const { camera } = useThree();
  camera.position.copy(pos); camera.lookAt(look); camera.updateMatrixWorld();
  return null;
};

export const Aircraft3D: React.FC<{ g: Spec; style: Style; dur: number }> = ({ g, style, dur }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const unit = Math.min(width, height);
  const side = g.view === "side";
  const light: Light = g.light ?? "day";
  const studio = light === "studio";
  const model = useMemo(buildModel, []);
  const lit = useMemo(() => new Set((g.highlight ?? []).map(norm)), [g.highlight]);

  // ---- motion: the bank / pitch the facts give, plus a little air (turbulence), engines turning ----
  const enter = spring({ frame, fps, config: { damping: 26, stiffness: 60 } });
  const orbit = interpolate(frame, [0, dur], [-0.22, 0.22]);
  const rollNow = g.roll ? interpolate(frame, [fps * 1.2, fps * 2.6], [0, g.roll], { ...clamp, easing: ease.inOut }) : 0;
  const pitchNow = g.pitch ? interpolate(frame, [fps * 1.0, fps * 2.4], [0, g.pitch], { ...clamp, easing: ease.inOut }) : 0;
  const air = studio ? 0 : 1;
  const bumpR = air * (Math.sin(frame / 9.3) * 0.35 + Math.sin(frame / 3.7 + 1.3) * 0.12); // degrees
  const bumpP = air * (Math.sin(frame / 11.1 + 0.6) * 0.25 + Math.sin(frame / 4.3) * 0.08);
  model.root.rotation.set(((rollNow + bumpR) * Math.PI) / 180, 0, ((pitchNow + bumpP) * Math.PI) / 180);
  model.root.position.y = Math.sin(frame / 22) * 0.02 + air * Math.sin(frame / 5.1) * 0.006;
  for (const f of model.fans) f.rotation.x = frame * 0.9;
  model.parts.gear.visible = lit.has("gear");
  // lamps: steady nav lights; strobes double-flash every ~1.2 s; the beacon pulses
  const cyc = frame % Math.round(fps * 1.2);
  for (const l of model.lights) {
    const on = l.kind === "steady" ? 1 : l.kind === "strobe" ? (cyc < 2 || (cyc >= 5 && cyc < 7) ? 1 : 0) : Math.max(0, Math.sin((frame / fps) * Math.PI * 2 * 0.9)) ** 6;
    l.glow.material.opacity = on * (light === "day" ? 0.75 : 1);
    l.glow.scale.setScalar((l.kind === "steady" ? 0.22 : 0.42) * (light === "day" ? 0.55 : light === "dusk" ? 0.75 : 1.1) * (0.6 + 0.4 * on));
  }

  // ---- highlight: the part glows from inside, with a fresnel shell around it ----
  const glow = 0.55 + 0.45 * Math.sin(frame / 4.5);
  const litOn = interpolate(frame, [fps * 0.8, fps * 1.2], [0, 1], clamp);
  useMemo(() => {
    for (const [name, obj] of Object.entries(model.parts)) {
      if (!lit.has(name)) continue;
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.shell) return;
        const mat = (mesh.material as THREE.MeshPhysicalMaterial).clone();
        mat.emissive = new THREE.Color(style.colors.primary);
        mesh.material = mat;
        mesh.userData.hl = mat;
        const shell = new THREE.Mesh(mesh.geometry, new THREE.ShaderMaterial({
          uniforms: { color: { value: v3(style.colors.primary) }, opacity: { value: 0 } },
          vertexShader: `varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
          fragmentShader: `uniform vec3 color; uniform float opacity; varying vec3 vN; varying vec3 vV;
            void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(color * (0.5 + 2.2 * f), (0.18 + 0.82 * f) * opacity); }`,
          transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        shell.userData.shell = true;
        shell.scale.setScalar(1.05);
        mesh.add(shell);
        mesh.userData.shellMesh = shell;
      });
    }
  }, [model, lit, style.colors.primary]);
  for (const name of lit) model.parts[name]?.traverse((o) => {
    if (o.userData.hl) (o.userData.hl as THREE.MeshPhysicalMaterial).emissiveIntensity = (0.7 + 1.5 * glow) * litOn;
    if (o.userData.shellMesh) ((o.userData.shellMesh as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.opacity.value = (0.55 + 0.45 * glow) * litOn;
  });

  // ---- camera ----
  const FOV = 30;
  // portrait frames are narrow: far enough back that wingtips and nose stay inside (~85% of the width)
  const radius = side ? 15.5 : 16.5;
  // look from the side of what must be seen: a left part from the left, a right part from the right
  const named = [...lit, ...(g.labels ?? []).map((l) => norm(l.part))];
  const wantsLeft = named.some((n) => /-left$/.test(n) || n === "door");
  const wantsRight = named.some((n) => /-right$/.test(n));
  const zSide = side ? (wantsRight && !wantsLeft ? 1 : -1) : wantsLeft && !wantsRight ? -1 : 1;
  // side view in the sky: level with the aircraft, so the real horizon runs behind it
  const base = side ? new THREE.Vector3(0.9, studio ? 0.55 : 0.035, zSide) : new THREE.Vector3(0.75, 0.95, 0.9 * zSide);
  base.normalize();
  const sunDir = useMemo(() => {
    // fixed in the world, chosen from where the camera starts: day = high, behind the camera and to
    // one side (the visible side is lit); dusk = low, ahead and to the side (warm rim, glowing sky
    // behind); night = moon high behind the camera
    const h = new THREE.Vector3(base.x, 0, base.z).normalize();
    const sideV = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), h);
    if (light === "dusk") return h.clone().multiplyScalar(-0.85).add(sideV.multiplyScalar(0.5)).add(new THREE.Vector3(0, 0.1, 0)).normalize();
    if (light === "night") return h.clone().multiplyScalar(0.5).add(sideV.multiplyScalar(-0.4)).add(new THREE.Vector3(0, 0.75, 0)).normalize();
    return h.clone().multiplyScalar(0.55).add(sideV.multiplyScalar(0.45)).add(new THREE.Vector3(0, 0.75, 0)).normalize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light, side, zSide]);
  base.applyAxisAngle(new THREE.Vector3(0, 1, 0), orbit);
  const camPos = base.multiplyScalar(radius * interpolate(enter, [0, 1], [1.25, 1]));
  // aim a little below the model so it sits in the upper part of the frame, clear of the captions
  const look = new THREE.Vector3(0, -1.25, 0);
  const cam = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 1000);
  cam.position.copy(camPos); cam.lookAt(look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  model.root.updateMatrixWorld(true);
  const labels = (g.labels ?? []).map((l, i) => {
    const key = norm(l.part);
    const a = model.anchors[key];
    if (!a) return null;
    const s = a.clone().applyMatrix4(model.root.matrixWorld).project(cam);
    return { text: l.text, x: (s.x * 0.5 + 0.5) * width, y: (-s.y * 0.5 + 0.5) * height, i };
  }).filter(Boolean) as { text: string; x: number; y: number; i: number }[];
  const labelOn = (i: number) => interpolate(frame, [fps * (1.3 + i * 0.25), fps * (1.7 + i * 0.25)], [0, 1], clamp);
  const sky = studio ? null : SKIES[light];
  const sunPos = sunDir.clone().multiplyScalar(10);

  return (
    <AbsoluteFill style={{ background: studio ? `radial-gradient(ellipse at 50% 32%, #1b2230 0%, #0b0e14 55%, #050608 100%)` : sky!.horizon }}>
      <ThreeCanvas width={width} height={height} camera={{ fov: FOV, near: 0.1, far: 1000 }} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}>
        <Environment light={light} sun={sunDir} cam={camPos} t={(frame / fps) * 0.1} top={!side} />
        <Cam pos={camPos} look={look} />
        {sky ? (
          <>
            <hemisphereLight args={sky.hemi} />
            <directionalLight position={[sunPos.x, sunPos.y, sunPos.z]} intensity={sky.sunI} color={sky.sunColor} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048}
              shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-3} shadow-radius={4} shadow-bias={-0.0004} />
            {/* soft fill from the camera side so the shaded side never goes black */}
            <directionalLight position={[camPos.x * 0.5, camPos.y * 0.5 + 2, camPos.z * 0.5]} intensity={light === "dusk" ? 0.9 : 0.45} color={sky.hemi[0]} />
          </>
        ) : (
          <>
            <hemisphereLight args={["#dfe8ff", "#20242c", 0.5]} />
            <directionalLight position={[3, 6, 4]} intensity={2.6} castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048}
              shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-3} shadow-radius={6} />
            <directionalLight position={[-4, 2, -5]} intensity={1.4} color="#9fc2ff" />
          </>
        )}
        <primitive object={model.root} />
        {studio && !side ? (
          <mesh rotation-x={-Math.PI / 2} position={[0, -0.75, 0]} receiveShadow>
            <planeGeometry args={[14, 14]} />
            <shadowMaterial opacity={0.38} />
          </mesh>
        ) : null}
      </ThreeCanvas>
      {side && g.pitch && studio ? (
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          {(() => {
            const c = new THREE.Vector3(0, 0, 0).project(cam);
            const y = (-c.y * 0.5 + 0.5) * height;
            return <line x1={width * 0.06} x2={width * 0.94} y1={y} y2={y} stroke="rgba(255,255,255,0.35)" strokeWidth={3} strokeDasharray="14 14" />;
          })()}
        </svg>
      ) : null}
      {side && g.pitch ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: height * 0.535, display: "flex", justifyContent: "center", opacity: interpolate(frame, [fps * 1.4, fps * 1.7], [0, 1], clamp) }}>
          <div style={{ background: style.colors.primary, color: style.colors.outline, borderRadius: unit, padding: `${unit * 0.012}px ${unit * 0.035}px`,
            fontFamily: style.fonts.caption, fontWeight: 800, fontSize: unit * 0.05 }}>{`NOSE ${pitchNow < 0 ? "DOWN" : "UP"} ${Math.abs(Math.round(pitchNow))}°`}</div>
        </div>
      ) : null}
      {!side && g.roll ? (
        <div style={{ position: "absolute", left: 0, right: 0, top: height * 0.535, display: "flex", justifyContent: "center", opacity: interpolate(frame, [fps * 1.6, fps * 1.9], [0, 1], clamp) }}>
          <div style={{ background: style.colors.primary, color: style.colors.outline, borderRadius: unit, padding: `${unit * 0.012}px ${unit * 0.035}px`,
            fontFamily: style.fonts.caption, fontWeight: 800, fontSize: unit * 0.05 }}>{`BANK ${Math.abs(Math.round(rollNow))}° ${rollNow < 0 ? "LEFT" : "RIGHT"}`}</div>
        </div>
      ) : null}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {labels.map((l) => {
          const o = labelOn(l.i);
          const right = l.x > width / 2;
          const tx = right ? width * 0.92 : width * 0.08, ty = height * (0.13 + 0.07 * l.i);
          return (
            <g key={l.i} opacity={o}>
              <path d={`M${l.x},${l.y} L${right ? tx - unit * 0.06 : tx + unit * 0.06},${ty + unit * 0.012} L${tx},${ty + unit * 0.012}`} fill="none" stroke={style.colors.primary} strokeWidth={3}
                pathLength={1} strokeDasharray="1" strokeDashoffset={1 - o} />
              <circle cx={l.x} cy={l.y} r={unit * 0.009} fill={style.colors.primary} stroke="#000" strokeWidth={2} />
              <text x={tx} y={ty} textAnchor={right ? "end" : "start"} fill="#fff" fontFamily={style.fonts.caption} fontWeight={800} fontSize={unit * 0.04}
                letterSpacing="0.04em" stroke="rgba(0,0,0,0.85)" strokeWidth={unit * 0.008} paintOrder="stroke">{l.text}</text>
            </g>
          );
        })}
      </svg>
      {g.title ? <div style={{ position: "absolute", top: height * 0.06, width: "100%", textAlign: "center", fontFamily: style.editorial ? style.fonts.emphasis : style.fonts.caption,
        fontWeight: 700, fontSize: unit * 0.056, color: "#fff" }}>{g.title}</div> : null}
      <AbsoluteFill style={{ background: studio ? "radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(0,0,0,0.5) 100%)"
        : "radial-gradient(ellipse at 50% 38%, transparent 60%, rgba(0,0,0,0.28) 100%), linear-gradient(180deg, rgba(0,0,0,0.18) 0%, transparent 18%, transparent 52%, rgba(0,0,0,0.42) 100%)", pointerEvents: "none" }} />
      {g.source ? <div style={{ position: "absolute", bottom: height * 0.3, width: "100%", textAlign: "center", fontFamily: style.fonts.caption, fontSize: unit * 0.022, color: "rgba(255,255,255,0.5)" }}>{`Source: ${g.source} · Illustration`}</div> : null}
    </AbsoluteFill>
  );
};
