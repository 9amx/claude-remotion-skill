// A cinematic 3D Earth (WebGL): NASA Blue Marble day side, city lights on the night side,
// moving clouds, ocean sun glint, atmosphere glow and stars. The camera descends from space
// onto the place(s); a glowing route draws itself with an aircraft flying along it, and the
// end point pulses with a beam of light. Labels are laid out in 2D on top so they stay sharp.
// Textures live in public/earth/ (copied from the three-globe package by fetch-broll).
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { clamp, ease, type Style } from "../theme";
import type { GraphicSpec } from "../types";

type Globe = Extract<GraphicSpec, { type: "globe" }>;
const R = 1;
const toVec = (lat: number, lon: number, r = R) => {
  const phi = ((90 - lat) * Math.PI) / 180, theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
};

let texCache: Record<string, THREE.Texture> | null = null;
const useEarthTextures = () => {
  const [tex, setTex] = useState(texCache);
  const [handle] = useState(() => (texCache ? null : delayRender("loading earth textures", { timeoutInMilliseconds: 60000 })));
  useEffect(() => {
    if (texCache || handle === null) return;
    const loader = new THREE.TextureLoader();
    const names = { day: "earth-blue-marble.jpg", night: "earth-night.jpg", water: "earth-water.png", bump: "earth-topology.png", clouds: "clouds.png", stars: "night-sky.png" };
    Promise.all(Object.entries(names).map(([k, f]) => loader.loadAsync(staticFile(`earth/${f}`)).then((t) => [k, t] as const)))
      .then((list) => {
        const out: Record<string, THREE.Texture> = {};
        for (const [k, t] of list) {
          t.colorSpace = k === "day" || k === "night" || k === "stars" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          t.anisotropy = 8;
          out[k] = t;
        }
        texCache = out;
        setTex(out);
        // let React commit and WebGL upload the textures before the frame is captured
        requestAnimationFrame(() => requestAnimationFrame(() => continueRender(handle)));
      })
      .catch((e) => cancelRender(e));
  }, [handle]);
  return tex;
};

const earthVert = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const earthFrag = /* glsl */ `
  uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D waterMap; uniform sampler2D bumpMap;
  uniform vec3 sunDir; uniform float nightBoost; uniform float glint;
  varying vec2 vUv; varying vec3 vN; varying vec3 vP;
  void main() {
    vec3 n = normalize(vN);
    // cheap relief: tilt the normal with the topology gradient
    float h0 = texture2D(bumpMap, vUv).r, hx = texture2D(bumpMap, vUv + vec2(0.0006, 0.0)).r, hy = texture2D(bumpMap, vUv + vec2(0.0, 0.0006)).r;
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n)); vec3 north = normalize(cross(n, east));
    vec3 nb = normalize(n - (east * (hx - h0) + north * (hy - h0)) * 6.0);
    float ndl = dot(nb, sunDir);
    float day = smoothstep(-0.12, 0.22, dot(n, sunDir));
    vec3 dayCol = texture2D(dayMap, vUv).rgb;
    dayCol = pow(dayCol, vec3(0.92)) * (0.08 + 1.15 * max(ndl, 0.0));
    vec3 nightCol = texture2D(nightMap, vUv).rgb; nightCol = pow(nightCol, vec3(1.35)) * 2.2 * nightBoost;
    vec3 moon = texture2D(dayMap, vUv).rgb * vec3(0.10, 0.13, 0.20) * nightBoost;
    vec3 col = mix(nightCol + moon, dayCol, day);
    vec3 v = normalize(cameraPosition - vP);
    float water = texture2D(waterMap, vUv).r;
    vec3 hv = normalize(sunDir + v);
    col += vec3(1.0, 0.92, 0.78) * pow(max(dot(n, hv), 0.0), 600.0) * water * 0.22 * day * glint;
    float rim = pow(1.0 - max(dot(n, v), 0.0), 2.6);
    col += vec3(0.32, 0.58, 1.0) * rim * (0.25 + 0.75 * day) * 0.85;
    gl_FragColor = vec4(col, 1.0);
  }`;
