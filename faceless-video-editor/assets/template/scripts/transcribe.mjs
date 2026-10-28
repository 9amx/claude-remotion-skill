// Use your OWN voiceover recording instead of TTS (voice.provider = "file").
// Transcribes public/<voice.file> locally with whisper.cpp, splits it into the
// scenes of project.json, and writes the same per-scene files voiceover.py does:
//   public/vo/<scene>.mp3 + build/vo/<scene>.json
// First run compiles whisper.cpp and downloads the model (needs git, make, a C++ compiler).
import fs from "node:fs";
import path from "node:path";
import { BUILD, PUBLIC, ROOT, ffmpeg as runFfmpeg, fail, log, probeDuration, readProject, sceneId, splitIntoScenes, tightenSegments, writeJson } from "./lib.mjs";

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
// Pauses longer than this are cut down (jump cut on dead air). 0 disables.
const maxPause = v.tightenPauses === false ? 0 : (v.maxPauseMs ?? 400);
const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
fs.mkdirSync(path.join(PUBLIC, "vo"), { recursive: true });
let removed = 0;
for (let i = 0; i < sceneTokens.length; i++) {
  const sw = words.slice(bounds[i], bounds[i + 1]);
  if (!sw.length) fail(`Scene ${i + 1} got no words. Does the recording match the script?`);
  // Put the script's *highlight* markup back on the matching transcribed words.
  for (const tok of sceneTokens[i].filter((t) => t.includes("*"))) {
    const w = sw.find((x) => !x.text.includes("*") && norm(x.text) === norm(tok));
    if (w) w.text = `*${w.text.replace(/\*/g, "")}*`;
  }
  const next = words[bounds[i + 1]];
  const start = i === 0 ? Math.max(0, sw[0].startMs - 120) : Math.round((words[bounds[i] - 1].endMs + sw[0].startMs) / 2);
  const end = next ? Math.round((sw[sw.length - 1].endMs + next.startMs) / 2) : totalMs;
  const id = sceneId(i);
  const out = path.join(PUBLIC, "vo", `${id}.mp3`);
  let durationMs = end - start;
  let timed = sw.map((w) => ({ text: w.text, startMs: w.startMs - start, endMs: w.endMs - start }));
  const t = maxPause ? tightenSegments(sw, start, end, maxPause) : null;
  if (t && t.segments.length > 1) {
    // atrim each kept segment, concat; short fades hide the joins.
    const parts = t.segments.map(([a, b], k) =>
      `[0:a]atrim=start=${(a / 1000).toFixed(3)}:end=${(b / 1000).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${((b - a) / 1000 - 0.02).toFixed(3)}:d=0.02[p${k}]`);
    const graph = `${parts.join(";")};${t.segments.map((_, k) => `[p${k}]`).join("")}concat=n=${t.segments.length}:v=0:a=1[out]`;
    ffmpeg(["-i", input, "-filter_complex", graph, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "2", out]);
    removed += durationMs - t.durationMs;
    durationMs = t.durationMs;
    timed = t.words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
  } else {
    ffmpeg(["-ss", String(start / 1000), "-to", String(end / 1000), "-i", input, "-c:a", "libmp3lame", "-q:a", "2", out]);
  }
  writeJson(path.join(BUILD, "vo", `${id}.json`), { key: "file", audio: `vo/${id}.mp3`, durationMs, words: timed });
  log("transcribe", `${id} ${(durationMs / 1000).toFixed(2)}s  "${sw.map((w) => w.text).join(" ").slice(0, 60)}"`);
}
if (removed > 0) log("transcribe", `tightened ${(removed / 1000).toFixed(1)}s of pauses longer than ${maxPause}ms`);
