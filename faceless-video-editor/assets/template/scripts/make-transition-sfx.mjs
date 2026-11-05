// Builds one sound per transition type from the channel's own licensed effects
// (public/sfx/whoosh-*, hit, riser, spot/shutter), so a whip, a film burn and a dip
// don't all make the same noise. Each sound moves with its picture: stereo pans
// follow whips and wipes, a reversed swell rises into a dissolve, a deep boom lands
// on a dip. Writes public/sfx/tr<type>-N.wav; the audio step normalizes them.
//   node scripts/make-transition-sfx.mjs
import fs from "node:fs";
import path from "node:path";
import { PUBLIC, ffmpeg, fail, log } from "./lib.mjs";

const SFX = path.join(PUBLIC, "sfx");
const src = (f) => path.join(SFX, f);
for (const f of ["whoosh-1.mp3", "whoosh-2.mp3", "whoosh-3.mp3", "whoosh-4.mp3", "hit.mp3", "riser.mp3"]) if (!fs.existsSync(src(f))) fail(`public/sfx/${f} is missing`);
const stereo = "aformat=sample_rates=48000:channel_layouts=stereo";
// Volume moves from one speaker to the other across the sound's own length.
const pan = (dir, d) => (dir > 0 ? `aeval=val(0)*(1-0.85*t/${d})|val(1)*(0.15+0.85*t/${d}):c=stereo` : `aeval=val(0)*(0.15+0.85*t/${d})|val(1)*(1-0.85*t/${d}):c=stereo`);

const one = (input, filter, out) => [["-i", src(input)], `[0:a]${stereo},${filter}[o]`, out];
const mix = (a, fa, b, fb, out, w = "1 1") => [["-i", src(a), "-i", src(b)], `[0:a]${stereo},${fa}[a];[1:a]${stereo},${fb}[b];[a][b]amix=inputs=2:duration=longest:normalize=0:weights=${w}[o]`, out];

const RECIPES = [
  // Whip: short, bright, moves right to left with the picture.
  one("whoosh-2.mp3", `atempo=1.3,highpass=f=220,${pan(-1, 0.68)}`, "trwhip-1"),
  one("whoosh-3.mp3", `atempo=1.45,highpass=f=260,${pan(-1, 0.83)}`, "trwhip-2"),
  // Push: heavier whoosh with weight under it, also travelling.
  mix("whoosh-1.mp3", pan(-1, 1.46), "hit.mp3", "atrim=0:0.5,lowpass=f=130,afade=t=out:st=0.2:d=0.3,adelay=380|380", "trpush-1", "1 0.8"),
  mix("whoosh-4.mp3", pan(-1, 1.51), "hit.mp3", "atrim=0:0.5,lowpass=f=110,afade=t=out:st=0.2:d=0.3,adelay=500|500", "trpush-2", "1 0.8"),
  // Wipe: airy sweep from left to right.
  one("whoosh-1.mp3", `highpass=f=500,${pan(1, 1.46)}`, "trwipe-1"),
  one("whoosh-4.mp3", `highpass=f=600,${pan(1, 1.51)}`, "trwipe-2"),
  // Zoom: pitch drops as we fly through, a thud on arrival.
  mix("whoosh-3.mp3", "asetrate=48000*0.8,aresample=48000", "hit.mp3", "atrim=0:0.7,lowpass=f=170,afade=t=out:st=0.25:d=0.45,adelay=420|420", "trzoom-1", "1 0.9"),
  mix("whoosh-2.mp3", "asetrate=48000*0.74,aresample=48000", "hit.mp3", "atrim=0:0.7,lowpass=f=150,afade=t=out:st=0.25:d=0.45,adelay=330|330", "trzoom-2", "1 0.9"),
  // Flash: a fast rise that ends on an impact with the white frame.
  mix("riser.mp3", "areverse,atrim=0:0.75,areverse,asetpts=N/SR/TB,afade=t=in:d=0.35", "hit.mp3", "atrim=0:2.2,adelay=740|740,afade=t=out:st=1.8:d=1", "trflash-1", "0.8 1"),
  // Dip: deep boom that fills the black, long tail.
  one("hit.mp3", "asetrate=48000*0.62,aresample=48000,lowpass=f=520,aecho=0.8:0.6:180:0.3,afade=t=out:st=2.4:d=1.6", "trdip-1"),
  one("hit.mp3", "asetrate=48000*0.54,aresample=48000,lowpass=f=420,aecho=0.8:0.55:240:0.28,afade=t=out:st=2.6:d=1.8", "trdip-2"),
  // Dissolve: a soft reversed swell that peaks as the picture changes, then a short airy fall.
  one("whoosh-1.mp3", "areverse,lowpass=f=4200,highpass=f=120,aecho=0.8:0.5:90:0.25,afade=t=out:st=1.3:d=0.5", "trfade-1"),
  one("whoosh-4.mp3", "areverse,lowpass=f=3600,highpass=f=120,aecho=0.8:0.5:110:0.25,afade=t=out:st=1.35:d=0.5", "trfade-2"),
  one("whoosh-3.mp3", "areverse,asetrate=48000*0.88,aresample=48000,lowpass=f=4000,aecho=0.8:0.5:80:0.25", "trfade-3"),
  // Film burn: slowed, roomy rush, like light flaring across the gate.
  one("whoosh-4.mp3", "asetrate=48000*0.7,aresample=48000,highpass=f=160,aecho=0.8:0.7:120|260:0.4|0.25,afade=t=out:st=2.2:d=0.9", "trburn-1"),
  one("whoosh-1.mp3", "asetrate=48000*0.66,aresample=48000,highpass=f=160,aecho=0.8:0.7:140|300:0.4|0.25,afade=t=out:st=2.2:d=0.9", "trburn-2"),
];
// Shutter: the mechanical shutter sound when it is available, with weight under it.
const shutter = fs.existsSync(src("spot/shutter.mp3")) ? "spot/shutter.mp3" : "whoosh-2.mp3";
RECIPES.push(mix(shutter, "atrim=0:1.2", "hit.mp3", "atrim=0:0.6,lowpass=f=200,afade=t=out:st=0.2:d=0.4", "trshutter-1", "1 0.85"));
RECIPES.push(mix(shutter, "atrim=0:1.2,asetrate=48000*0.86,aresample=48000", "hit.mp3", "atrim=0:0.6,lowpass=f=170,afade=t=out:st=0.2:d=0.4", "trshutter-2", "1 0.85"));

for (const [inputs, graph, out] of RECIPES) {
  const dest = src(`${out}.wav`);
  const r = ffmpeg([...inputs, "-filter_complex", graph, "-map", "[o]", "-ar", "48000", "-c:a", "pcm_s16le", dest]);
  if (r.status !== 0) fail(`could not build ${out}`);
}
log("sfx", `${RECIPES.length} transition sounds in public/sfx/`);
