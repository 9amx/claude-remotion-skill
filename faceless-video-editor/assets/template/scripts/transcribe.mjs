// Use your OWN voiceover recording instead of TTS (voice.provider = "file").
// Transcribes public/<voice.file> locally with whisper.cpp, splits it into the
// scenes of project.json, and writes the same per-scene files voiceover.py does:
//   public/vo/<scene>.mp3 + build/vo/<scene>.json
// First run compiles whisper.cpp and downloads the model (needs git, make, a C++ compiler).
import fs from "node:fs";
import path from "node:path";
import { BUILD, PUBLIC, ROOT, ffmpeg as runFfmpeg, fail, log, probeDuration, readProject, sceneId, splitIntoScenes, writeJson } from "./lib.mjs";

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
  if (runFfmpeg(args).status !== 0) fail(`ffmpeg failed: ${args.join(" ")}`);
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

const sceneTokens = project.scenes.map((s) => s.text.trim().split(/\s+/));
const { bounds, matched } = splitIntoScenes(words, sceneTokens);
const scriptLen = sceneTokens.flat().length;
log("transcribe", `${words.length} words transcribed, ${Math.round((matched / scriptLen) * 100)}% matched to the script`);
if (matched / scriptLen < 0.6) log("transcribe", "low match: does project.json contain what was actually said?");

const totalMs = Math.round((probeDuration(input) ?? words[words.length - 1].endMs / 1000 + 0.5) * 1000);
fs.mkdirSync(path.join(PUBLIC, "vo"), { recursive: true });
for (let i = 0; i < sceneTokens.length; i++) {
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
