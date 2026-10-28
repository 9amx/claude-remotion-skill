// Synthesize royalty-free music loops and an SFX kit.
// Zero downloads, deterministic. Music skipped when music.file is set.
//   public/audio/bed-<mood>.wav  mood: calm | tense | upbeat (one per mood in use)
//   public/audio/whoosh.wav scene transitions
//   public/audio/hit.wav    hook impact on frame 0
//   public/audio/pop.wav    emphasis text landing
//   public/audio/riser.wav  build into a reveal (fx "reveal")
//   public/audio/scratch.wav freeze frame (fx "freeze")
//   public/audio/glitch.wav glitch transition
//   public/audio/tick.wav   highlighted caption words
import fs from "node:fs";
import path from "node:path";
import { PUBLIC, ffmpeg, fail, log, readJson, userMusicPath, userSfx, userSfxPath } from "./lib.mjs";

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

{
  // riser: noise + tone sweeping up for 1.2s, stopping dead at the peak (the reveal lands on silence + hit)
  const N = secs(1.2), out = new Float32Array(N);
  let ph = 0, lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    ph += (2 * Math.PI * (180 + 900 * t * t)) / SR;
    lp += (0.02 + 0.4 * t * t) * (rand() - lp);
    out[i] = (Math.sin(ph) * 0.5 + lp) * t ** 2.2;
  }
  fs.writeFileSync(path.join(OUT, "riser.wav"), wav(out));
}
{
  // record scratch: fast pitch wobble on filtered noise (freeze frames)
  const N = secs(0.38), out = new Float32Array(N);
  let ph = 0, lp = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    ph += (2 * Math.PI * (300 + 700 * Math.sin(t * Math.PI * 3))) / SR;
    lp += 0.35 * (rand() - lp);
    out[i] = (Math.sin(ph) * 0.6 + lp * 0.7) * Math.sin(Math.PI * t) * (1 - t * 0.5);
  }
  fs.writeFileSync(path.join(OUT, "scratch.wav"), wav(out));
}
{
  // glitch: bit-crushed square buzz with stutters (glitch transitions)
  const N = secs(0.25), out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const gate = Math.floor(t * 40) % 3 !== 1 ? 1 : 0;
    const sq = Math.sign(Math.sin(2 * Math.PI * 220 * t)) * 0.4 + Math.round(rand() * 3) / 6;
    out[i] = sq * gate * Math.exp(-t * 6);
  }
  fs.writeFileSync(path.join(OUT, "glitch.wav"), wav(out));
}
{
  // tick: tiny click for highlighted caption words
  const N = secs(0.06), out = new Float32Array(N);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    ph += (2 * Math.PI * 2100) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t * 12);
  }
  fs.writeFileSync(path.join(OUT, "tick.wav"), wav(out));
}

// ---------- your own sound (public/sfx/, music files) ----------
// Pro libraries ship at very different levels; normalize so sfxLevel and
// music.volume mean the same thing whatever the source. Cached by mtime.
const timeline = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!timeline) fail("Run build-timeline first (beds are sized to the video).");
const fresh = (src, dest) => fs.existsSync(dest) && fs.statSync(dest).mtimeMs > fs.statSync(src).mtimeMs;
fs.mkdirSync(path.join(OUT, "user"), { recursive: true });
for (const files of Object.values(userSfx())) {
  for (const f of files) {
    const src = path.join(PUBLIC, "sfx", f), dest = path.join(PUBLIC, userSfxPath(f));
    if (fresh(src, dest)) continue;
    // Convert first (mono -> stereo changes the level), then measure and set the peak to -1 dBFS.
    const tmp = dest.replace(/\.wav$/, ".tmp.wav");
    if (ffmpeg(["-i", src, "-ar", "48000", "-ac", "2", tmp]).status !== 0) fail(`could not read public/sfx/${f}`);
    const m = /max_volume:\s*(-?[\d.]+) dB/.exec(ffmpeg(["-i", tmp, "-af", "volumedetect", "-f", "null", "-"], { capture: true }).stderr || "");
    const gain = m ? Math.min(20, -1 - parseFloat(m[1])) : 0; // cap: never blow up a near-silent file
    ffmpeg(["-i", tmp, "-af", `volume=${gain.toFixed(2)}dB`, dest]);
    fs.rmSync(tmp);
    log("audio", `own SFX: ${f} (${gain >= 0 ? "+" : ""}${gain.toFixed(1)} dB)`);
  }
}
for (const seg of timeline.music.segments.filter((m) => m.file)) {
  const src = path.join(PUBLIC, seg.file), dest = path.join(PUBLIC, userMusicPath(seg.file));
  if (fresh(src, dest)) continue;
  if (ffmpeg(["-i", src, "-vn", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k", dest]).status !== 0) fail(`could not read ${seg.file}`);
  log("audio", `own music: ${seg.file} (normalized to -14 LUFS)`);
}

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
  calm: { bpm: 84, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], kick: false, hat: false, pluck: "arp" },
  tense: { bpm: 100, chords: [[50, 53, 57], [50, 53, 58], [46, 50, 53], [45, 49, 52]], kick: true, hat: false, pluck: "pulse" },
  upbeat: { bpm: 118, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], kick: true, hat: true, pluck: "arp" },
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
