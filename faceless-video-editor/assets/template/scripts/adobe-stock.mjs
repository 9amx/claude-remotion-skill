// Adobe Stock footage through the Adobe connector in Claude. The connector's
// tools (asset_search, asset_license_and_download_stock) run in Claude, not
// here; this script turns their results into review sheets and local files.
//
//   node scripts/adobe-stock.mjs sheet <shot-key> <search-result.json>
//       The connector's asset_search result for one shot (saved as JSON) ->
//       build/review/<shot-key>-adobe.jpg, candidates labelled A1-A6, and the
//       candidates added to build/review.json under "adobe" (relevance-scored
//       against the shot's keyword; green screens and templates dropped).
//   node scripts/adobe-stock.mjs add <asset-id> <licensed-url-or-file> [--title "..."] [--pick <shot-key>]
//       Downloads the licensed file to public/broll/adobe-<id>.mp4 (H.264, any
//       Adobe codec converted), registers it in build/adobe.json, and with
//       --pick writes {"<shot-key>": "adobe:<id>"} to build/picks.json.
// Then use "adobe:<id>" as a pick (build/picks.json) or as a beat keyword.
import fs from "node:fs";
import path from "node:path";
import { BLOCK, BUILD, PUBLIC, ffmpeg, fail, log, probeDuration, readJson, relevance, writeJson } from "./lib.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest.splice(i, 2)[1] : undefined;
};
const UA = { "User-Agent": "faceless-video-editor/1.0 (https://github.com/9amx/claude-remotion-skill)" };

