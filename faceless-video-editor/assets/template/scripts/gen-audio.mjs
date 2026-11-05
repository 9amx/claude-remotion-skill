// Synthesize royalty-free music loops and an SFX kit.
// Zero downloads, deterministic. Music skipped when music.file is set.
//   public/audio/bed-<mood>.wav  mood: calm | tense | upbeat (one per mood in use)
//   public/audio/whoosh.wav scene transitions (+ whoosh-2, whoosh-3 variants)
//   public/audio/hit.wav    hook impact on frame 0 (+ hit-2)
//   public/audio/pop.wav    emphasis text landing
//   public/audio/riser.wav  build into a reveal (fx "reveal")
//   public/audio/scratch.wav freeze frame (fx "freeze")
//   public/audio/glitch.wav glitch transition
//   public/audio/tick.wav   highlighted caption words
//   public/audio/ping.wav   radar graphics (contact ping)
//   public/audio/data.wav   explainer graphics building (counter, timeline, profile, aircraft)
// Your own files are normalized into public/audio/user/: public/sfx/<slot>*.wav|mp3
// (kit replacements), beat sounds and ambience beds named in project.json, music.
import fs from "node:fs";
import path from "node:path";
import { MOOD_BPM, PUBLIC, ffmpeg, fail, log, readJson, userMusicPath, userSfx, userSfxPath } from "./lib.mjs";

const SR = 44100;
const OUT = path.join(PUBLIC, "audio");
fs.mkdirSync(OUT, { recursive: true });

let seed = 1337;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const secs = (s) => Math.round(s * SR);
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function wav(samples, right = null) {
  // mono, or stereo when a right channel is given; peak-normalized to -1.4 dBFS
  const ch = right ? 2 : 1, n = samples.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]), right ? Math.abs(right[i]) : 0);
  const gain = peak > 0 ? 0.85 / peak : 1;
  const bytes = n * 2 * ch;
  const buf = Buffer.alloc(44 + bytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + bytes, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2 * ch, 28);
  buf.writeUInt16LE(2 * ch, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(bytes, 40);
  const q = (x) => Math.round(Math.max(-1, Math.min(1, x * gain)) * 32767);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(q(samples[i]), 44 + i * 2 * ch);
    if (right) buf.writeInt16LE(q(right[i]), 46 + i * 4);
  }
  return buf;
}

// ---------- tiny DSP (filters, reverb) for the SFX kit ----------
// RBJ biquad; set() can be called per sample for sweeps.
function biquad(type) {
  let b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return {
    set(f, q = 0.707) {
      const w = (2 * Math.PI * Math.min(f, SR * 0.45)) / SR, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
      let n0, n1, n2;
      if (type === "lp") [n0, n1, n2] = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2];
      else if (type === "hp") [n0, n1, n2] = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2];
      else [n0, n1, n2] = [al, 0, -al]; // band-pass, 0 dB peak
      const a0 = 1 + al;
      [b0, b1, b2, a1, a2] = [n0 / a0, n1 / a0, n2 / a0, (-2 * cw) / a0, (1 - al) / a0];
      return this;
    },
    run(x) {
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      [x2, x1, y2, y1] = [x1, x, y1, y];
      return y;
    },
  };
}
// Small stereo room (Schroeder: 4 combs + 2 all-passes per side, offset delays for width).
function reverb(L, R, { wet = 0.3, size = 0.84, damp = 0.35, tail = 1.2 } = {}) {
  const n = L.length + secs(tail), outL = new Float32Array(n), outR = new Float32Array(n);
  const side = (input, out, spread) => {
    const combs = [1116, 1188, 1277, 1356].map((d) => ({ buf: new Float32Array(d + spread), i: 0, lp: 0 }));
    const aps = [556, 441].map((d) => ({ buf: new Float32Array(d + spread), i: 0 }));
    for (let i = 0; i < n; i++) {
      const x = (i < input.length ? input[i] : 0) * 0.25;
      let y = 0;
      for (const c of combs) {
        const o = c.buf[c.i];
        c.lp = o * (1 - damp) + c.lp * damp;
        c.buf[c.i] = x + c.lp * size;
        c.i = (c.i + 1) % c.buf.length;
        y += o;
      }
      for (const a of aps) {
        const o = a.buf[a.i];
        a.buf[a.i] = y + o * 0.5;
        a.i = (a.i + 1) % a.buf.length;
        y = o - y;
      }
      out[i] = (i < input.length ? input[i] : 0) * (1 - wet * 0.5) + y * wet;
    }
  };
  side(L, outL, 0);
  side(R, outR, 23);
  return [outL, outR];
}
const pan = (x, p) => [x * Math.cos(((p + 1) * Math.PI) / 4), x * Math.sin(((p + 1) * Math.PI) / 4)]; // -1 left .. 1 right
const soft = (x, drive = 1.5) => Math.tanh(x * drive) / Math.tanh(drive);
const save = (name, L, R) => fs.writeFileSync(path.join(OUT, name), wav(L, R));

