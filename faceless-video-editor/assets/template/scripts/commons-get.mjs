// Download pictures from Wikimedia Commons by search, with their license, into public/stills.
// node scripts/commons-get.mjs list.json      list = [{ "name": "crv", "q": "Honda CR-V 2023", "n": 4 }]
// Saves stills/<name>-<k>.<ext> and appends to build/commons-credits.json.
import fs from "node:fs";
import path from "node:path";

const list = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = "public/stills";
fs.mkdirSync(out, { recursive: true });
const credFile = "build/commons-credits.json";
const credits = fs.existsSync(credFile) ? JSON.parse(fs.readFileSync(credFile, "utf8")) : {};
const UA = { "User-Agent": "FacelessVideoEditor/1.0 (personal documentary editing)" };
const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

for (const item of list) {
  const n = item.n ?? 3;
  const already = fs.readdirSync(out).filter((f) => f.startsWith(item.name + "-"));
  if (already.length >= n) { console.log(`${item.name}: cached`); continue; }
  const q = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: String(Math.max(12, n * 4)),
    gsrsearch: item.q + (item.svg ? "" : " -filetype:svg"), prop: "imageinfo", iiprop: "url|extmetadata|size|mime", iiurlwidth: String(item.w ?? 1920),
  });
  let data;
  for (let a = 0; a < 6; a++) {
    try { data = await (await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, { headers: UA })).json(); break; }
    catch (e) { data = null; await new Promise((r) => setTimeout(r, 8000 * (a + 1))); }
  }
  if (!data) { console.log(`${item.name}: search failed (rate limit)`); continue; }
  await new Promise((r) => setTimeout(r, 1500));
  const pages = Object.values(data?.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  let k = already.length;
  for (const p of pages) {
    if (k >= n) break;
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const mime = ii.mime ?? "";
    if (!/image\/(jpeg|png|svg)/.test(mime)) continue;
    if (!item.svg && mime.includes("svg")) continue;
    if (!item.small && (ii.width ?? 0) < 1000 && !mime.includes("svg")) continue;
    const md = ii.extmetadata ?? {};
    const lic = strip(md.LicenseShortName?.value);
    if (!/CC|Public domain|PD|CC0/i.test(lic)) continue;
    if (item.exclude && new RegExp(item.exclude, "i").test(p.title)) continue;
    const url = ii.thumburl ?? ii.url;
    const ext = mime.includes("png") || mime.includes("svg") ? "png" : "jpg";
    k++;
    const file = `${item.name}-${k}.${ext}`;
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) { k--; continue; }
      fs.writeFileSync(path.join(out, file), Buffer.from(await r.arrayBuffer()));
    } catch { k--; continue; }
    credits[`stills/${file}`] = { title: p.title.replace(/^File:/, ""), author: strip(md.Artist?.value), license: lic, url: ii.descriptionurl };
    console.log(`${item.name}-${k}: ${p.title} [${lic}] ${ii.width}x${ii.height}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  if (k === already.length) console.log(`${item.name}: nothing usable for "${item.q}"`);
}
fs.mkdirSync("build", { recursive: true });
fs.writeFileSync(credFile, JSON.stringify(credits, null, 1));
