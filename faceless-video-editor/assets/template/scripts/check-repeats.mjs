// One shot, one use: no footage or photo may appear twice in a video.
//
// Reads the finished timeline, so it sees every source: library searches, bank
// picks, file: assets and the images inside graphics. Two cuts from the same bank
// segment are the same shot, even when their lengths or file names differ.
// Different scenes cut from one long source video are fine.
// A long beat that carries on through the same clip in the next shot is one
// continuous shot, not a repeat, as long as the picture doesn't step back.
//
//   node scripts/check-repeats.mjs            report repeats
//   node scripts/check-repeats.mjs --strict   also exit 1 (auto.mjs does this before a render)
//
// "allowRepeats": true in project.json turns --strict off, for when the owner asks for a repeat.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PUBLIC, ROOT, fail, log, readJson, timecode } from "./lib.mjs";

// bank-<source video>-<segment start x 10>-<length x 10>.mp4 (footage-bank.mjs)
const mediaKey = (src) => {
  const m = path.basename(src).match(/^bank-(\d+)-(\d+)-\d+\./);
  return m ? `bank:${m[1]}:${m[2]}` : src;
};

// Pure, so it can be tested and reused: timeline in, repeated media out.
export function findRepeats(timeline) {
  const fps = timeline.fps || 30;
  const uses = new Map();
  let order = 0;
  for (const scene of timeline.scenes) {
    for (const shot of scene.shots ?? []) {
      const position = order++;
      const at = (scene.startFrame + (shot.from ?? 0)) / fps;
      const words = shot.words ?? "";
      const add = (media) => {
        const key = mediaKey(media);
        if (!uses.has(key)) uses.set(key, []);
        uses.get(key).push({ media, scene: scene.id, at, words, position,
          trim: (shot.trimBefore ?? 0) / fps,
          seconds: ((shot.durationInFrames ?? 0) / fps) * (shot.playbackRate ?? 1) });
      };
      if (shot.src) add(shot.src);
      if (shot.graphic?.image) add(shot.graphic.image);
    }
  }
  const repeats = [];
  for (const [key, list] of uses) {
    // Merge runs of neighbouring shots that simply carry on through the same file.
    const runs = [];
    for (const use of list) {
      const last = runs.at(-1)?.at(-1);
      const continues = last && use.position === last.position + 1 && use.scene === last.scene &&
        use.media === last.media && use.trim >= last.trim + last.seconds - 0.05;
      if (continues) runs.at(-1).push(use);
      else runs.push([use]);
    }
    if (runs.length > 1) repeats.push({ key, uses: runs.map((run) => run[0]) });
  }
  return repeats.sort((a, b) => b.uses.length - a.uses.length || a.uses[0].at - b.uses[0].at);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const strict = process.argv.includes("--strict");
  const timeline = readJson(path.join(PUBLIC, "timeline.json"), null);
  if (!timeline) fail("No public/timeline.json - build the timeline first.");
  const allowed = readJson(path.join(ROOT, "project.json"), {})?.allowRepeats === true;
  const repeats = findRepeats(timeline);
  if (!repeats.length) log("repeats", "every shot and photo is used once");
  else {
    const extra = repeats.reduce((n, r) => n + r.uses.length - 1, 0);
    log("repeats", `${repeats.length} shot(s) or photo(s) used more than once, ${extra} extra use(s):`);
    for (const r of repeats) {
      log("repeats", `  ${path.basename(r.uses[0].media)} x${r.uses.length}: ` +
        r.uses.map((u) => `${u.scene} @ ${timecode(u.at)} "${u.words.slice(0, 40)}"`).join(" | "));
    }
    log("repeats", "Keep the use that fits its words best and give the others a different shot, photo or graphic.");
    if (strict && !allowed) fail(`${extra} repeated use(s) of footage: fix them before rendering, or set "allowRepeats": true if the owner asked for them.`);
    if (allowed) log("repeats", "allowRepeats is on in project.json, so this doesn't stop the render.");
  }
}