// ---------- SFX kit ----------
// Cinematic, stereo, deterministic. Your own library files (public/sfx/) replace any of these.

// whoosh: air rushing past - band-passed noise whose pitch rises then falls (doppler)
// as it pans across, a low body under it and a little room. 3 variants rotate.
function whoosh(variant) {
  seed = 4242 + variant * 101;
  const dur = [0.75, 0.62, 0.9][variant], N = secs(dur), L = new Float32Array(N), R = new Float32Array(N);
  const bpL = biquad("bp"), bpR = biquad("bp"), body = biquad("lp").set(180), hiss = biquad("hp").set(5000);
  const peakAt = [0.58, 0.5, 0.62][variant], dir = variant === 1 ? -1 : 1;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const env = t < peakAt ? Math.pow(t / peakAt, 2.2) : Math.pow(1 - (t - peakAt) / (1 - peakAt), 1.6);
    const f = 350 + 2600 * Math.exp(-Math.pow((t - peakAt) / 0.2, 2)); // doppler-ish centre frequency
    bpL.set(f, 1.4); bpR.set(f * 1.06, 1.4);
    const n1 = rand(), n2 = rand();
    const air = bpL.run(n1) * 1.0, airR = bpR.run(n2) * 1.0;
    const low = body.run(n1) * 1.4, top = hiss.run(n2) * 0.25 * env;
    const [pl, pr] = pan(1, dir * (t * 2 - 1) * 0.8);
    L[i] = (air * pl + low * 0.6 + top) * env;
    R[i] = (airR * pr + low * 0.6 + top) * env;
  }
  const [rl, rr] = reverb(L, R, { wet: 0.22, size: 0.8, tail: 0.5 });
  save(variant ? `whoosh-${variant + 1}.wav` : "whoosh.wav", rl, rr);
}
[0, 1, 2].forEach(whoosh);

// hit: trailer impact - a sub drop, a cracked transient, a mid thump and a long dark room tail.
function hit(variant) {
  seed = 9001 + variant * 7;
  const N = secs(1.4), L = new Float32Array(N), R = new Float32Array(N);
  const crack = biquad("hp").set(1800), thump = biquad("lp").set(300), thumpR = biquad("lp").set(300);
  let ph = 0;
  const f0 = variant ? 58 : 66, f1 = variant ? 30 : 34;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (f1 + (f0 - f1) * Math.exp(-t * 9))) / SR;
    const sub = Math.sin(ph) * Math.exp(-t * 2.6) * Math.min(1, t * 400);
    const n = rand(), m = rand();
    const tr = crack.run(n) * Math.exp(-t * 55) * 0.9;
    const body = thump.run(n) * Math.exp(-t * 11) * 2.2, bodyR = thumpR.run(m) * Math.exp(-t * 11) * 2.2;
    const fade = Math.min(1, (N - i) / secs(0.3)); // no click where the dry sound ends
    L[i] = soft(sub * 1.1 + body + tr, 1.8) * fade;
    R[i] = soft(sub * 1.1 + bodyR + tr, 1.8) * fade;
  }
  const [rl, rr] = reverb(L, R, { wet: 0.38, size: 0.88, damp: 0.55, tail: 1.6 });
  save(variant ? "hit-2.wav" : "hit.wav", rl, rr);
}
[0, 1].forEach(hit);

// pop: a soft, rounded UI pop with a tiny click and room (emphasis text landing)
{
  seed = 77;
  const N = secs(0.22), L = new Float32Array(N), R = new Float32Array(N);
  const click = biquad("bp").set(3500, 2);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (420 + 900 * Math.exp(-t * 60))) / SR;
    const x = Math.sin(ph) * Math.exp(-t * 26) * Math.min(1, t * 900) + click.run(rand()) * Math.exp(-t * 300) * 0.6;
    L[i] = x; R[i] = x;
  }
  const [rl, rr] = reverb(L, R, { wet: 0.18, size: 0.7, tail: 0.3 });
  save("pop.wav", rl, rr);
}

