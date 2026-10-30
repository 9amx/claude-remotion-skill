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
// Your own files are normalized into public/audio/user/: public/sfx/<slot>*.wav|mp3
// (kit replacements), beat sounds and ambience beds named in project.json, music.
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
    if (fs.existsSync(path.join(PUBLIC, src))) timeline.sfxPeaks[src] = alignMs(path.join(PUBLIC, src), PEAK_ALIGNED.has(slot) ? "peak" : "onset");
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
