// Render one frame per shot (late in the shot, so every graphic element has landed) at half size,
// then tile them with the shot id and its words: build/frames/sheet-NN.jpg
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition, openBrowser } from "@remotion/renderer";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const only = process.argv[2]; // optional: "graphic"
const t = JSON.parse(fs.readFileSync("public/timeline.json", "utf8"));
const shots = [];
t.scenes.forEach((s, si) => {
  let f = s.startFrame ?? s.from ?? 0;
  (s.shots || []).forEach((x, k) => {
    const start = (s.startFrame ?? 0) + (x.from ?? 0);
    if (!only || x.type === only) shots.push({ id: `s${si + 1}-${k + 1}`, frame: Math.round(start + x.durationInFrames * 0.8), words: x.words ?? "", type: x.type });
  });
});
fs.mkdirSync("build/frames", { recursive: true });
const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts"), webpackOverride: (c) => c, publicDir: path.resolve("public") });
const browser = await openBrowser("chrome", { chromiumOptions: { gl: "angle" } });
const comp = await selectComposition({ serveUrl, id: "Faceless", puppeteerInstance: browser });
let n = 0;
for (const s of shots) {
  const out = `build/frames/${s.id}.jpg`;
  if (!fs.existsSync(out)) {
    await renderStill({ composition: comp, serveUrl, frame: Math.min(s.frame, comp.durationInFrames - 1), output: path.resolve(out), imageFormat: "jpeg", jpegQuality: 70, scale: 0.25, puppeteerInstance: browser });
  }
  if (++n % 25 === 0) console.log(`${n}/${shots.length}`);
}
await browser.close({ silent: true });
fs.writeFileSync("build/frames/shots.json", JSON.stringify(shots));
spawnSync("python", ["-c", `
import json
from PIL import Image,ImageDraw
shots=json.load(open('build/frames/shots.json'))
W,H=480,270;cols=4;per=24
for p in range(0,len(shots),per):
  ch=shots[p:p+per];rows=(len(ch)+cols-1)//cols
  sh=Image.new('RGB',(W*cols,(H+34)*rows),(25,25,25));d=ImageDraw.Draw(sh)
  for i,s in enumerate(ch):
    x,y=(i%cols)*W,(i//cols)*(H+34)
    try:
      im=Image.open('build/frames/'+s['id']+'.jpg').convert('RGB').resize((W,H));sh.paste(im,(x,y))
    except Exception: pass
    d.text((x+3,y+H+2),s['id']+' '+s['type'],fill=(255,220,0));d.text((x+3,y+H+16),s['words'][:76],fill=(255,255,255))
  sh.save('build/frames/sheet-%02d.jpg'%(p//per),quality=82)
`], { stdio: "inherit" });
console.log("done", shots.length);
