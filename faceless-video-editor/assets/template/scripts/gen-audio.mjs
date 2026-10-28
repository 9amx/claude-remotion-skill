// Synthesize a royalty-free music bed (sized to the video) and an SFX kit.
// Zero downloads, deterministic. Skipped for the bed when music.file is set.
//   public/audio/bed.wav    mood: calm | tense | upbeat
//   public/audio/whoosh.wav scene transitions
//   public/audio/hit.wav    hook impact on frame 0
//   public/audio/pop.wav    emphasis text landing
import fs from "node:fs";
import path from "node:path";
import { PUBLIC, fail, log, readJson, readProject } from "./lib.mjs";

const SR = 44100;
const OUT = path.join(PUBLIC, "audio");
fs.mkdirSync(OUT, { recursive: true });

let seed = 1337;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const secs = (s) => Math.round(s * SR);
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function wav(samples) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.85 / peak : 1;
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * gain)) * 32767), 44 + i * 2));
  return buf;
}

// ---------- SFX ----------
{
  const N = secs(0.45), out = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    lp += (0.04 + 0.3 * Math.sin(Math.PI * t)) * (rand() - lp);
    out[i] = lp * Math.sin(Math.PI * t ** 0.6) ** 2;
  }
  fs.writeFileSync(path.join(OUT, "whoosh.wav"), wav(out));
}
{
  const N = secs(0.9), out = new Float32Array(N);
  let ph = 0, lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * (38 + 90 * Math.exp(-t * 18))) / SR;
    lp += 0.2 * (rand() - lp);
    out[i] = Math.sin(ph) * Math.exp(-t * 4.5) + lp * Math.exp(-t * 30) * 0.5;
  }
  fs.writeFileSync(path.join(OUT, "hit.wav"), wav(out));
}
{
  const N = secs(0.16), out = new Float32Array(N);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    ph += (2 * Math.PI * (820 - 450 * t)) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t * 8);
  }
  fs.writeFileSync(path.join(OUT, "pop.wav"), wav(out));
}

// ---------- music bed ----------
const project = readProject();
const timeline = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!timeline) fail("Run build-timeline first (the bed is sized to the video).");
if (timeline.music.src !== "audio/bed.wav") {
  log("audio", "SFX written; music bed skipped (using music.file or mood none).");
  process.exit(0);
}

const MOODS = {
  // chords as MIDI note sets, 2 bars each
  calm: { bpm: 84, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], kick: false, hat: false, pluck: "arp" },
  tense: { bpm: 100, chords: [[50, 53, 57], [50, 53, 58], [46, 50, 53], [45, 49, 52]], kick: true, hat: false, pluck: "pulse" },
  upbeat: { bpm: 118, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], kick: true, hat: true, pluck: "arp" },
};
const mood = MOODS[project.music.mood] ?? MOODS.calm;
const total = timeline.durationInFrames / timeline.fps + 1.5;
const N = secs(total), out = new Float32Array(N);
const beat = 60 / mood.bpm, bar = beat * 4;

for (let i = 0; i < N; i++) {
  const t = i / SR;
  const chord = mood.chords[Math.floor(t / (bar * 2)) % mood.chords.length];
  const inBar = (t % (bar * 2)) / (bar * 2);
  // pad: two detuned sines per note, slow swell per chord
  const swell = Math.min(1, inBar * 6) * (1 - Math.max(0, inBar - 0.9) * 6);
  let s = 0;
  for (const n of chord) s += Math.sin(2 * Math.PI * hz(n) * t) + Math.sin(2 * Math.PI * hz(n) * 1.004 * t);
  s *= 0.05 * swell;
  // sub bass on the root
  s += Math.sin(2 * Math.PI * hz(chord[0] - 12) * t) * 0.16 * swell;
  // rhythmic layer
  const eighth = beat / 2, te = t % eighth, step = Math.floor(t / eighth);
  if (mood.pluck === "pulse") s += Math.sin(2 * Math.PI * hz(chord[0]) * t) * Math.exp(-te * 22) * 0.12;
  else s += Math.sin(2 * Math.PI * hz(chord[step % chord.length] + 12) * t) * Math.exp(-te * 14) * 0.06;
  const tb = t % beat;
  if (mood.kick) s += Math.sin(2 * Math.PI * (45 + 80 * Math.exp(-tb * 35)) * tb) * Math.exp(-tb * 9) * 0.35;
  if (mood.hat && step % 2 === 1) s += rand() * Math.exp(-te * 90) * 0.05;
  // fade in / out
  out[i] = s * Math.min(1, t / 0.6) * Math.min(1, (total - t) / 1.5);
}
fs.writeFileSync(path.join(OUT, "bed.wav"), wav(out));
log("audio", `music bed: ${project.music.mood} @ ${mood.bpm} BPM, ${total.toFixed(1)}s`);
