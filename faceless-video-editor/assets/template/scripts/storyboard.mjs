// Storyboard: the whole edit as pictures BEFORE the render. One tile per shot,
// in order: the picture it will show (a frame from the clip at the point the
// timeline plays, the still, or a card naming the graphic and its items) with
// the time and the exact words spoken over it printed underneath. Read it like
// a comic: every tile must show what its words say. Fix mismatches (a pick, a
// keyword, a graphic), re-run --from=broll, and only render once every tile passes.
//
// Writes build/storyboard/sb-<chapter>-<page>.jpg (5 x 4 tiles per page) and
// build/storyboard/storyboard.txt (the same list as text).
// Usage: node scripts/storyboard.mjs   (auto.mjs runs it after the timeline step)
import fs from "node:fs";
import path from "node:path";
import { BUILD, PUBLIC, ffmpeg, log, readJson, status, timecode } from "./lib.mjs";
const DRAWTEXT_FONT = process.platform === "win32" ? "fontfile='C\\\\:/Windows/Fonts/arial.ttf':" : "";

const t = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!t) {
  log("storyboard", "no public/timeline.json yet - run the timeline step first");
  process.exit(0);
}
const dir = path.join(BUILD, "storyboard");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, "tiles"), { recursive: true });

const TW = 480, TH = 270, BAND = 92;
const sec = (f) => f / t.fps;
// Wrap to two lines of ~44 characters for the caption band.
const wrap = (s, n = 44) => {
  const out = [""];
  for (const w of String(s).split(/\s+/)) {
    if ((out[out.length - 1] + " " + w).trim().length > n && out.length < 3) out.push("");
    out[out.length - 1] = (out[out.length - 1] + " " + w).trim();
  }
  return out.slice(0, 3).join("\n");
};
const itemsOf = (g) => (g.type === "compare" ? [...g.left.items, ...g.right.items] : g.items ?? []).map((it) => (typeof it === "string" ? it : it.text));
const graphicLabel = (g) => {
  const what = g.title ?? g.label ?? g.text ?? g.caption ?? (g.places ?? []).map((p) => p.name ?? p).join(", ");
  const items = itemsOf(g);
  return `${g.type.toUpperCase()}\n${what ?? ""}${items.length ? `\n${items.slice(0, 4).join(" / ")}` : ""}`;
};

const tiles = [];
const lines = ["tile  time         scene-shot  shows  <-  words"];
let n = 0;
for (const s of t.scenes) {
  s.shots.forEach((sh, k) => {
    n++;
    const at = s.startFrame + sh.from;
    const file = path.join(dir, "tiles", `${String(n).padStart(4, "0")}.jpg`);
    const words = path.join(dir, "tiles", `${n}.txt`);
    const head = `${n}  ${timecode(sec(at))}  ${s.id}-${k + 1}`;
    fs.writeFileSync(words, `${head}\n${wrap(sh.words ?? "")}`);
    const band = `pad=${TW}:${TH + BAND}:0:0:color=0x111111,drawtext=${DRAWTEXT_FONT}textfile='${words.replace(/\\/g, "/").replace(/:/g, "\\:")}':x=10:y=${TH + 8}:fontsize=17:fontcolor=white:line_spacing=4:expansion=none`;
    let shows, ok = false;
    if ((sh.type === "video" || sh.type === "image") && sh.src && fs.existsSync(path.join(PUBLIC, sh.src))) {
      // The frame the edit shows halfway through the shot (trimBefore + rate).
      const ss = sh.type === "video" ? (sh.trimBefore ?? 0) / t.fps + (sh.durationInFrames / 2 / t.fps) * (sh.playbackRate ?? 1) : 0;
      ok = ffmpeg([...(ss ? ["-ss", ss.toFixed(2)] : []), "-i", path.join(PUBLIC, sh.src), "-frames:v", "1", "-vf",
        `scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},${band}`, "-q:v", "4", file]).status === 0;
      shows = `${sh.type}${sh.move ? ` (${sh.move})` : ""} ${sh.keyword ?? sh.src}`;
    } else if (sh.type === "graphic" && sh.graphic) {
      const card = path.join(dir, "tiles", `${n}-g.txt`);
      fs.writeFileSync(card, graphicLabel(sh.graphic).split("\n").map((l) => wrap(l, 34)).join("\n").split("\n").slice(0, 7).join("\n"));
      ok = ffmpeg(["-f", "lavfi", "-i", `color=c=0x1c2340:s=${TW}x${TH}`, "-frames:v", "1", "-vf",
        `drawtext=${DRAWTEXT_FONT}textfile='${card.replace(/\\/g, "/").replace(/:/g, "\\:")}':x=20:y=20:fontsize=24:fontcolor=0xFFD60A:line_spacing=8:expansion=none,${band}`, "-q:v", "4", file]).status === 0;
      shows = `GRAPHIC ${graphicLabel(sh.graphic).replace(/\n/g, " | ")}`;
    } else {
      ok = ffmpeg(["-f", "lavfi", "-i", `color=c=0x7a1020:s=${TW}x${TH}`, "-frames:v", "1", "-vf",
        `drawtext=${DRAWTEXT_FONT}text='NO FOOTAGE - title card':x=20:y=20:fontsize=28:fontcolor=white,${band}`, "-q:v", "4", file]).status === 0;
      shows = "NO FOOTAGE (title card fallback) - fix before rendering";
    }
    if (!ok) ffmpeg(["-f", "lavfi", "-i", `color=c=gray:s=${TW}x${TH + BAND}`, "-frames:v", "1", file]);
    tiles.push({ file, chapter: s.chapter ?? 0 });
    lines.push(`${String(n).padStart(4)}  ${timecode(sec(at)).padEnd(11)}  ${(s.id + "-" + (k + 1)).padEnd(10)}  ${shows}  <-  "${sh.words ?? ""}"`);
  });
}

// Pages of 5 x 4, per chapter.
const sheets = [];
const chapters = [...new Set(tiles.map((x) => x.chapter))];
for (const c of chapters) {
  const list = tiles.filter((x) => x.chapter === c);
  for (let p = 0; p * 20 < list.length; p++) {
    const page = list.slice(p * 20, p * 20 + 20);
    const concat = path.join(dir, `list-${c}-${p}.txt`);
    fs.writeFileSync(concat, page.map((x) => `file '${x.file.replace(/\\/g, "/")}'\nduration 1`).join("\n") + "\n");
    const name = `sb-${String(c + 1).padStart(2, "0")}-${p + 1}.jpg`;
    ffmpeg(["-f", "concat", "-safe", "0", "-i", concat, "-vf", `tile=5x${Math.ceil(page.length / 5)}:padding=6:color=white`, "-frames:v", "1", "-q:v", "3", path.join(dir, name)]);
    sheets.push(name);
  }
}
fs.writeFileSync(path.join(dir, "storyboard.txt"), lines.join("\n") + "\n");
const missing = lines.filter((l) => l.includes("NO FOOTAGE")).length;
status({ storyboard: sheets });
log("storyboard", `${n} shots on ${sheets.length} page(s) in build/storyboard/ (${sheets.join(", ")}) + storyboard.txt` +
  (missing ? ` - ${missing} shot(s) with NO FOOTAGE` : ""));
log("storyboard", "Look at every tile: does the picture show what the words under it say? Fix, re-run --from=broll, then render.");