// riser: tension build - noise sweeping up through a narrowing band, a rising
// detuned chord and a reverse-cymbal shimmer, all stopping dead at the peak
// (the reveal lands on silence + hit).
{
  seed = 31337;
  const D = 1.6, N = secs(D), L = new Float32Array(N), R = new Float32Array(N);
  const bpL = biquad("bp"), bpR = biquad("bp"), shim = biquad("hp").set(6500), shimR = biquad("hp").set(6500);
  const phs = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const f = 180 * Math.pow(40, t); // 180 Hz -> 7.2 kHz
    bpL.set(f, 1 + 4 * t); bpR.set(f * 1.04, 1 + 4 * t);
    const nl = bpL.run(rand()), nr = bpR.run(rand());
    let tone = 0;
    [0, 7, 12].forEach((semi, k) => {
      const base = 110 * 2 ** (semi / 12) * Math.pow(2, t * 1.4);
      for (const [j, det] of [[k * 2, 0.996], [k * 2 + 1, 1.004]]) {
        phs[j] += (2 * Math.PI * base * det) / SR;
        tone += ((phs[j] / Math.PI) % 2) - 1; // saw
      }
    });
    tone *= 0.06;
    const cym = shim.run(rand()) * Math.pow(t, 4) * 1.2, cymR = shimR.run(rand()) * Math.pow(t, 4) * 1.2;
    const env = Math.pow(t, 2.2) * (t > 0.985 ? (1 - t) / 0.015 : 1);
    L[i] = (nl * 1.3 + tone + cym) * env;
    R[i] = (nr * 1.3 + tone * 0.96 + cymR) * env;
  }
  save("riser.wav", L, R);
}

// record scratch: fast pitch wobble on filtered noise (freeze frames)
{
  seed = 555;
  const N = secs(0.38), L = new Float32Array(N), R = new Float32Array(N);
  let ph = 0, lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    ph += (2 * Math.PI * (300 + 700 * Math.sin(t * Math.PI * 3))) / SR;
    lp += 0.35 * (rand() - lp);
    const x = (Math.sin(ph) * 0.6 + lp * 0.7) * Math.sin(Math.PI * t) * (1 - t * 0.5);
    [L[i], R[i]] = pan(x, Math.sin(t * Math.PI * 3) * 0.4);
  }
  save("scratch.wav", L, R);
}

// glitch: digital stutter - sample-and-hold noise and buzzing squares in short
// random slices, different on each side (glitch transitions)
{
  seed = 2024;
  const N = secs(0.32), L = new Float32Array(N), R = new Float32Array(N);
  const slice = secs(0.018);
  let freq = 220, hold = 1, gateL = 1, gateR = 1, sh = 0, held = 0;
  const hp = biquad("hp").set(120), hpR = biquad("hp").set(120);
  for (let i = 0; i < N; i++) {
    if (i % slice === 0) {
      freq = [110, 220, 330, 880, 1760][Math.floor(Math.abs(rand()) * 5)];
      hold = 1 + Math.floor(Math.abs(rand()) * 12);
      gateL = rand() > -0.5 ? 1 : 0; gateR = rand() > -0.5 ? 1 : 0;
    }
    if (sh++ % hold === 0) held = rand();
    const t = i / SR, env = Math.exp(-t * 5) * Math.min(1, t * 2000);
    const sq = Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.35;
    const x = (sq + held * 0.6) * env;
    L[i] = hp.run(x * gateL);
    R[i] = hpR.run(x * gateR * 0.9 + held * 0.1 * env);
  }
  save("glitch.wav", L, R);
}

// tick: tiny, soft click for highlighted caption words
{
  seed = 12;
  const N = secs(0.05), L = new Float32Array(N), R = new Float32Array(N);
  const bp = biquad("bp").set(2600, 3);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * 3100) / SR;
    const x = Math.sin(ph) * Math.exp(-t * 160) * 0.6 + bp.run(rand()) * Math.exp(-t * 400);
    L[i] = x; R[i] = x;
  }
  save("tick.wav", L, R);
}

// ping: sonar / radar contact ping with ping-pong echoes (radar graphics)
{
  const N = secs(2.2), L = new Float32Array(N), R = new Float32Array(N);
  const dly = secs(0.27);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const x = (Math.sin(2 * Math.PI * 1320 * t) + 0.35 * Math.sin(2 * Math.PI * 2640 * t) + 0.12 * Math.sin(2 * Math.PI * 3960 * t)) * Math.exp(-t * 7) * Math.min(1, t * 600);
    L[i] += x * 0.9; R[i] += x * 0.9;
    // echoes alternate sides, each quieter
    for (let k = 1; k <= 4; k++) {
      const j = i + dly * k;
      if (j < N) (k % 2 ? L : R)[j] += x * 0.45 ** k;
    }
  }
  const [rl, rr] = reverb(L, R, { wet: 0.3, size: 0.86, tail: 0.6 });
  save("ping.wav", rl, rr);
}

