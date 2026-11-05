// Hand-pick Coverr clips (same flow as px.mjs).
//   node scripts/cv.mjs search <name> "q1" ["q2"]  -> build/cv/<name>.jpg (numbered sheet)
//   node scripts/cv.mjs get <name> <n>              -> public/clips/<name>.mp4 + credit in build/cv-credits.json
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const H = { Authorization: `Bearer ${process.env.COVERR_API_KEY}` };
const [cmd, name, ...rest] = process.argv.slice(2);
fs.mkdirSync("build/cv", { recursive: true });
if (cmd === "search") {
  const hits = [];
  for (const q of rest) {
    const r = await fetch(`https://api.coverr.co/videos?query=${encodeURIComponent(q)}&page_size=12&urls=true`, { headers: H });
    if (!r.ok) { console.log(q, "->", r.status); continue; }
    let n = 0;
    for (const v of (await r.json()).hits ?? []) {
      if (n >= 8 || v.is_ai_generated || v.is_vertical || (v.max_width ?? 0) < 1920 || hits.some((x) => x.id === v.id)) continue;
      hits.push({ id: v.id, title: v.title, url: v.urls.mp4_download, thumb: v.thumbnail, dur: Math.round(+v.duration), q }); n++;
    }
    await new Promise((s) => setTimeout(s, 1200));
  }
  fs.writeFileSync(`build/cv/${name}.json`, JSON.stringify(hits, null, 1));
  for (const [i, h] of hits.entries()) fs.writeFileSync(`build/cv/${name}-${i + 1}.jpg`, Buffer.from(await (await fetch(h.thumb)).arrayBuffer()));
  spawnSync("python", ["-c", `
import json
from PIL import Image,ImageDraw
h=json.load(open('build/cv/${name}.json'));W,H=384,216;c=4;r=max(1,(len(h)+c-1)//c)
s=Image.new('RGB',(W*c,(H+30)*r),(20,20,20));d=ImageDraw.Draw(s)
for i,x in enumerate(h):
  X,Y=(i%c)*W,(i//c)*(H+30)
  try: s.paste(Image.open('build/cv/${name}-%d.jpg'%(i+1)).convert('RGB').resize((W,H)),(X,Y))
  except Exception: pass
  d.rectangle([X,Y,X+30,Y+22],fill=(0,0,0));d.text((X+6,Y+5),str(i+1),fill=(255,220,0))
  d.text((X+3,Y+H+3),('%ss '%x['dur'])+x['title'][:50],fill=(255,255,255))
s.save('build/cv/${name}.jpg',quality=85)`], { stdio: "inherit" });
  console.log(`${name}: ${hits.length}`);
} else if (cmd === "get") {
  const h = JSON.parse(fs.readFileSync(`build/cv/${name}.json`, "utf8"))[Number(rest[0]) - 1];
  fs.mkdirSync("public/clips", { recursive: true });
  const b = Buffer.from(await (await fetch(h.url)).arrayBuffer());
  fs.writeFileSync(`public/clips/${name}.mp4`, b);
  await fetch(`https://api.coverr.co/videos/${h.id}/stats/downloads`, { method: "PATCH", headers: H }).catch(() => {});
  const cf = "build/cv-credits.json", c = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, "utf8")) : {};
  c[`clips/${name}.mp4`] = `Coverr - "${h.title}" - https://coverr.co/videos/${h.id}`;
  fs.writeFileSync(cf, JSON.stringify(c, null, 1));
  console.log(`clips/${name}.mp4 ${h.dur}s ${b.length} bytes`);
}
