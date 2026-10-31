// Sound design plan: what each scene and shot should SOUND like, from what it
// shows. Writes build/sound-plan.json:
//   ambience per scene (a bed under the voice: city, rain, office, ocean, ...)
//   spot sounds per beat (one sound on the cut: camera shutter, door, cash register, ...)
// each with a search phrase for a sound library (the Epidemic Sound connector) and
// a "file" to fill in once downloaded (public/sfx/amb/..., public/sfx/spot/...).
//   node scripts/sound-plan.mjs           write / refresh the plan (keeps files already filled)
//   node scripts/sound-plan.mjs --apply   write the filled files into project.json
//                                         (scene "ambience", beat "sfx"), then re-run --from=timeline
// Restraint is built in: ambience only where the picture has a place with a sound,
// at most one spot sound every ~8 seconds, never on graphics.
import fs from "node:fs";
import path from "node:path";
import { BUILD, PUBLIC, ROOT, brollEntries, log, readJson, readProject, sceneId, writeJson } from "./lib.mjs";

const AMBIENCE = [
  [/\b(city|street|traffic|downtown|urban|dhaka|new york|cars?)\b/, "city street traffic ambience"],
  [/\b(rain|monsoon|storm|flood)\b/, "rain ambience steady"],
  [/\b(office|desk|workplace|startup|meeting|team)\b/, "office room tone ambience"],
  [/\b(ocean|sea|beach|coast|waves?)\b/, "ocean waves ambience"],
  [/\b(river|stream|boat|lake)\b/, "river water flowing ambience"],
  [/\b(forest|jungle|woods|trees|village|farm|field|rice)\b/, "countryside birds ambience"],
  [/\b(crowd|market|bazaar|stadium|protest)\b/, "crowd market ambience"],
  [/\b(night|crime|dark|alley)\b/, "night city distant ambience"],
  [/\b(hospital|lab|laboratory)\b/, "hospital room tone"],
  [/\b(factory|machine|industrial|warehouse)\b/, "factory machinery ambience"],
  [/\b(war|battle|soldier|military|army)\b/, "war distant battle ambience"],
  [/\b(space|rocket|astronaut|planet)\b/, "space drone ambience"],
  [/\b(airport|plane|flight)\b/, "airport terminal ambience"],
  [/\b(wind|desert|mountain|snow)\b/, "wind ambience"],
];
const SPOTS = [
  [/\b(camera|photo|photograph)\b/, "camera shutter click"],
  [/\b(door|closed|shop sign)\b/, "door close"],
  [/\b(cash|money|wallet|dollar|payment|paid|credit card|bank)\b/, "cash register"],
  [/\b(phone|smartphone|notification|app|signup|sign up)\b/, "phone notification"],
  [/\b(typing|keyboard|laptop|computer|code)\b/, "keyboard typing"],
  [/\b(explosion|bomb|blast)\b/, "explosion distant"],
  [/\b(applause|celebrat|cheer|success)\w*/, "crowd cheer short"],
  [/\b(car horn|honk)\b/, "car horn"],
  [/\b(train)\b/, "train passing"],
  [/\b(thunder|lightning)\b/, "thunder crack"],
  [/\b(clock|deadline|time running)\b/, "clock ticking"],
  [/\b(footsteps|walking|running)\b/, "footsteps"],
  [/\b(splash|water drop)\b/, "water splash"],
  [/\b(gun|shot fired)\b/, "gunshot distant"],
  [/\b(helicopter)\b/, "helicopter flyby"],
  [/\b(plane|jet)\b/, "jet flyby"],
];
const apply = process.argv.includes("--apply");
const planFile = path.join(BUILD, "sound-plan.json");
const project = readProject();
const timeline = readJson(path.join(PUBLIC, "timeline.json"), null);
const old = readJson(planFile, { scenes: {}, spots: {} });

if (apply) {
  const raw = readJson(path.join(ROOT, "project.json"));
  const scenes = raw.chapters ? raw.chapters.flatMap((c) => c.scenes) : raw.scenes;
  let n = 0;
  for (const [id, a] of Object.entries(old.scenes ?? {})) {
    const sc = scenes[Number(id.slice(1)) - 1];
    if (sc && a.file && fs.existsSync(path.join(PUBLIC, a.file))) { sc.ambience = a.file; n++; }
  }
  for (const [key, sp] of Object.entries(old.spots ?? {})) {
    const sc = scenes[Number(key.slice(1, 4)) - 1];
    if (!sc || !sp.file || !fs.existsSync(path.join(PUBLIC, sp.file))) continue;
    const beat = (sc.broll ?? []).find((b) => typeof b === "object" && b.on === sp.on);
    if (beat && !beat.sfx) { beat.sfx = sp.file; n++; }
  }
  fs.writeFileSync(path.join(ROOT, "project.json"), JSON.stringify(raw, null, 2));
  log("sound", `${n} sound(s) written into project.json - now: node scripts/auto.mjs --from=timeline`);
  process.exit(0);
}

const plan = { scenes: {}, spots: {} };
let lastSpot = -Infinity;
project.scenes.forEach((scene, i) => {
  const id = sceneId(i);
  const tlScene = timeline?.scenes.find((s) => s.id === id);
  // Keyword prefixes (photo:, archive:, file:...) say where a picture comes from, not what it shows.
  const kws = brollEntries(scene).flatMap((e) => e.kw).join(" ").toLowerCase().replace(/\b(photo|archive|file|ai|adobe):/g, "");
  const text = `${kws} ${scene.text}`.toLowerCase();
  if (!scene.ambience) {
    const hit = AMBIENCE.find(([re]) => re.test(text));
    if (hit) plan.scenes[id] = { search: hit[1], file: old.scenes?.[id]?.file ?? null, why: (text.match(hit[0]) ?? [])[0] };
  }
  const startSec = tlScene ? tlScene.startFrame / timeline.fps : i * 4;
  brollEntries(scene).forEach((e, k) => {
    if (e.graphic || e.sfx || !e.on) return;
    const t = startSec + (tlScene?.shots[k] ? tlScene.shots[k].from / timeline.fps : 0);
    if (t - lastSpot < 8) return;
    const words = `${e.kw.join(" ")} ${e.on}`.toLowerCase().replace(/\b(photo|archive|file|ai|adobe):/g, "");
    const hit = SPOTS.find(([re]) => re.test(words));
    if (!hit) return;
    const key = `${id}-${k + 1}`;
    plan.spots[key] = { on: e.on, search: hit[1], file: old.spots?.[key]?.file ?? null, why: (words.match(hit[0]) ?? [])[0] };
    lastSpot = t;
  });
});
writeJson(planFile, plan);
const a = Object.keys(plan.scenes).length, s = Object.keys(plan.spots).length;
log("sound", `plan: ${a} ambience bed(s), ${s} spot sound(s) -> build/sound-plan.json`);
log("sound", "For each entry: search the sound library (Epidemic Sound connector: SearchSoundEffects with the \"search\" phrase), " +
  "download the best short match into public/sfx/amb/ or public/sfx/spot/, put its path in \"file\", then: node scripts/sound-plan.mjs --apply");