async function download(url, dest) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) fail(`download failed: ${res.status} (licensed URLs expire after an hour - license again for a fresh one)`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

if (cmd === "sheet") {
  const [key, file] = rest;
  if (!key || !file) fail("usage: node scripts/adobe-stock.mjs sheet <shot-key> <search-result.json>");
  const reviewFile = path.join(BUILD, "review.json");
  const review = readJson(reviewFile, {});
  const kw = flag("keyword") ?? review[key]?.keyword;
  if (!kw) fail(`${key} is not in build/review.json - run the review first (node scripts/auto.mjs --review), or pass --keyword "..."`);
  const result = JSON.parse(fs.readFileSync(file, "utf8"));
  const assets = (result.assets ?? result).filter((a) => a && a.id && !BLOCK.test(a.name ?? ""));
  if (!assets.length) fail(`${key}: no usable Adobe Stock results in ${file}`);
  // Best matches first, the search's own order as the tie-break; six at most.
  const cands = assets
    .map((a, i) => ({ a, rel: relevance(kw.replace(/^[a-z]+:/, ""), a.name ?? ""), i }))
    .sort((x, y) => y.rel - x.rel || x.i - y.i)
    .slice(0, 6)
    .map(({ a, rel }, i) => ({ n: `A${i + 1}`, id: String(a.id), title: a.name ?? "", kind: a.contentType === "Video" ? "video" : "image",
      w: a.width, h: a.height, pricing: a.pricing ?? "?", rel: Math.round(rel * 100) / 100, thumb: a.renditionURL }));

  const dir = path.join(BUILD, "review");
  fs.mkdirSync(dir, { recursive: true });
  let labels = true;
  for (const [i, c] of cands.entries()) {
    const raw = path.join(dir, `${key}-adobe-raw${i + 1}`), tile = path.join(dir, `${key}-adobe-t${i + 1}.jpg`);
    try {
      await download(c.thumb, raw);
    } catch {}
    const base = "scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=white";
    const tag = `${c.n} ${c.pricing === "free" ? "FREE" : "PAID"} ${c.w}x${c.h}`;
    const label = `,drawtext=text='${tag}':x=6:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4`;
    const make = (vf) => fs.existsSync(raw) && ffmpeg(["-i", raw, "-frames:v", "1", "-vf", `${vf},format=yuvj420p`, tile]).status === 0;
    if (!(labels && make(base + label))) {
      labels = false;
      if (!make(base)) ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=320x320", "-frames:v", "1", "-vf", "format=yuvj420p", tile]);
    }
    fs.rmSync(raw, { force: true });
  }
  const sheet = path.join(dir, `${key}-adobe.jpg`);
  ffmpeg(["-framerate", "1", "-start_number", "1", "-i", path.join(dir, `${key}-adobe-t%d.jpg`), "-vf", "tile=3x2:padding=8:color=white", "-frames:v", "1", sheet]);
  for (let i = 1; i <= cands.length; i++) fs.rmSync(path.join(dir, `${key}-adobe-t${i}.jpg`), { force: true });

  review[key] = { ...(review[key] ?? { keyword: kw }), adobe: cands, adobeSheet: `build/review/${key}-adobe.jpg` };
  writeJson(reviewFile, review);
  log("adobe", `${path.relative(process.cwd(), sheet)}: ${cands.map((c) => `${c.n} ${c.pricing} rel ${c.rel} "${c.title.slice(0, 50)}"`).join(" | ")}`);
  if (!labels) log("adobe", "tiles are A1-A6 left to right, top to bottom");
  process.exit(0);
}

if (cmd === "add") {
  const title = flag("title");
  const pick = flag("pick");
  const [id, src] = rest;
  if (!id || !src) fail('usage: node scripts/adobe-stock.mjs add <asset-id> <licensed-url-or-file> [--title "..."] [--pick <shot-key>]');
  const tmp = path.join(BUILD, "adobe-tmp", `adobe-${id}.src`);
  if (/^https?:/.test(src)) await download(src, tmp);
  else {
    if (!fs.existsSync(src)) fail(`${src} not found`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.copyFileSync(src, tmp);
  }
  const probe = ffmpeg(["-i", tmp, "-f", "null", "-t", "0", "-"], { capture: true }).stderr || "";
  const video = /Stream #.*Video: (\w+)/.exec(probe);
  const isVideo = video && probeDuration(tmp) > 0.5;
  const from = /^https?:/.test(src) ? "the download" : src;
  fs.mkdirSync(path.join(PUBLIC, "broll"), { recursive: true });
  let file;
  if (isVideo) {
    // Adobe Stock video is often ProRes / MOV: one H.264 MP4 every renderer reads,
    // short side capped at 2160 (enough to crop a 4K landscape clip into a 9:16 Short).
    file = `broll/adobe-${id}.mp4`;
    const r = ffmpeg(["-i", tmp, "-an", "-vf", "scale='if(lt(iw,ih),min(iw,2160),-2)':'if(lt(iw,ih),-2,min(ih,2160))',format=yuv420p",
      "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", path.join(PUBLIC, file)]);
    if (r.status !== 0) fail(`could not convert ${from} (codec ${video[1]})`);
  } else {
    file = `broll/adobe-${id}.jpg`;
    if (ffmpeg(["-i", tmp, "-q:v", "2", path.join(PUBLIC, file)]).status !== 0) fail(`could not read ${from} as an image`);
  }
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  const registry = readJson(path.join(BUILD, "adobe.json"), {});
  registry[id] = { file, kind: isVideo ? "video" : "image", title: title ?? registry[id]?.title ?? "", added: new Date().toISOString() };
  writeJson(path.join(BUILD, "adobe.json"), registry);
  log("adobe", `public/${file}${isVideo ? ` (${probeDuration(path.join(PUBLIC, file))?.toFixed(1)}s, from ${video[1]})` : ""}`);
  if (pick) {
    const picksFile = path.join(BUILD, "picks.json");
    writeJson(picksFile, { ...readJson(picksFile, {}), [pick]: `adobe:${id}` });
    log("adobe", `build/picks.json: ${pick} -> adobe:${id}`);
  } else log("adobe", `use it: a pick {"<shot-key>": "adobe:${id}"} in build/picks.json, or "adobe:${id}" as a beat keyword`);
  process.exit(0);
}

fail("usage: node scripts/adobe-stock.mjs sheet <shot-key> <search-result.json> | add <asset-id> <licensed-url-or-file> [--title ...] [--pick <shot-key>]");
