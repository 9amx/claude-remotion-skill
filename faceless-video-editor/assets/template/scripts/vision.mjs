// Look at the picture: does this frame show what the line says? CLIP (runs on the CPU, no Python,
// no API: @huggingface/transformers, an optional dependency; ~150 MB model downloaded once to
// %LOCALAPPDATA%/faceless-video/models). Without the package every function returns null and the
// pipeline works as before, on words only.
//
// Score = how much CLIP prefers "a photo of <keyword>" over junk descriptions (meme, phone video with
// blurred borders, text overlay, talking head, cartoon, game, toy, blank, logo) and the keyword's own
// "-word" negatives. 0-1; real footage of the thing scores ~0.7-1, a meme or a toy model under 0.3.
// It sees objects, scenes and actions; it can't read a year or tell a 1993 car from a 1998 one, and
// can't tell AI footage from real - that's what the frame check by eye and the license flags are for.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILD, ffmpeg, probeDuration, sha1 } from "./lib.mjs";

const MODEL = process.env.VISION_MODEL || "Xenova/clip-vit-base-patch32";
const JUNK = ["a meme with a cartoon face", "a vertical phone video with blurred borders", "an edited video with big text overlays", "a person talking to the camera",
  "a cartoon or animation", "a video game screenshot", "a toy or scale model", "a blank or black screen", "a logo or title card"];

// Near misses: when the keyword is about an action or a part, the frame must beat the plain version of the
// subject too - "car drag race" vs a car just driving down a street; "2JZ engine" vs the outside of a car.
const CONTRAST = [
  [/\b(drag|race|racing|drift|drifting|burnout|track|circuit|lap|rally|time attack|wheelie|launch control)\b/i, ["a car driving on a normal street", "a parked car"]],
  [/\b(crash|crashed|accident|wreck|collision|rollover|totaled)\b/i, ["an undamaged car driving", "a parked car"]],
  [/\b(factory|assembly|production line|manufactur\w*|plant|robots?)\b/i, ["a car driving on a road", "a car in a showroom"]],
  [/\b(engine|motor|turbo|supercharger|engine bay|v8|v12|v6|2jz|rb26)\b/i, ["the outside of a car", "a car driving on a road"]],
  [/\b(interior|dashboard|cockpit|steering wheel|cabin|seats?)\b/i, ["the outside of a car", "a car driving on a road"]],
  [/\b(showroom|dealership|car show|auto show|motor show)\b/i, ["a car driving on a road", "a parked car on a street"]],
  [/\b(rocket launch|liftoff|lift-off|launching)\b/i, ["a rocket standing still on the launch pad", "a sky with clouds"]],
  [/\b(fire|burning|flames|explosion|exploding)\b/i, ["a normal scene without fire"]],
  [/\b(crowd|protest|rally|audience|fans)\b/i, ["an empty street", "an empty stadium"]],
];
const contrastFor = (q) => CONTRAST.filter(([re]) => re.test(q)).flatMap(([, c]) => c);

let state = null; // null = not tried, false = unavailable, object = loaded
async function load() {
  if (state !== null) return state;
  try {
    const t = await import("@huggingface/transformers");
    t.env.cacheDir = process.env.VISION_CACHE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache"), "faceless-video", "models");
    // One at a time: loading the parts in parallel trips over the shared download cache on Windows.
    const proc = await t.AutoProcessor.from_pretrained(MODEL);
    const tok = await t.AutoTokenizer.from_pretrained(MODEL);
    const vis = await t.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "q8" });
    const txt = await t.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "q8" });
    state = { t, proc, tok, vis, txt, text: new Map() };
  } catch (e) {
    state = false;
    if (!/Cannot find (package|module)/i.test(e.message)) console.log(`[vision] off: ${e.message}`);
  }
  return state;
}
export const visionReady = async () => !!(await load());

const unit = (t) => {
  const d = t.dims[1], out = [];
  for (let i = 0; i < t.dims[0]; i++) { const r = Array.from(t.data.slice(i * d, i * d + d)); const n = Math.hypot(...r) || 1; out.push(r.map((x) => x / n)); }
  return out;
};
async function textEmb(s, phrases) {
  const todo = phrases.filter((p) => !s.text.has(p));
  if (todo.length) unit((await s.txt(s.tok(todo, { padding: true, truncation: true }))).text_embeds).forEach((e, i) => s.text.set(todo[i], e));
  return phrases.map((p) => s.text.get(p));
}
// Keyword -> what CLIP should look for: no source prefix, no "-negatives", no numbers it can't see.
export function visualQuery(keyword) {
  const raw = String(keyword).replace(/^(photo|archive|yt|file|ai|adobe):/, "");
  const negatives = [...raw.matchAll(/(?:^|\s)-([\p{L}\p{N}][\p{L}\p{N}/-]*)/gu)].map((m) => m[1]);
  const query = raw.replace(/(?:^|\s)-[\p{L}\p{N}][\p{L}\p{N}/-]*/gu, " ").replace(/\s+/g, " ").trim();
  return { query, negatives };
}

