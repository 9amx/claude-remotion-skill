// YouTube thumbnail: out/thumbnail.jpg (1280x720, under YouTube's 2 MB limit).
// Background: project.thumbnail.image (a file in public/), else a frame grabbed
// from the B-roll of the chosen scene (thumbnail.scene, 1-based; default the
// first reveal scene, else scene 1). Text: thumbnail.text, else scene 1's
// emphasis, else the title. "thumbnail": false skips it.
// Env: REMOTION_BROWSER=/path/to/chrome, REMOTION_FLAGS (as for render; --concurrency is dropped)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BUILD, PUBLIC, ROOT, ffmpeg, fail, log, readJson, readProject, remotionCmd, stripMarkup, writeJson } from "./lib.mjs";

const project = readProject();
const cfg = project.thumbnail ?? {};
if (cfg === false) {
  log("thumbnail", '"thumbnail": false in project.json, skipped');
  process.exit(0);
}
const t = readJson(path.join(PUBLIC, "timeline.json"), null);
if (!t && !cfg.image) fail("No public/timeline.json - build the timeline first (or set thumbnail.image).");

const text = stripMarkup(cfg.text ?? project.scenes[0].emphasis ?? project.title ?? "").trim();
if (!text) fail('No thumbnail text: set "thumbnail": { "text": "2-4 WORDS" } in project.json.');
if (text.split(/\s+/).length > 5) log("thumbnail", `"${text}" is ${text.split(/\s+/).length} words - thumbnails read best at 2-4`);

let image = cfg.image ?? null;
if (image && !fs.existsSync(path.join(PUBLIC, image))) fail(`thumbnail.image "${image}" not found in public/`);
if (!image) {
  const pickScene = cfg.scene ? t.scenes[cfg.scene - 1] : t.scenes.find((s) => s.fx.includes("reveal")) ?? t.scenes[0];
  if (!pickScene) fail(`thumbnail.scene ${cfg.scene} does not exist (${t.scenes.length} scenes)`);
  const real = (s) => s.shots.filter((sh) => sh.type !== "kinetic" && sh.src && fs.existsSync(path.join(PUBLIC, sh.src)));
  const shot = real(pickScene)[0] ?? t.scenes.flatMap(real)[0];
  if (!shot) log("thumbnail", "no B-roll in this video, using the plain background");
  else if (shot.type === "image") image = shot.src;
  else {
    // Middle of the part of the clip the video actually shows.
    const at = ((shot.trimBefore ?? 0) + (shot.durationInFrames / 2) * (shot.playbackRate ?? 1)) / t.fps;
    fs.mkdirSync(path.join(PUBLIC, "thumb"), { recursive: true });
    const r = ffmpeg(["-ss", at.toFixed(2), "-i", path.join(PUBLIC, shot.src), "-frames:v", "1", "-q:v", "2", path.join(PUBLIC, "thumb", "bg.jpg")]);
    if (r.status === 0) image = "thumb/bg.jpg";
    else log("thumbnail", `could not grab a frame from ${shot.src}, using the plain background`);
  }
}

const props = { text, image, style: cfg.style ?? project.style, side: cfg.side === "right" ? "right" : "left" };
const propsFile = path.join(BUILD, "thumbnail-props.json");
writeJson(propsFile, props);
const out = path.join(ROOT, "out", "thumbnail.jpg");
const flags = [
  ...(process.env.REMOTION_BROWSER ? [`--browser-executable=${process.env.REMOTION_BROWSER}`] : []),
  ...(process.env.REMOTION_FLAGS || "").split(/\s+/).filter((f) => f && !f.startsWith("--concurrency")),
];
const render = (quality) => {
  const r = spawnSync(...remotionCmd(["still", "src/index.ts", "Thumbnail", out, `--props=${propsFile}`,
    "--image-format=jpeg", `--jpeg-quality=${quality}`, "--overwrite", ...flags]), { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) fail("thumbnail render failed");
};
// YouTube rejects thumbnails over 2 MB.
for (const q of [92, 80, 65]) {
  render(q);
  if (fs.statSync(out).size < 2 * 1024 * 1024) break;
}
log("thumbnail", `out/thumbnail.jpg  "${text}"${image ? ` over ${image}` : ""} - look at it before uploading`);
