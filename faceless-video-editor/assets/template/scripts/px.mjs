// Hand-pick Pixabay clips.
//   node scripts/px.mjs search <name> "<query>" ["<query2>"]   -> build/px/<name>.jpg sheet (8 per query, numbered), build/px/<name>.json
//   node scripts/px.mjs get <name> <n>                          -> public/clips/<name>.mp4 (+ credit in build/px-credits.json)
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const KEY = process.env.PIXABAY_API_KEY;
const [cmd, name, ...rest] = process.argv.slice(2);
fs.mkdirSync("build/px", { recursive: true });
if (cmd === "search") {
  const hits = [];
  for (const q of rest) {
    const r = await (await fetch(`https://pixabay.com/api/videos/?key=${KEY}&q=${encodeURIComponent(q)}&per_page=20&safesearch=true`)).json();
    for (const h of r.hits ?? []) {
      if (hits.length >= 8 * rest.length) break;
      const v = h.videos.large?.url && h.videos.large.width >= 1920 ? h.videos.large : h.videos.medium;
      if (!v?.url || v.width < 1280) continue;
      if (/animation|3d|render|cartoon|illustration/i.test(h.tags)) continue;
      if (hits.some((x) => x.id === h.id)) continue;
      hits.push({ id: h.id, url: v.url, w: v.width, h: v.height, dur: h.duration, tags: h.tags, user: h.user, thumb: v.thumbnail });
      if (hits.filter((x) => x.q === q).length >= 8) break;
      hits[hits.length - 1].q = q;
    }
  }
  fs.writeFileSync(`build/px/${name}.json`, JSON.stringify(hits, null, 1));
  // thumbnails -> sheet
  const files = [];
  for (const [i, h] of hits.entries()) {
    const f = `build/px/${name}-${i + 1}.jpg`;
    if (h.thumb) { const b = Buffer.from(await (await fetch(h.thumb)).arrayBuffer()); fs.writeFileSync(f, b); files.push(f); }
  }
  const py = `
import json,sys
from PIL import Image,ImageDraw
hits=json.load(open('build/px/${name}.json'))
W,H=384,216;cols=4;rows=(len(hits)+cols-1)//cols
sh=Image.new('RGB',(W*cols,(H+30)*rows),(20,20,20));d=ImageDraw.Draw(sh)
for i,h in enumerate(hits):
  x,y=(i%cols)*W,(i//cols)*(H+30)
  try:
    im=Image.open(f'build/px/${name}-{i+1}.jpg').convert('RGB');im=im.resize((W,H));sh.paste(im,(x,y))
  except Exception: pass
  d.rectangle([x,y,x+34,y+24],fill=(0,0,0));d.text((x+6,y+5),str(i+1),fill=(255,220,0))
  d.text((x+3,y+H+3),f"{h['w']}x{h['h']} {h['dur']}s {h['tags'][:44]}",fill=(255,255,255))
sh.save('build/px/${name}.jpg',quality=85)
`;
  spawnSync("python", ["-c", py], { stdio: "inherit" });
  console.log(`${name}: ${hits.length} candidates -> build/px/${name}.jpg`);
} else if (cmd === "get") {
  const hits = JSON.parse(fs.readFileSync(`build/px/${name}.json`, "utf8"));
  const h = hits[Number(rest[0]) - 1];
  fs.mkdirSync("public/clips", { recursive: true });
  const b = Buffer.from(await (await fetch(h.url)).arrayBuffer());
  fs.writeFileSync(`public/clips/${name}.mp4`, b);
  const cf = "build/px-credits.json";
  const c = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, "utf8")) : {};
  c[`clips/${name}.mp4`] = `${h.user} - https://pixabay.com/videos/id-${h.id}/`;
  fs.writeFileSync(cf, JSON.stringify(c, null, 1));
  console.log(`clips/${name}.mp4 ${h.w}x${h.h} ${h.dur}s (${b.length} bytes)`);
}