// data: a quick run of soft UI blips (explainer graphics building: counters, timelines, charts)
{
  seed = 808;
  const N = secs(0.42), L = new Float32Array(N), R = new Float32Array(N);
  const notes = [84, 91, 88, 96, 93]; // MIDI, high and airy
  notes.forEach((m, k) => {
    const at = secs(0.06 * k), f = hz(m), len = secs(0.07), p = (k % 2 ? 1 : -1) * 0.35;
    for (let i = 0; i < len && at + i < N; i++) {
      const t = i / SR;
      const x = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 55) * Math.min(1, t * 1500) * (1 - k * 0.12);
      const [a, b] = pan(x, p);
      L[at + i] += a; R[at + i] += b;
    }
  });
  const [rl, rr] = reverb(L, R, { wet: 0.2, size: 0.75, tail: 0.35 });
  save("data.wav", rl, rr);
}

// ---------- your own sound (public/sfx/, music files) ----------
// Pro libraries ship at very different levels; normalize so sfxLevel and
// music.volume mean the same thing whatever the source. Cached by mtime.
const timeline = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!timeline) fail("Run build-timeline first (beds are sized to the video).");
const fresh = (src, dest) => fs.existsSync(dest) && fs.statSync(dest).mtimeMs > fs.statSync(src).mtimeMs;
fs.mkdirSync(path.join(OUT, "user"), { recursive: true });
// SFX: convert first (mono -> stereo changes the level), then set the peak to -1 dBFS.
function peakNormalize(src, dest, label) {
  if (fresh(src, dest)) return;
  const tmp = dest.replace(/\.wav$/, ".tmp.wav");
  if (ffmpeg(["-i", src, "-ar", "48000", "-ac", "2", tmp]).status !== 0) fail(`could not read ${path.relative(PUBLIC, src)}`);
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(ffmpeg(["-i", tmp, "-af", "volumedetect", "-f", "null", "-"], { capture: true }).stderr || "");
  const gain = m ? Math.min(20, -1 - parseFloat(m[1])) : 0; // cap: never blow up a near-silent file
  ffmpeg(["-i", tmp, "-af", `volume=${gain.toFixed(2)}dB`, dest]);
  fs.rmSync(tmp);
  log("audio", `${label}: ${path.relative(PUBLIC, src)} (${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB)`);
}
// Music and ambience: loudness, so volume means the same for every file.
function loudnessNormalize(file, dest, label) {
  const src = path.join(PUBLIC, file);
  if (fresh(src, dest)) return;
  if (ffmpeg(["-i", src, "-vn", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k", dest]).status !== 0) fail(`could not read ${file}`);
  log("audio", `${label}: ${file} (normalized to -14 LUFS)`);
}
for (const files of Object.values(userSfx())) {
  for (const f of files) peakNormalize(path.join(PUBLIC, "sfx", f), path.join(PUBLIC, userSfxPath(f)), "own SFX");
}
for (const sp of (timeline.spots ?? []).filter((x) => x.file)) peakNormalize(path.join(PUBLIC, sp.file), path.join(PUBLIC, sp.src), "beat SFX");
for (const seg of timeline.music.segments.filter((m) => m.file)) loudnessNormalize(seg.file, path.join(PUBLIC, userMusicPath(seg.file)), "own music");
for (const a of timeline.ambience ?? []) loudnessNormalize(a.file, path.join(PUBLIC, a.src), "ambience");

// ---------- SFX alignment ----------
// Library SFX put their energy anywhere: a whoosh peaks ~0.4s in, a riser just
// before it stops, a glitch is a flat 0.7s burst. Movement sounds (whoosh,
// riser) should PEAK on the cut / reveal; impacts and UI sounds (hit, glitch,
// scratch, pop, tick) should START on it. Write each file's offset to its
// alignment point into the timeline; the composition starts it that much early.
const PEAK_ALIGNED = new Set(["whoosh", "riser"]);
function alignMs(file, mode) {
  const b = fs.readFileSync(file);
  let off = 12, ch = 1, sr = 44100, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "fmt ") [ch, sr] = [b.readUInt16LE(off + 10), b.readUInt32LE(off + 12)];
    if (id === "data") { data = b.subarray(off + 8, Math.min(b.length, off + 8 + size)); break; }
    off += 8 + size + (size % 2);
  }
  if (!data) return 0;
  const frames = Math.floor(data.length / (2 * ch)), win = Math.round(sr / 100); // 10ms windows, all channels
  const env = [];
  for (let w = 0; w * win < frames; w++) {
    let e = 0;
    for (let i = w * win; i < Math.min(frames, (w + 1) * win); i++) for (let c = 0; c < ch; c++) e += Math.abs(data.readInt16LE((i * ch + c) * 2));
    env.push(e);
  }
  const max = Math.max(...env);
  const at = mode === "peak" ? env.indexOf(max) : env.findIndex((e) => e >= max * 0.3); // onset: first window at 30% of max
  return Math.max(0, at) * 10;
}
timeline.sfxPeaks = {};
for (const [slot, list] of Object.entries(timeline.sfxFiles ?? {})) {
  for (const src of list) {
    if (fs.existsSync(path.join(PUBLIC, src))) timeline.sfxPeaks[src] = alignMs(path.join(PUBLIC, src), PEAK_ALIGNED.has(slot) || slot.startsWith("tr") ? "peak" : "onset");
  }
}
// Beat sounds start on their cut (a door slam, a camera shutter): onset.
for (const sp of timeline.spots ?? []) {
  if (!(sp.src in timeline.sfxPeaks) && fs.existsSync(path.join(PUBLIC, sp.src))) timeline.sfxPeaks[sp.src] = alignMs(path.join(PUBLIC, sp.src), "onset");
}
fs.writeFileSync(path.join(PUBLIC, "timeline.json"), JSON.stringify(timeline, null, 2));

// ---------- music beds ----------
// One seamless loop per mood used in the timeline (bed-<mood>.wav), a whole
// number of chord cycles up to ~2 minutes. The composition loops it and does
// the fades, so a 40 minute video costs the same as a 40 second one.
const moods = [...new Set(timeline.music.segments.map((m) => m.mood).filter(Boolean))];
if (!moods.length) {
  log("audio", "SFX ready; no synthesized music needed (own music or mood none).");
  process.exit(0);
}

const MOODS = {
  // chords as MIDI note sets, 2 bars each
  calm: { bpm: MOOD_BPM.calm, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], kick: false, hat: false, pluck: "arp" },
  tense: { bpm: MOOD_BPM.tense, chords: [[50, 53, 57], [50, 53, 58], [46, 50, 53], [45, 49, 52]], kick: true, hat: false, pluck: "pulse" },
  upbeat: { bpm: MOOD_BPM.upbeat, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], kick: true, hat: true, pluck: "arp" },
};

