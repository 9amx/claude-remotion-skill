// Use your OWN voiceover recording instead of TTS (voice.provider = "file").
// 1. Cleans it (voice.enhance, default on): rumble cut, noise reduction and a soft gate set
//    from the measured noise floor, de-essing, gentle compression, linear -16 LUFS ->
//    build/voice-clean.wav. Needs a system ffmpeg for the full chain; Remotion's bundled
//    one only levels the loudness. voice.enhanceChain replaces the filter chain.
// 2. Word timestamps, from one of:
//    voice.transcript    a transcript you already have, in public/ (ElevenLabs Speech-to-Text
//                        JSON or OpenAI verbose_json with word timestamps): nothing to transcribe
//    voice.transcriber   "local" (default): whisper.cpp here; the first run compiles it (git,
//                        make, a C++ compiler) and downloads the model from huggingface.co
//                        "elevenlabs": ElevenLabs Scribe (ELEVENLABS_API_KEY), strongest for Bengali / Hindi
//                        "openai": OpenAI whisper-1 (OPENAI_API_KEY), recordings up to ~70 minutes
//    Cached in build/transcript.json until the recording or these settings change.
// 3. Splits it into the scenes of project.json, jump-cuts dead air, and writes the same
//    per-scene files voiceover.py does: public/vo/<scene>.mp3 + build/vo/<scene>.json
import fs from "node:fs";
import path from "node:path";
import { BUILD, PUBLIC, ROOT, ffmpeg as runFfmpeg, fail, log, probeDuration, readJson, readProject, sceneId, sha1, splitIntoScenes, tightenSegments, writeJson } from "./lib.mjs";

const WHISPER_VERSION = "1.7.5";
const project = readProject();
const v = project.voice;
if (v.provider !== "file") fail('transcribe only runs when voice.provider is "file".');
if (!v.file) fail('Set voice.file to your recording, e.g. "my-voice.mp3" (placed in public/).');
const input = path.join(PUBLIC, v.file);
if (!fs.existsSync(input)) fail(`Recording not found: ${input}`);

const ffmpeg = (args) => {
  if (runFfmpeg(args).status !== 0) fail(`ffmpeg failed: ${args.join(" ")}`);
};
fs.mkdirSync(BUILD, { recursive: true });
const stat = fs.statSync(input);
const inputKey = `${v.file}:${stat.size}:${stat.mtimeMs}`;
const lang = v.language || null;