// Scores of image files (jpg/png) against a keyword: [{ match, junk, junkScore }] or null without CLIP.
export async function scoreImages(files, keyword) {
  const s = await load();
  if (!s || !files.length) return null;
  const { query, negatives } = visualQuery(keyword);
  const junkPhrases = [...JUNK, ...contrastFor(query), ...negatives].map((j) => `a photo of ${j}`);
  const [pos, ...junk] = await textEmb(s, [`a photo of ${query}`, ...junkPhrases]);
  const out = [];
  for (const f of files) {
    try {
      const ie = unit((await s.vis(await s.proc(await s.t.RawImage.read(f)))).image_embeds)[0];
      const dot = (a) => a.reduce((acc, x, i) => acc + x * ie[i], 0);
      const ex = [dot(pos), ...junk.map(dot)].map((v) => Math.exp(100 * v));
      const Z = ex.reduce((a, b) => a + b, 0);
      let k = 0;
      for (let i = 1; i < junk.length; i++) if (ex[i + 1] > ex[k + 1]) k = i;
      out.push({ match: +(ex[0] / Z).toFixed(3), junk: junkPhrases[k].slice(11), junkScore: +(ex[k + 1] / Z).toFixed(3) });
    } catch { out.push(null); }
  }
  return out;
}

// Frames of a video (or the image itself) at given times, as small jpgs in a temp folder.
const TMP = path.join(BUILD, "vision-tmp");
function frames(file, times) {
  fs.mkdirSync(TMP, { recursive: true });
  const tag = sha1(`${file}|${fs.statSync(file).mtimeMs}`);
  return times.map((t) => {
    const out = path.join(TMP, `${tag}-${t.toFixed(2)}.jpg`);
    if (!fs.existsSync(out)) ffmpeg(["-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=-2:256", "-q:v", "4", out]);
    return out;
  }).filter((f) => fs.existsSync(f));
}
// Evenly spaced frames in one ffmpeg pass (a scan of a long video): [{ t, file }].
function framesEvery(file, from, to, step) {
  fs.mkdirSync(TMP, { recursive: true });
  const tag = `${sha1(`${file}|${fs.statSync(file).mtimeMs}|${from}|${to}|${step}`)}-scan`;
  const list = () => fs.readdirSync(TMP).filter((f) => f.startsWith(tag)).sort();
  if (!list().length) ffmpeg(["-ss", from.toFixed(2), "-t", (to - from).toFixed(2), "-i", file, "-vf", `fps=1/${step.toFixed(3)},scale=-2:256`, "-q:v", "4", path.join(TMP, `${tag}-%05d.jpg`)]);
  return list().map((f, i) => ({ t: from + (i + 0.5) * step, file: path.join(TMP, f) }));
}
export const clearVisionTmp = () => fs.rmSync(TMP, { recursive: true, force: true });

// Does this clip / image show the keyword? { score (mean of 3 frames), worst, junk } or null.
export async function checkMedia(file, keyword, { video = true, duration } = {}) {
  if (!(await load())) return null;
  const d = video ? duration ?? probeDuration(file) ?? 0 : 0;
  const imgs = video ? frames(file, d ? [0.2, 0.5, 0.8].map((f) => d * f) : [0]) : [file];
  const sc = (await scoreImages(imgs, keyword))?.filter(Boolean);
  if (!sc?.length) return null;
  const mean = sc.reduce((a, b) => a + b.match, 0) / sc.length;
  const worst = sc.reduce((a, b) => (b.match < a.match ? b : a));
  return { score: +mean.toFixed(2), worst: worst.match, junk: worst.junkScore > 0.3 ? worst.junk : null };
}

// The best stretch of `len` seconds inside a long video for a keyword: frames every `step` s
// (at most 240), each scored, the window with the highest mean wins. { start, score, scanned } or null.
export async function bestMoment(file, keyword, len, { step, duration, from = 0, to } = {}) {
  if (!(await load())) return null;
  const d = duration ?? probeDuration(file) ?? 0;
  const end = Math.min(to ?? d, d);
  if (end - from <= len + 1) return null;
  const st = step ?? Math.max(1, (end - from) / 240);
  const fr = framesEvery(file, from, end, st);
  if (!fr.length) return null;
  const times = fr.map((f) => f.t);
  const sc = await scoreImages(fr.map((f) => f.file), keyword);
  if (!sc) return null;
  const val = sc.map((x) => x?.match ?? 0);
  const w = Math.max(1, Math.round(len / st));
  let best = { i: 0, m: -1 };
  for (let i = 0; i + w <= val.length; i++) {
    // Mean, but one bad frame inside the window (a cut to something else) pulls it down hard.
    const win = val.slice(i, i + w), m = win.reduce((a, b) => a + b, 0) / w - 0.5 * Math.max(0, 0.3 - Math.min(...win));
    if (m > best.m) best = { i, m };
  }
  return { start: +Math.max(0, times[best.i] - st / 2).toFixed(2), score: +best.m.toFixed(2), scanned: times.length };
}