for (const name of moods) {
  const mood = MOODS[name] ?? MOODS.calm;
  const beat = 60 / mood.bpm, bar = beat * 4, cycle = bar * 2 * mood.chords.length;
  const longest = Math.max(...timeline.music.segments.filter((m) => m.mood === name).map((m) => m.durationInFrames / timeline.fps));
  const total = Math.max(1, Math.ceil(Math.min(longest, 120) / cycle)) * cycle;
  const N = secs(total), out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const chord = mood.chords[Math.floor(t / (bar * 2)) % mood.chords.length];
    const inBar = (t % (bar * 2)) / (bar * 2);
    // pad: two detuned sines per note, swell per chord (silent at chord edges, so the loop point is seamless)
    const swell = Math.min(1, inBar * 6) * Math.min(1, (1 - inBar) * 8);
    let s = 0;
    for (const n of chord) s += Math.sin(2 * Math.PI * hz(n) * t) + Math.sin(2 * Math.PI * hz(n) * 1.004 * t);
    s *= 0.05 * swell;
    s += Math.sin(2 * Math.PI * hz(chord[0] - 12) * t) * 0.16 * swell;
    const eighth = beat / 2, te = t % eighth, step = Math.floor(t / eighth);
    if (mood.pluck === "pulse") s += Math.sin(2 * Math.PI * hz(chord[0]) * t) * Math.exp(-te * 22) * 0.12;
    else s += Math.sin(2 * Math.PI * hz(chord[step % chord.length] + 12) * t) * Math.exp(-te * 14) * 0.06;
    const tb = t % beat;
    if (mood.kick) s += Math.sin(2 * Math.PI * (45 + 80 * Math.exp(-tb * 35)) * tb) * Math.exp(-tb * 9) * 0.35;
    if (mood.hat && step % 2 === 1) s += rand() * Math.exp(-te * 90) * 0.05;
    out[i] = s;
  }
  fs.writeFileSync(path.join(OUT, `bed-${name}.wav`), wav(out));
  log("audio", `music loop: ${name} @ ${mood.bpm} BPM, ${total.toFixed(1)}s`);
}
