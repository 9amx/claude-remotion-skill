// Use your OWN voiceover recording instead of TTS (voice.provider = "file").
// Transcribes public/<voice.file> locally with whisper.cpp, splits it into the
// scenes of project.json, and writes the same per-scene files voiceover.py does:
//   public/vo/<scene>.mp3 + build/vo/<scene>.json
// First run compiles whisper.cpp and downloads the model (needs git, make, a C++ compiler).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BUILD, PUBLIC, ROOT, fail, hasCommand, log, probeDuration, readProject, sceneId, writeJson } from "./lib.mjs";

const WHISPER_VERSION = "1.7.5";
const project = readProject();
const v = project.voice;
if (v.provider !== "file") fail('transcribe only runs when voice.provider is "file".');
if (!v.file) fail('Set voice.file to your recording, e.g. "my-voice.mp3" (placed in public/).');
const input = path.join(PUBLIC, v.file);
if (!fs.existsSync(input)) fail(`Recording not found: ${input}`);

let whisper;
try {
  whisper = await import("@remotion/install-whisper-cpp");
} catch {
  fail("Run: npm i @remotion/install-whisper-cpp");
}

const ffmpeg = (args) => {
  const r = hasCommand("ffmpeg")
    ? spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" })
    : spawnSync("npx", ["remotion", "ffmpeg", "-y", "-v", "error", ...args], { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) fail(`ffmpeg failed: ${args.join(" ")}`);
};

const whisperDir = path.join(ROOT, ".whisper");
const model = v.whisperModel || (v.language && v.language !== "en" ? "small" : "base.en");
log("transcribe", `whisper.cpp ${WHISPER_VERSION}, model ${model}`);
await whisper.installWhisperCpp({ to: whisperDir, version: WHISPER_VERSION, printOutput: false });
await whisper.downloadWhisperModel({ model, folder: whisperDir, printOutput: false });

fs.mkdirSync(BUILD, { recursive: true });
const wav = path.join(BUILD, "voice-16k.wav");
ffmpeg(["-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);

const out = await whisper.transcribe({
  inputPath: wav,
  whisperPath: whisperDir,
  whisperCppVersion: WHISPER_VERSION,
  model,
  modelFolder: whisperDir,
  tokenLevelTimestamps: true,
  language: v.language || null,
  printOutput: false,
});
const { captions } = whisper.toCaptions({ whisperCppOutput: out });

// Merge sub-word tokens (no leading space) into whole words.
const words = [];
for (const c of captions) {
  const text = c.text;
  if (!text.trim() || /^\[.*\]$/.test(text.trim())) continue;
  if (words.length && !text.startsWith(" ")) {
    const last = words[words.length - 1];
    last.text += text;
    last.endMs = c.endMs;
  } else {
    words.push({ text: text.trim(), startMs: c.startMs, endMs: c.endMs });
  }
}
if (!words.length) fail("Whisper returned no words. Is the recording silent?");

// Split transcribed words into scenes proportionally to the script, snapping each
// boundary to the longest pause within +-3 words so cuts land between sentences.
const counts = project.scenes.map((s) => s.text.trim().split(/\s+/).length);
const totalScript = counts.reduce((a, b) => a + b, 0);
const bounds = [0];
let cum = 0;
for (let i = 0; i < counts.length - 1; i++) {
  cum += counts[i];
  const guess = Math.round((cum / totalScript) * words.length);
  let best = guess, bestGap = -1;
  for (let k = Math.max(bounds[i] + 1, guess - 3); k <= Math.min(words.length - 1, guess + 3); k++) {
    const gap = words[k].startMs - words[k - 1].endMs;
    if (gap > bestGap) [best, bestGap] = [k, gap];
  }
  bounds.push(best);
}
bounds.push(words.length);

const totalMs = Math.round((probeDuration(input) ?? words[words.length - 1].endMs / 1000 + 0.5) * 1000);
fs.mkdirSync(path.join(PUBLIC, "vo"), { recursive: true });
for (let i = 0; i < counts.length; i++) {
  const sw = words.slice(bounds[i], bounds[i + 1]);
  if (!sw.length) fail(`Scene ${i + 1} got no words. Does the recording match the script?`);
  const next = words[bounds[i + 1]];
  const start = i === 0 ? Math.max(0, sw[0].startMs - 120) : Math.round((words[bounds[i] - 1].endMs + sw[0].startMs) / 2);
  const end = next ? Math.round((sw[sw.length - 1].endMs + next.startMs) / 2) : totalMs;
  const id = sceneId(i);
  ffmpeg(["-ss", String(start / 1000), "-to", String(end / 1000), "-i", input, "-c:a", "libmp3lame", "-q:a", "2", path.join(PUBLIC, "vo", `${id}.mp3`)]);
  writeJson(path.join(BUILD, "vo", `${id}.json`), {
    key: "file",
    audio: `vo/${id}.mp3`,
    durationMs: end - start,
    words: sw.map((w) => ({ text: w.text, startMs: w.startMs - start, endMs: w.endMs - start })),
  });
  log("transcribe", `${id} ${((end - start) / 1000).toFixed(2)}s  "${sw.map((w) => w.text).join(" ").slice(0, 60)}"`);
}
