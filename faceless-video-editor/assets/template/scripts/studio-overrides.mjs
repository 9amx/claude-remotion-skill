// Studio edits laid over a built timeline. Shared by the browser (instant preview)
// and build-timeline.mjs (what renders), so the preview and the render agree.
// build/edits.json:
//   shots:  { "s012-2": { move, focus:[x,y], zoomIn, speed, grade:{ bright, contrast, warm, tint },
//                         graphic:{...GraphicSpec}, overlays:[{type:"slug"|"stat"|"callout", text, ...}], remove:true } }
//           a split shot's second half is "s012-2b"
//   splits: { "s012-2": 45 }            split that shot 45 frames in
//   swaps:  [["s012-1","s012-3"]]       two shots of one scene trade places (the cut points stay on the words)
//   scenes: { "s012": { transition, look, fx:[...], layout } }
//   global: { voiceVolume, musicVolume, sfxLevel, captions, progressBar, chapterCards }
//   cuts / text: applied by build-timeline itself; the browser approximates them (preview: true).
// No dependencies: runs as an ES module in both Node and the page.

export const MOVES = ["push", "pull", "pan-left", "pan-right", "tilt-up", "tilt-down", "diag-down", "diag-up", "detail", "focus", "reveal", "parallax", "tilt-rotate", "handheld", "snap", "slam", "frame"];
export const TRANSITIONS = ["cut", "whip", "push", "wipe", "zoom", "flash", "dip", "fade", "burn", "shutter", "leak", "glitch"];
export const LOOKS = ["normal", "flashback", "dramatic", "night", "vhs", "dream"];
export const FX = ["shake", "freeze", "reveal", "punch"];
export const CAPTIONS = ["none", "subtitle", "pop", "karaoke", "boxed"];
export const GRAPHICS = ["stage", "counter", "bars", "statement", "quote", "timeline", "list", "steps", "compare", "map"];
export const OVERLAYS = ["slug", "stat", "callout", "line"];

const num = (v, lo, hi) => (v !== null && v !== "" && Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null);
const r3 = (v) => Math.round(v * 1000) / 1000;
const SLOT = new Set(["from", "durationInFrames", "words"]); // what stays with the place in the edit, not the picture

export function hasEdits(e) {
  if (!e) return false;
  return ["shots", "scenes", "splits", "global"].some((k) => e[k] && Object.keys(e[k]).length) || (Array.isArray(e.swaps) && e.swaps.length > 0);
}

function applyShot(sh, e) {
  if (!e) return sh;
  if (e.graphic && GRAPHICS.includes(e.graphic.type)) {
    const g = JSON.parse(JSON.stringify(e.graphic));
    if (g.type === "stage") {
      const bgSrc = sh.type === "graphic" ? sh.graphic?.bg?.video ?? sh.graphic?.bg?.image : sh.src;
      if (!g.bg && bgSrc) g.bg = { [/\.(mp4|mov|webm)$/i.test(bgSrc) ? "video" : "image"]: bgSrc, from: sh.type === "video" ? Math.round(sh.trimBefore ?? 0) : undefined, dim: 0.6, scrim: "center", glow: true };
      const n = (g.items ?? []).length;
      if (!Array.isArray(g.at) || g.at.length !== n) g.at = Array.from({ length: n }, (_, i) => Math.round(4 + i * Math.min(24, (sh.durationInFrames - 20) / Math.max(1, n))));
    }
    sh.type = "graphic"; sh.graphic = g;
    delete sh.src; delete sh.path; delete sh.pathFx; delete sh.move; delete sh.trimBefore; delete sh.playbackRate;
  }
  if (MOVES.includes(e.move) && sh.type === "image") { sh.move = e.move; delete sh.path; delete sh.pathFx; }
  if (Array.isArray(e.focus) && e.focus.length === 2) sh.focus = [num(e.focus[0], 0, 100), num(e.focus[1], 0, 100)];
  if (typeof e.zoomIn === "boolean") sh.zoomIn = e.zoomIn;
  if (sh.type === "video" && num(e.speed, 0.25, 4) != null) sh.playbackRate = num(e.speed, 0.25, 4);
  if (e.grade && sh.type !== "graphic") {
    const c = { r: 1, g: 1, b: 1, bright: 1, contrast: 1, ...(sh.cc ?? {}) };
    const gr = e.grade, warm = num(gr.warm, -0.3, 0.3) ?? 0, tint = num(gr.tint, -0.3, 0.3) ?? 0;
    c.bright = r3(c.bright * (num(gr.bright, 0.4, 2) ?? 1));
    c.contrast = r3(c.contrast * (num(gr.contrast, 0.4, 2) ?? 1));
    c.r = r3(c.r * (1 + warm)); c.b = r3(c.b * (1 - warm)); c.g = r3(c.g * (1 + tint));
    sh.cc = c;
  }
  if (Array.isArray(e.overlays)) {
    const add = e.overlays.filter((o) => o && OVERLAYS.includes(o.type) && (o.text || o.value != null)).map((o) => ({ ...o, text: String(o.text ?? "").slice(0, 120) }));
    sh.overlays = e.overlaysReplace ? add : [...(sh.overlays ?? []), ...add];
  }
  return sh;
}