const atmoVert = /* glsl */ `varying vec3 vN; varying vec3 vP; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const atmoFrag = /* glsl */ `uniform vec3 sunDir; varying vec3 vN; varying vec3 vP;
  void main() { vec3 v = normalize(cameraPosition - vP); float rim = pow(max(0.0, 0.72 + dot(normalize(vN), v)), 3.0);
    float lit = 0.35 + 0.65 * smoothstep(-0.3, 0.4, dot(normalize(vN), sunDir));
    gl_FragColor = vec4(vec3(0.35, 0.62, 1.0) * rim * lit * 1.4, rim * lit); }`;

// Small airliner silhouette (white, self-lit) for the route
const makePlane = (color: string) => {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: new THREE.Color(color), emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.62, 6, 12), mat); body.rotation.z = Math.PI / 2; g.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.9), mat); wing.position.x = 0.02; g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.015, 0.34), mat); tail.position.x = -0.32; g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.015), mat); fin.position.set(-0.32, 0.08, 0); g.add(fin);
  return g;
};

export const Earth3D: React.FC<{ g: Globe; style: Style; dur: number }> = ({ g, style, dur }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const tex = useEarthTextures();
  const pts = g.places.map((p) => toVec(p.lat, p.lon));
  const first = pts[0], last = pts[pts.length - 1];
  const focus = pts.length > 1 ? first.clone().add(last).normalize() : first.clone();
  const spanAng = pts.length > 1 ? first.angleTo(last) : 0;

  // ---- camera: from space, swing round, settle above the focus at an oblique angle ----
  // Portrait frames are narrow, so the route is turned to run up the screen (origin at the
  // bottom, destination at the top) and the distance is chosen so all of it fits.
  const FOV = 38;
  const fly = interpolate(frame, [0, Math.min(dur * 0.72, fps * 3.4)], [0, 1], { ...clamp, easing: ease.inOut });
  const drift = frame / Math.max(1, dur);
  const north = new THREE.Vector3(0, 1, 0);
  const tangentUp = (n: THREE.Vector3, v: THREE.Vector3) => v.clone().sub(n.clone().multiplyScalar(v.dot(n))).normalize();
  // the route runs diagonally up the screen (about 25 degrees off vertical): more depth, more motion
  const routeUp = pts.length > 1 ? tangentUp(focus, last.clone().sub(first)).applyAxisAngle(focus, 0.42) : tangentUp(focus, north);
  const halfLen = pts.length > 1 ? Math.sin(spanAng / 2) * 1.0 : 0.2;
  const fit = (halfLen * 2.35) / Math.tan(((FOV / 2) * Math.PI) / 180);
  const endD = Math.max(0.62, fit);
  const startDir = focus.clone().applyAxisAngle(north, 1.1).add(new THREE.Vector3(0, 0.25, 0)).normalize();
  const dir = startDir.clone().lerp(focus, fly).normalize();
  const height_ = interpolate(fly, [0, 1], [3.4, endD]) * (1 - drift * 0.05);
  const up = north.clone().lerp(routeUp, fly).normalize();
  // tilt: the camera sits back along -up so we look forward along the route, not straight down
  const camPos = dir.clone().multiplyScalar(1 + height_).add(up.clone().multiplyScalar(-height_ * 0.32 * fly));
  // aim a little below the focus so the story sits in the upper 60% of the frame, clear of the captions
  const lookAt = dir.clone().multiplyScalar(interpolate(fly, [0, 1], [0, 1])).add(up.clone().multiplyScalar(-height_ * 0.11 * fly));
  const dist = height_;
  const night = g.light === "night";
  const sun = useMemo(() => {
    const side = new THREE.Vector3().crossVectors(focus, north).normalize();
    // day: the sun high over the place from the side (terminator out of frame); night: behind the earth
    // night: the sun just past the horizon - city lights at the place, a lit crescent on the far limb
    return night ? focus.clone().multiplyScalar(-0.22).add(side.clone().multiplyScalar(0.95)).add(north.clone().multiplyScalar(0.15)).normalize()
      : focus.clone().multiplyScalar(0.8).add(side.clone().multiplyScalar(-0.45)).add(north.clone().multiplyScalar(0.25)).normalize();
  }, [focus.x, focus.y, focus.z, night]);

  const earthMat = useMemo(() => tex ? new THREE.ShaderMaterial({
    uniforms: { dayMap: { value: tex.day }, nightMap: { value: tex.night }, waterMap: { value: tex.water }, bumpMap: { value: tex.bump }, sunDir: { value: sun }, nightBoost: { value: night ? 1.6 : 1 }, glint: { value: 1 } },
    vertexShader: earthVert, fragmentShader: earthFrag,
  }) : null, [tex, sun, night]);
  // the sun's glint on the ocean reads well from space, but turns into a blur up close
  if (earthMat) earthMat.uniforms.glint.value = interpolate(dist, [0.9, 1.8], [0, 1], clamp);
  const atmoMat = useMemo(() => new THREE.ShaderMaterial({ uniforms: { sunDir: { value: sun } }, vertexShader: atmoVert, fragmentShader: atmoFrag,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), [sun]);
  const cloudMat = useMemo(() => tex ? new THREE.MeshLambertMaterial({ map: tex.clouds, transparent: true, opacity: 0.85, depthWrite: false }) : null, [tex]);

  // ---- route ----
  const routeP = g.route ? interpolate(frame, [fps * 1.4, Math.max(fps * 2.6, dur * 0.8)], [0, 1], { ...clamp, easing: ease.inOut }) : 0;
  const curve = useMemo(() => {
    if (!g.route || pts.length < 2) return null;
    const samples: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], ang = a.angleTo(b);
      for (let k = 0; k <= 48; k++) {
        const t = k / 48;
        const v = a.clone().lerp(b, t).normalize(); // close to slerp for display
        samples.push(v.multiplyScalar(R + 0.004 + Math.sin(Math.PI * t) * Math.min(0.18, ang * 0.22)));
      }
    }
    return new THREE.CatmullRomCurve3(samples);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.route, JSON.stringify(g.places)]);
  const tube = useMemo(() => (curve ? new THREE.TubeGeometry(curve, 400, 0.0026 * endD, 8, false) : null), [curve, endD]);
  const glowTube = useMemo(() => (curve ? new THREE.TubeGeometry(curve, 400, 0.008 * endD, 8, false) : null), [curve, endD]);
  if (tube) tube.setDrawRange(0, Math.floor(routeP * 400) * 8 * 6);
  if (glowTube) glowTube.setDrawRange(0, Math.floor(routeP * 400) * 8 * 6);
  const plane = useMemo(() => makePlane(style.colors.primary), [style.colors.primary]);
  if (curve && routeP > 0 && routeP < 1) {
    const p = curve.getPointAt(routeP), t = curve.getTangentAt(routeP);
    plane.position.copy(p);
    plane.up.copy(p.clone().normalize());
    plane.lookAt(p.clone().add(t));
    plane.rotateY(-Math.PI / 2);
    plane.scale.setScalar(0.014 * dist);
    plane.visible = true;
  } else plane.visible = false;

  // ---- marker at the end point ----
  const marker = g.marker ?? g.places.length - 1;
  const mPos = pts[marker] ?? last;
  const pulse = (frame % 36) / 36;
  const markerOn = interpolate(frame, [fps * 1.6, fps * 2.2], [0, 1], clamp);
  const markerQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), mPos.clone().normalize()), [mPos.x, mPos.y, mPos.z]);
  const beamQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), mPos.clone().normalize()), [mPos.x, mPos.y, mPos.z]);

  // ---- 2D labels: project with the same camera ----
  const cam = new THREE.PerspectiveCamera(FOV, width / height, 0.01, 100);
  cam.position.copy(camPos); cam.up.copy(up); cam.lookAt(lookAt); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const labelOn = interpolate(frame, [fps * 2.2, fps * 2.8], [0, 1], clamp);
  const labels = g.places.map((p, i) => {
    const v = toVec(p.lat, p.lon, R + 0.01);
    const facing = v.clone().normalize().dot(camPos.clone().sub(v).normalize()) > 0.05;
    const s = v.clone().project(cam);
    return { name: p.label ?? p.name, x: (s.x * 0.5 + 0.5) * width, y: (-s.y * 0.5 + 0.5) * height, show: facing && s.z < 1, hot: i === marker };
  });
  const unit = Math.min(width, height);

  return (
    <AbsoluteFill style={{ background: "#02040a" }}>
      <ThreeCanvas width={width} height={height} camera={{ fov: FOV, near: 0.01, far: 100, position: camPos.toArray() }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}>
        <CameraRig pos={camPos} look={lookAt} up={up} />
        <Redraw ready={!!tex} />
        {tex ? (
          <>
            <mesh>
              <sphereGeometry args={[30, 32, 32]} />
              <meshBasicMaterial map={tex.stars} side={THREE.BackSide} color="#8a96b8" />
            </mesh>
            <directionalLight position={sun.clone().multiplyScalar(10).toArray()} intensity={2.4} />
            <ambientLight intensity={0.05} />
            <mesh material={earthMat!}><sphereGeometry args={[R, 160, 160]} /></mesh>
            <mesh material={cloudMat!} rotation={[0, frame * 0.0007, 0]}><sphereGeometry args={[R * 1.007, 128, 128]} /></mesh>
            <mesh material={atmoMat} scale={1.06}><sphereGeometry args={[R, 96, 96]} /></mesh>
            {tube ? <mesh geometry={glowTube!}><meshBasicMaterial color={style.colors.primary} transparent opacity={0.28} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh> : null}
            {tube ? <mesh geometry={tube}><meshBasicMaterial color={"#fff6e8"} /></mesh> : null}
            <primitive object={plane} />
            <group position={mPos.clone().multiplyScalar(R + 0.011).toArray()} quaternion={markerQuat} scale={markerOn * Math.min(1, dist) * 0.9}>
              <mesh scale={1 + pulse * 2.4}><ringGeometry args={[0.022, 0.028, 64]} /><meshBasicMaterial color={style.colors.primary} transparent opacity={(1 - pulse) * 0.9} side={THREE.DoubleSide} depthWrite={false} /></mesh>
              <mesh><circleGeometry args={[0.011, 32]} /><meshBasicMaterial color={"#ffffff"} side={THREE.DoubleSide} /></mesh>
            </group>
            <mesh position={mPos.clone().multiplyScalar(R + 0.06 * Math.min(1, dist)).toArray()} quaternion={beamQuat} scale={[Math.min(1, dist), markerOn * Math.min(1, dist), Math.min(1, dist)]}>
              <cylinderGeometry args={[0.0012, 0.004, 0.12, 16, 1, true]} />
              <meshBasicMaterial color={style.colors.primary} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
            </mesh>
          </>
        ) : null}
      </ThreeCanvas>
      {/* labels */}
      {labels.map((l, i) => l.show ? (
        <div key={i} style={{ position: "absolute", left: l.x + unit * 0.045, top: l.y, transform: "translate(0, -50%)", opacity: labelOn,
          fontFamily: style.fonts.caption, fontWeight: 800, fontSize: unit * (l.hot ? 0.042 : 0.034), color: "#fff", letterSpacing: "0.04em",
          textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,1)", whiteSpace: "nowrap", textTransform: "uppercase" }}>{l.name}</div>
      ) : null)}
      {g.title ? (
        <div style={{ position: "absolute", top: height * 0.1, left: 0, right: 0, textAlign: "center", fontFamily: style.editorial ? style.fonts.emphasis : style.fonts.caption,
          fontWeight: 700, fontSize: unit * 0.056, color: "#fff", textShadow: "0 4px 24px rgba(0,0,0,0.8)",
          opacity: spring({ frame, fps, config: { damping: 20 } }) }}>{g.title}</div>
      ) : null}
      {/* cinematic finish: vignette + fine grain */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,0.55) 100%)", pointerEvents: "none" }} />
      {g.source ? <div style={{ position: "absolute", bottom: height * 0.3, width: "100%", textAlign: "center", fontFamily: style.fonts.caption, fontSize: unit * 0.022, color: "rgba(255,255,255,0.55)" }}>{`Source: ${g.source} · Imagery: NASA`}</div> : null}
    </AbsoluteFill>
  );
};

// Remotion's ThreeCanvas draws once per frame change; draw again when the textures arrive,
// or the first frame of each render tab would stay black.
const Redraw: React.FC<{ ready: boolean }> = ({ ready }) => {
  const { advance } = useThree();
  useEffect(() => { if (ready) advance(performance.now()); }, [ready, advance]);
  return null;
};

const CameraRig: React.FC<{ pos: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3 }> = ({ pos, look, up }) => {
  const { camera, gl } = useThree();
  gl.toneMappingExposure = 1.35;
  camera.position.copy(pos);
  camera.up.copy(up);
  camera.lookAt(look);
  camera.updateMatrixWorld();
  return null;
};
