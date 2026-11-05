# Advanced long-form tools

Built while producing real 15-30 minute documentaries with this template. None of
it is needed for a Short; reach for it when a long video has to look edited by a
person, not assembled.

## Studio (the editing app)

`npm run edit` (`node scripts/studio.mjs --open`, http://localhost:3300) - the real
composition playing live in the browser, a multi-track timeline, an inspector per
shot (motion, focus, speed, grade, transition, look, text, overlays, footage swap),
a mixer and a render queue. Edits are stored in `build/edits.json` and laid over
the timeline by `scripts/studio-overrides.mjs`, in the page for instant preview and
in `build-timeline` for the render, so the preview and the render agree and nothing
is lost when project.json is rebuilt.

```
build/edits.json
  shots:  { "s012-2": { move, focus:[x,y], zoomIn, speed, grade:{ bright, contrast, warm, tint },
                        graphic:{...}, overlays:[...], remove:true } }   (a split shot's 2nd half: "s012-2b")
  splits: { "s012-2": 45 }          split that shot 45 frames in
  swaps:  [["s012-1","s012-3"]]     two shots of one scene trade places (cuts stay on the words)
  scenes: { "s012": { transition, look, fx:[...], layout } }
  global: { voiceVolume, musicVolume, sfxLevel, captions, progressBar, chapterCards }
```

**Comments.** The owner can leave a comment on any frame in the Studio. Read them
before changing the edit and answer on the page:
`node scripts/comments.mjs` (open ones), `--reply=<id> "text"`, `--resolve=<id> ["text"]`.

The older single-page editor (`npm run editor`, port 3100) still works.
`node scripts/progress.mjs --watch` shows a running render's progress in the terminal.

## Stage graphics: one frame that builds up on the words

`"graphic": { "type": "stage", "items": [...] }` - a composed frame (business
documentary look) where each element lands on its own spoken words:

```json
{ "on": "70 billion", "graphic": { "type": "stage", "items": [
  { "el": "chart", "on": "70 billion", "points": [100, 82, 61, 44, 30] },
  { "el": "tag", "on": "wiped out", "text": "WIPED OUT IN TWO YEARS", "x": 76, "y": 30 },
  { "el": "number", "on": "two years", "text": "€70 bn", "x": 50, "y": 45, "until": 3 } ] } }
```

Elements: `number`, `title`, `tag`, `line` (a typed sentence with red keywords),
`chart` (drawn live), `donut`, `logo` / `logos` (white cards), `flag` / `flags`,
`person` (a black-and-white cut-out). Positions are % of the frame (element
center), sizes % of the frame height; `"until": k` removes an element when item k
arrives; `"sfx"` on an item plays a sound as it lands. The `cinema` style draws
the same items on graded, letterboxed footage (`StageCinema.tsx`).

## Overlays: motion graphics on the footage

A beat's `"overlays"` put graphics on the picture itself, each on its own words:

| type | does |
|---|---|
| `callout` | a dot on the thing, a line out to its name (`at`: point, `side`, `reach`) |
| `track` | brackets snap onto a subject and hold it (`at`, `size`) |
| `slug` | place and date written on in the top corner |
| `stat` | a number counting up in a panel (`value`, `prefix`, `unit`, `decimals`, `bar`) |
| `line` | the point of the sentence in a few words, low and centered (`hl`: accent word) |

```json
{ "on": "the Mirafiori plant", "kw": ["file:clips/plant.mp4"],
  "overlays": [{ "type": "slug", "text": "TURIN, ITALY", "sub": "1939", "on": "Mirafiori" },
               { "type": "callout", "text": "Main assembly hall", "at": [62, 40], "on": "plant" }] }
```

On a still, `at` is a picture point and follows the still's move, so a label stays
on the part it names. No overlays inside the long-form hook (`hookTextFreeSeconds`).

## Other explainer graphics

- `"type": "weapon"` - dossier card: the object alone on a light studio floor, a
  name tag with its year, three specs counting up (`name`, `year`, `era`, `image`,
  `specs`, `scale`, `flip`). Drawn from data, so it is always exact; a white
  background photo needs no cut-out.
- `"type": "model3d"` - 3D mechanism schematics built from code (no model files),
  each stage on its words: `model` one of `blowback`, `roller`, `closedBolt`,
  `gasIntro`, `gasCycle`, `armorStop`, `armorCompare`, `energy`, `size`,
  `magazines`, `cartridges`, ... (see `MODEL3D_NAMES`). Teaching schematics:
  proportions simplified.

## Still choreography

Stills no longer get one move each: by default a still gets a short
choreographed path (push, drift, parallax, rack focus, a snap) chosen from its
length, so a run of photos never repeats the same move. `"stillMotion": "simple"`
in project.json (or `"move"` on a beat) goes back to one move per still.
Extra moves: `parallax`, `diag-down`, `diag-up`, `reveal`, `tilt-rotate`,
`handheld`, `snap`, `slam`.

## Transitions and their sounds

On top of whip / zoom / glitch / flash / light / dip / fade / cut: `push` (both
pictures slide, motion-blurred), `wipe` (a soft diagonal edge with light along
it), `burn` (film burn blooming from one edge), `leak` (amber light leak),
`shutter` (dark blades close and open). Flash, burn, leak and shutter are drawn
above both pictures.

Each type can have its own sound: `node scripts/make-transition-sfx.mjs` builds
`public/sfx/tr<type>-N.wav` from the channel's own licensed effects
(`public/sfx/whoosh-*`, hit, riser, spot/shutter) - stereo pans follow whips and
wipes, a reversed swell rises into a dissolve, a deep boom lands on a dip. A
type without its own file falls back to the whoosh.

## Styles

`dossier`, `crimson` (black with a deep red glow, condensed numbers, red tags,
slashed chapter cards: big outlined number, red label, a red line across the
frame) and `cinema` (graded footage everywhere, letterbox, serif display face,
amber over teal) join `bold`, `documentary` and `minimal`. `"calloutStyle":
"subtitle"` sets text pops low and centered like a subtitle.

## Footage: more sources, hand-picking, a footage bank

**More free sources** are searched automatically (commercial-use licences only):
Wikimedia Commons video, NASA video, Internet Archive films (PD / CC BY / BY-SA),
Openverse, Smithsonian Open Access (CC0), Europeana photos and newsreels, Art
Institute of Chicago, Cleveland Museum of Art, NASA SVS (science video), Wellcome
Collection (medicine), iNaturalist (species, only when the keyword names one).
Subject gates keep them to lines they fit (SVS for science, Wellcome for
medicine, DVIDS only for military / disaster / aircraft / ship lines). Optional
keys: `UNSPLASH_ACCESS_KEY`, `FLICKR_API_KEY`, `SMITHSONIAN_API_KEY` and
`EUROPEANA_API_KEY` (demo keys work, rate-limited). A source that can't be
reached twice is skipped for the rest of the run.

**Hand-pick from one library** when a shot matters:
`node scripts/px.mjs search <name> "q1" ["q2"]` (Pixabay) or `scripts/cv.mjs`
(Coverr) writes a numbered sheet; `... get <name> <n>` saves `public/clips/<name>.mp4`
with its credit. `node scripts/commons-get.mjs list.json` downloads Wikimedia
Commons stills with their licences into `public/stills`.

**Footage bank** (`scripts/footage-bank.mjs`): a single DVIDS b-roll package holds
dozens of real shots. The bank downloads packages by theme (`build/bank-themes.json`)
into a folder outside `public/`, splits each at its cuts, and writes numbered
contact sheets per theme so an exact shot can be picked for each line; a picked
shot is cut straight from the 1080p file over HTTP (`--cut=build/bank-picks.json`).

## One shot, one use

`scripts/check-repeats.mjs` runs after the timeline (and with `--strict` before
the render): no footage or photo may appear twice in a video - library results,
bank picks, `file:` assets and images inside graphics alike. Two cuts from one
bank segment count as the same shot; different scenes from one long source video
are fine; a beat that carries on through the same clip is one continuous shot.

`node scripts/_stills.mjs` renders one late frame per shot and tiles them with the
shot id and its words (`build/frames/sheet-NN.jpg`) - a fast final look at every
graphic fully landed.