// A clip moved to a longer slot must not run past its end: start it earlier.
function fitClip(sh, fps) {
  if (sh.type !== "video" || !sh.duration) return;
  const need = sh.durationInFrames * (sh.playbackRate ?? 1);
  const have = sh.duration * fps;
  if ((sh.trimBefore ?? 0) + need > have) sh.trimBefore = Math.max(0, Math.floor(have - need));
}

export function applyOverrides(timeline, edits = {}, { preview = false } = {}) {
  const t = JSON.parse(JSON.stringify(timeline));
  if (!edits) return t;
  const fps = t.fps || 30;
  const g = edits.global ?? {};
  // The master evens out loudness, so "voice louder" = everything else quieter.
  const voice = num(g.voiceVolume, 0.25, 4) ?? 1;
  const music = num(g.musicVolume, 0, 1);
  if (music != null || voice !== 1) t.music = { ...t.music, volume: r3((music ?? t.music.volume) / voice) };
  const sfx = num(g.sfxLevel, 0, 2);
  if (sfx != null || voice !== 1) t.sfxLevel = r3((sfx ?? t.sfxLevel ?? 1) / voice);
  if (voice !== 1) {
    t.ambience = (t.ambience ?? []).map((a) => ({ ...a, volume: r3(a.volume / voice) }));
    t.spots = (t.spots ?? []).map((s) => ({ ...s, volume: r3(s.volume / voice) }));
  }
  if (CAPTIONS.includes(g.captions)) t.captions = { ...t.captions, style: g.captions };
  if (typeof g.progressBar === "boolean") t.progressBar = g.progressBar;
  if (typeof g.chapterCards === "boolean") t.showChapterCards = g.chapterCards;

  t.scenes.forEach((sc, i) => {
    const se = edits.scenes?.[sc.id];
    if (se) {
      if (TRANSITIONS.includes(se.transition)) { sc.transition = se.transition; if (i > 0) t.scenes[i - 1].exit = se.transition; }
      if (LOOKS.includes(se.look)) sc.look = se.look;
      if (Array.isArray(se.fx)) { sc.fx = se.fx.filter((f) => FX.includes(f)); sc.shake = sc.fx.includes("shake"); }
      if (se.layout === "full" || se.layout === "split") sc.layout = se.layout;
    }
    if (preview) {
      // The builder applies these exactly; here they only steer the preview.
      const tx = edits.text ?? {};
      const T = (k, v) => (k in tx ? (tx[k] === "" ? null : tx[k]) : v);
      sc.emphasis = T(`${sc.id}:emphasis`, sc.emphasis);
      sc.badge = T(`${sc.id}:badge`, sc.badge);
      if (`${sc.id}:lowerThird` in tx) sc.lowerThird = tx[`${sc.id}:lowerThird`] ? { ...(sc.lowerThird ?? {}), title: tx[`${sc.id}:lowerThird`] } : null;
      if (sc.callouts) sc.callouts = sc.callouts.map((c, k) => ({ ...c, text: T(`${sc.id}:callout:${k}`, c.text) })).filter((c) => c.text);
      sc.shots.forEach((sh, k) => {
        const d = Math.round(Number(edits.cuts?.[`${sc.id}-${k + 1}`]) || 0);
        if (!d || k === 0 || sc.layout === "split") return;
        const prev = sc.shots[k - 1];
        const dd = Math.max(-(prev.durationInFrames - 6), Math.min(sh.durationInFrames - 6, d));
        sh.from += dd; sh.durationInFrames -= dd; prev.durationInFrames += dd;
        if (sh.type === "video") sh.trimBefore = Math.max(0, (sh.trimBefore ?? 0) + dd * (sh.playbackRate ?? 1));
      });
    }

    // Keys stay the ones of the built timeline: s012-2, and s012-2b for a split's second half.
    let list = sc.shots.map((sh, k) => ({ key: `${sc.id}-${k + 1}`, sh }));
    // Splits (on the picture as built, before per-shot changes so both halves can differ).
    list = list.flatMap((it) => {
      const at = Math.round(Number(edits.splits?.[it.key]) || 0);
      if (at < 6 || at > it.sh.durationInFrames - 6 || sc.layout === "split") return [it];
      const a = it.sh, b = JSON.parse(JSON.stringify(a));
      b.from = a.from + at; b.durationInFrames = a.durationInFrames - at; a.durationInFrames = at;
      b.fadeIn = 0;
      // The second half carries on through the picture (a continuous shot, not a repeat).
      b.trimBefore = (a.trimBefore ?? 0) + at * (a.playbackRate ?? 1);
      if (b.type === "image") { delete b.path; delete b.pathFx; }
      if (b.overlays) b.overlays = [];
      return [it, { key: `${it.key}b`, sh: b }];
    });
    for (const it of list) applyShot(it.sh, edits.shots?.[it.key]);
    // Swaps: pictures trade places, the slots (timing on the words) stay.
    for (const pair of Array.isArray(edits.swaps) ? edits.swaps : []) {
      const a = list.find((x) => x.key === pair?.[0]), b = list.find((x) => x.key === pair?.[1]);
      if (!a || !b || a === b) continue;
      const pa = Object.fromEntries(Object.entries(a.sh).filter(([k]) => !SLOT.has(k)));
      const pb = Object.fromEntries(Object.entries(b.sh).filter(([k]) => !SLOT.has(k)));
      for (const k of Object.keys(a.sh)) if (!SLOT.has(k)) delete a.sh[k];
      for (const k of Object.keys(b.sh)) if (!SLOT.has(k)) delete b.sh[k];
      Object.assign(a.sh, pb); Object.assign(b.sh, pa);
      fitClip(a.sh, fps); fitClip(b.sh, fps);
    }
    // Removed shots: the shot before (or after) fills their time.
    for (let k = 0; k < list.length && list.length > 1; k++) {
      if (!edits.shots?.[list[k].key]?.remove) continue;
      const gone = list[k].sh;
      if (k > 0) list[k - 1].sh.durationInFrames += gone.durationInFrames;
      else { list[1].sh.from = gone.from; list[1].sh.durationInFrames += gone.durationInFrames; }
      const keep = k > 0 ? list[k - 1].sh : list[1].sh;
      fitClip(keep, fps);
      list.splice(k, 1); k--;
    }
    if (preview) for (const it of list) it.sh._key = it.key;
    sc.shots = list.map((x) => x.sh);
  });
  return t;
}

// Shot keys in the order they appear in the edited timeline (the page uses them to
// label clips; split halves get their "b" key).
export function shotKeys(timeline, edits = {}) {
  return timeline.scenes.map((sc) => {
    const keys = [];
    sc.shots.forEach((sh, k) => {
      const key = `${sc.id}-${k + 1}`;
      keys.push(key);
      const at = Math.round(Number(edits.splits?.[key]) || 0);
      if (at >= 6 && at <= sh.durationInFrames - 6 && sc.layout !== "split") keys.push(`${key}b`);
    });
    return keys.filter((k) => !edits.shots?.[k]?.remove || keys.length === 1);
  });
}