// ---------- 1. clean the recording ----------
// Measured, not guessed: the noise floor (quietest 50 ms windows) sets the
// noise reduction and a soft gate that pulls pauses down without chopping
// quiet words; then de-essing and gentle compression, and finally a LINEAR
// two-pass loudness normalization (a dynamic one would lift the noise again).
function noiseFloorDb(file) {
  const stats = path.join(BUILD, "voice-rms.txt");
  const r = runFfmpeg(["-i", file, "-af", `astats=metadata=1:reset=1:length=0.05,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${stats}`, "-f", "null", "-"], { capture: true });
  if (r.status !== 0 || !fs.existsSync(stats)) return null;
  const v = [...fs.readFileSync(stats, "utf8").matchAll(/RMS_level=(-?[\d.]+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  fs.rmSync(stats, { force: true });
  return v.length ? v[Math.floor(v.length / 10)] : null;
}
function loudnorm(src, dest) {
  const target = "I=-16:TP=-1.5:LRA=11";
  const m = runFfmpeg(["-i", src, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { capture: true });
  const json = /\{[^{}]*"input_i"[^{}]*\}/.exec(m.stderr || "");
  let af = `loudnorm=${target}`;
  if (json) {
    const x = JSON.parse(json[0]);
    af += `:measured_I=${x.input_i}:measured_TP=${x.input_tp}:measured_LRA=${x.input_lra}:measured_thresh=${x.input_thresh}:offset=${x.target_offset}:linear=true`;
  }
  ffmpeg(["-i", src, "-af", af, "-ar", "48000", "-ac", "1", dest]);
}
let source = input;
if (v.enhance !== false) {
  const clean = path.join(BUILD, "voice-clean.wav");
  const stamp = path.join(BUILD, "voice-clean.key");
  const key = sha1(inputKey + JSON.stringify(v.enhanceChain ?? "auto-v2"));
  if (!(fs.existsSync(clean) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8") === key)) {
    const floor = noiseFloorDb(input);
    const nf = Math.max(-70, Math.min(-25, Math.round(floor ?? -50)));
    const gate = Math.pow(10, (Math.min(-20, nf + 10)) / 20).toFixed(4); // 10 dB over the noise
    const chain = v.enhanceChain ?? [
      "highpass=f=80",
      `afftdn=nr=15:nf=${nf}:tn=1`,
      `agate=threshold=${gate}:ratio=3:range=0.12:attack=5:release=180`,
      "deesser=i=0.3",
      "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=150",
    ].join(",");
    const tmp = path.join(BUILD, "voice-clean.tmp.wav");
    if (runFfmpeg(["-i", input, "-vn", "-af", chain, "-ar", "48000", "-ac", "1", tmp], { capture: true }).status === 0) {
      loudnorm(tmp, clean);
      fs.rmSync(tmp, { force: true });
      log("transcribe", `cleaned the recording: noise floor ${floor?.toFixed(0) ?? "?"} dB -> reduced and gated, de-essed, compressed, -16 LUFS`);
    } else {
      log("transcribe", "the full cleanup needs a system ffmpeg (noise reduction, gate, de-esser, compressor) - only levelling the loudness");
      loudnorm(input, clean);
    }
    fs.writeFileSync(stamp, key);
  }
  source = clean;
}

// ---------- 2. word timestamps ----------
const fromElevenLabs = (j) => (j.words ?? []).filter((w) => w.type === "word" && w.text.trim())
  .map((w) => ({ text: w.text.trim(), startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000) }));
const fromOpenAI = (j) => (j.words ?? []).filter((w) => w.word.trim())
  .map((w) => ({ text: w.word.trim(), startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000) }));

function fromTranscriptFile(file) {
  const abs = [path.join(PUBLIC, file), path.resolve(ROOT, file)].find((f) => fs.existsSync(f));
  if (!abs) fail(`voice.transcript ${file} not found in public/`);
  const j = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (Array.isArray(j.words) && j.words[0]?.type) return fromElevenLabs(j);
  if (Array.isArray(j.words) && j.words[0] && "word" in j.words[0]) return fromOpenAI(j);
  // ElevenLabs "segmented JSON" export with words per segment
  const segWords = (j.segments ?? []).flatMap((sg) => sg.words ?? []);
  if (segWords.length) return segWords.map((w) => ({ text: w.text.trim(), startMs: Math.round(w.start_time * 1000), endMs: Math.round(w.end_time * 1000) })).filter((w) => w.text);
  fail(`${file} has no word timestamps. Export ElevenLabs Speech-to-Text JSON, or OpenAI verbose_json with timestamp_granularities "word".`);
}

async function apiTranscribe(kind) {
  const envKey = kind === "openai" ? "OPENAI_API_KEY" : "ELEVENLABS_API_KEY";
  const key = process.env[envKey];
  if (!key) fail(`voice.transcriber "${kind}" needs ${envKey} in the environment.`);
  // Small upload: speech needs no more than mono 16 kHz.
  const up = path.join(BUILD, "voice-upload.mp3");
  ffmpeg(["-i", source, "-ac", "1", "-ar", "16000", "-b:a", "48k", up]);
  const size = fs.statSync(up).size;
  if (kind === "openai" && size > 25 * 1024 * 1024) fail(`the recording is ${(size / 1048576).toFixed(0)} MB compressed, over OpenAI's 25 MB limit: use "elevenlabs" or "local".`);
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(up)], { type: "audio/mpeg" }), "voice.mp3");
  let url, headers;
  if (kind === "openai") {
    [url, headers] = ["https://api.openai.com/v1/audio/transcriptions", { Authorization: `Bearer ${key}` }];
    form.append("model", v.transcribeModel ?? "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    if (lang) form.append("language", lang);
  } else {
    [url, headers] = ["https://api.elevenlabs.io/v1/speech-to-text", { "xi-api-key": key }];
    form.append("model_id", v.transcribeModel ?? "scribe_v1");
    form.append("timestamps_granularity", "word");
    form.append("tag_audio_events", "false");
    if (lang) form.append("language_code", lang);
  }
  log("transcribe", `sending ${(size / 1048576).toFixed(1)} MB to ${kind} for word timestamps`);
  let r;
  try {
    r = await fetch(url, { method: "POST", headers, body: form });
  } catch (e) {
    fail(`could not reach ${new URL(url).host} (${e.message}) - in a cloud session, allow that host in the environment's network settings.`);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(`${kind} transcription failed (${r.status}): ${j.error?.message ?? j.detail?.message ?? JSON.stringify(j.detail ?? j).slice(0, 200)}`);
  return kind === "openai" ? fromOpenAI(j) : fromElevenLabs(j);
}

async function localTranscribe() {
  let whisper;
  try {
    whisper = await import("@remotion/install-whisper-cpp");
  } catch {
    fail("Run: npm i @remotion/install-whisper-cpp");
  }
  const whisperDir = path.join(ROOT, ".whisper");
  // Word timings drive every cut, so accuracy beats speed: large-v3-turbo for
  // Bengali / Hindi / other languages, medium.en for English.
  const model = v.whisperModel || (lang && lang !== "en" ? "large-v3-turbo" : "medium.en");
  log("transcribe", `whisper.cpp ${WHISPER_VERSION}, model ${model} (cached after the first run)`);
  // The installer skips any folder that exists, so an interrupted first install
  // (no whisper binary inside) would fail forever: clear it, keep downloaded models.
  const hasBinary = (dir, depth = 0) => fs.existsSync(dir) && fs.readdirSync(dir, { withFileTypes: true }).some((e) =>
    e.isFile() ? /^(whisper-cli|main)(\.exe)?$/.test(e.name) : depth < 4 && e.isDirectory() && hasBinary(path.join(dir, e.name), depth + 1));
  if (fs.existsSync(whisperDir) && !hasBinary(whisperDir)) {
    for (const e of fs.readdirSync(whisperDir)) if (!/^ggml-.*\.bin$/.test(e)) fs.rmSync(path.join(whisperDir, e), { recursive: true, force: true });
    const models = fs.readdirSync(whisperDir);
    if (models.length) {
      const keep = path.join(BUILD, "whisper-models");
      fs.mkdirSync(keep, { recursive: true });
      for (const m of models) fs.renameSync(path.join(whisperDir, m), path.join(keep, m));
    }
    fs.rmSync(whisperDir, { recursive: true, force: true });
    log("transcribe", "whisper.cpp install was incomplete - building it again");
  }
  try {
    await whisper.installWhisperCpp({ to: whisperDir, version: WHISPER_VERSION, printOutput: false });
    const kept = path.join(BUILD, "whisper-models");
    if (fs.existsSync(kept)) {
      for (const m of fs.readdirSync(kept)) fs.renameSync(path.join(kept, m), path.join(whisperDir, m));
      fs.rmSync(kept, { recursive: true, force: true });
    }
  } catch (e) {
    fail(`could not build whisper.cpp (${e.message}). It needs git, make and a C++ compiler - or set voice.transcriber to "elevenlabs" / "openai", or give voice.transcript.`);
  }
  // A failed download leaves a broken file the next run would trip over: remove it.
  // printOutput must stay on: without it the library accepts a model file of the
  // wrong size (an interrupted download) and whisper then fails with "bad magic".
  const modelFile = path.join(whisperDir, `ggml-${model}.bin`);
  const download = () => whisper.downloadWhisperModel({ model, folder: whisperDir, printOutput: true });
  try {
    await download().catch(async (e) => {
      if (!/already exists/.test(e.message)) throw e;
      fs.rmSync(modelFile, { force: true });
      log("transcribe", `removed an incomplete ${model} model, downloading again`);
      await download();
    });
  } catch (e) {
    fs.rmSync(modelFile, { force: true });
    fail(`could not download the ${model} model (${e.message}). It comes from huggingface.co: allow that host, or use voice.transcriber "elevenlabs" / "openai", or voice.transcript.`);
  }
  const wav = path.join(BUILD, "voice-16k.wav");
  ffmpeg(["-i", source, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  // Token-level timestamps split Bengali / Hindi letters (several UTF-8 bytes per
  // letter, one token can end mid-letter) into broken characters. For those
  // languages whisper.cpp itself cuts the text into one segment per word
  // (--max-len 1 --split-on-word), so every word arrives whole with its timing.
  const wordSegments = !!lang && lang !== "en";
  const out = await whisper.transcribe({
    inputPath: wav,
    whisperPath: whisperDir,
    whisperCppVersion: WHISPER_VERSION,
    model,
    modelFolder: whisperDir,
    language: lang,
    printOutput: false,
    ...(wordSegments ? { tokenLevelTimestamps: false, tokensPerItem: 1, splitOnWord: true } : { tokenLevelTimestamps: true }),
  });
  const pieces = wordSegments
    // A word cut off at the very end of the audio can still end mid-letter (U+FFFD): drop that part.
    ? out.transcription.map((s) => ({ text: s.text.replace(/\uFFFD/g, ""), startMs: s.offsets.from, endMs: s.offsets.to }))
    : whisper.toCaptions({ whisperCppOutput: out }).captions;
  // Merge sub-word pieces (no leading space) into whole words.
  const merged = [];
  for (const c of pieces) {
    const text = c.text;
    if (!text.trim() || /^\[.*\]$/.test(text.trim())) continue;
    if (merged.length && !/^\s/.test(text)) {
      const last = merged[merged.length - 1];
      last.text += text;
      last.endMs = c.endMs;
    } else {
      merged.push({ text: text.trim(), startMs: c.startMs, endMs: c.endMs });
    }
  }
  return merged;
}

const transcriber = v.transcript ? "transcript file" : (v.transcriber ?? "local");
if (!["transcript file", "local", "openai", "elevenlabs"].includes(transcriber)) fail(`voice.transcriber "${transcriber}" - use local, elevenlabs or openai`);
const cacheFile = path.join(BUILD, "transcript.json");
const tKey = sha1(JSON.stringify([inputKey, transcriber, v.transcript ?? null, v.whisperModel ?? null, v.transcribeModel ?? null, lang, v.enhance !== false]));
const cached = readJson(cacheFile, null);
let words;
if (cached?.key === tKey) {
  words = cached.words;
  log("transcribe", `${words.length} words from the cached ${transcriber} transcript`);
} else {
  words = transcriber === "transcript file" ? fromTranscriptFile(v.transcript)
    : transcriber === "local" ? await localTranscribe() : await apiTranscribe(transcriber);
  if (words.length) writeJson(cacheFile, { key: tKey, transcriber, words });
}
if (!words.length) fail(`No words from the ${transcriber} transcript. Is the recording silent, or the language wrong (voice.language)?`);

const sceneTokens = project.scenes.map((s) => s.text.trim().split(/\s+/));
const { bounds, matched, perScene } = splitIntoScenes(words, sceneTokens);
const scriptLen = sceneTokens.flat().length;
log("transcribe", `${words.length} words transcribed, ${Math.round((matched / scriptLen) * 100)}% matched to the script`);
if (matched / scriptLen < 0.6) log("transcribe", "low match: does project.json contain what was actually said?");
// Scenes the recording says differently: their cuts are estimated, check them in the sync report.
const off = perScene.map((r, i) => [r, i]).filter(([r]) => r < 0.5);
if (off.length) log("transcribe", `said differently from the script (cuts estimated): ${off.map(([r, i]) => `scene ${i + 1} (${Math.round(r * 100)}%)`).join(", ")}`);

const totalMs = Math.round((probeDuration(source) ?? words[words.length - 1].endMs / 1000 + 0.5) * 1000);
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
  // Always cut with tightening on: it also trims dead air at the scene's edges.
  if (t) {
    // atrim each kept segment, concat; short fades hide the joins.
    const parts = t.segments.map(([a, b], k) =>
      `[0:a]atrim=start=${(a / 1000).toFixed(3)}:end=${(b / 1000).toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${((b - a) / 1000 - 0.02).toFixed(3)}:d=0.02[p${k}]`);
    const graph = `${parts.join(";")};${t.segments.map((_, k) => `[p${k}]`).join("")}concat=n=${t.segments.length}:v=0:a=1[out]`;
    ffmpeg(["-i", source, "-filter_complex", graph, "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "2", out]);
    removed += durationMs - t.durationMs;
    durationMs = t.durationMs;
    timed = t.words.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
  } else {
    ffmpeg(["-ss", String(start / 1000), "-to", String(end / 1000), "-i", source, "-c:a", "libmp3lame", "-q:a", "2", out]);
  }
  writeJson(path.join(BUILD, "vo", `${id}.json`), { key: "file", audio: `vo/${id}.mp3`, durationMs, words: timed });
  log("transcribe", `${id} ${(durationMs / 1000).toFixed(2)}s  "${sw.map((w) => w.text).join(" ").slice(0, 60)}"`);
}
if (removed > 0) log("transcribe", `tightened ${(removed / 1000).toFixed(1)}s of pauses longer than ${maxPause}ms`);
