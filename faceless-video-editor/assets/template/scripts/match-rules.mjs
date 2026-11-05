// Text rules that catch the wrong thing before anyone downloads it. Used by fetch-broll (every source)
// and yt-engine. A result is rejected when its title / tags / description:
//   - contain one of the keyword's "-word" exclusions ("Supra MK4 orange -mk5 -a90 -toy")
//   - name a different generation of the same family than the keyword (MK4 vs MK5, E46 vs F80, W124 vs W210, 4th gen vs 5th gen)
//   - only name years far from the keyword's year (1993 vs 2020) - lines about one era want footage of that era
//   - are a model, toy or game ("1/24", diecast, Forza, GTA) when the keyword doesn't ask for one
import { visualQuery } from "./vision.mjs";

export const NOT_REAL = /\b(?:1\/\d{2}|scale model|model kit|diecast|die-cast|hot wheels|lego|rc car|toy|gameplay|gta ?v?|forza|assetto|need for speed|nfs|gran turismo|beamng|simulator|roblox|minecraft)\b/i;

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
// Generation / chassis codes by family: { family: Set(codes) }.
function generations(text) {
  const t = ` ${String(text).toLowerCase()} `, out = {};
  const add = (fam, code) => (out[fam] ??= new Set()).add(String(code));
  for (const m of t.matchAll(/\bmk ?(\d{1,2}|[ivx]{1,4})\b/g)) add("mk", /\d/.test(m[1]) ? +m[1] : ROMAN[m[1]] ?? m[1]);
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)[ -]?gen(?:eration)?\b|\bgen(?:eration)? ?(\d{1,2})\b/g)) add("gen", +(m[1] ?? m[2]));
  for (const m of t.matchAll(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)[ -]gen(?:eration)?\b/g)) add("gen", ORD[m[1]]);
  for (const m of t.matchAll(/\b([efg]\d{2})\b/g)) add("bmw", m[1]);   // BMW chassis: E30, E46, F80, G80
  for (const m of t.matchAll(/\b(w\d{3})\b/g)) add("merc", m[1]);       // Mercedes: W124, W210
  return out;
}
const years = (text) => [...String(text).matchAll(/\b(19[0-9]\d|20[0-4]\d)\b/g)].map((m) => +m[1]);

// Why `text` (a result's title + tags + description) doesn't fit `keyword`, or null.
export function mismatch(keyword, text) {
  const { query, negatives } = visualQuery(keyword);
  const t = String(text ?? "").toLowerCase();
  for (const n of negatives) if (new RegExp(`(^|[^\\p{L}\\p{N}])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "u").test(t)) return `contains "-${n}"`;
  const want = generations(query), have = generations(t);
  for (const [fam, codes] of Object.entries(want)) {
    const other = [...(have[fam] ?? [])].filter((c) => !codes.has(c));
    if (other.length && ![...codes].some((c) => have[fam]?.has(c))) return `different generation (${fam} ${other[0]}, wanted ${[...codes][0]})`;
  }
  const qy = years(query), ty = years(t);
  if (qy.length && ty.length && !ty.some((y) => qy.some((q) => Math.abs(y - q) <= 5))) return `different era (${ty[0]}, wanted ${qy[0]})`;
  if (NOT_REAL.test(t) && !NOT_REAL.test(query)) return "a model / toy / game, not the real thing";
  return null;
}
