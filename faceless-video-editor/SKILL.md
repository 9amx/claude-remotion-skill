---
name: faceless-video-editor
description: Fully automated faceless video production with Remotion - topic or script in, finished captioned video out. Use this skill EVERY time the user wants a faceless video, YouTube automation / "cash cow" channel content, Shorts/Reels/TikToks made from a topic, script, article, list, story or Reddit post, an AI voiceover video, a stock B-roll edit, auto-captioned narration, a top-10/facts/explainer/history/motivation/true-crime video, or says "make a video about X" without filming anything. Also trigger when they have their own voiceover recording and want B-roll + captions added automatically, want a batch of faceless videos, or want a long-form YouTube video (documentary, video essay, explainer, story) of 5 to 40+ minutes. Also use it to make a YouTube thumbnail or upload/schedule the finished video to YouTube. Handles script writing, TTS voiceover with word timestamps (free edge-tts, ElevenLabs, OpenAI) or Whisper on their own recording, Pexels/Pixabay B-roll, word-synced captions, music bed, SFX, rendering, loudness mastering, frame verification, thumbnail and YouTube upload. Works in any language (Bengali, Hindi, etc.).
---

# Faceless Video Editor

Turns a topic into a finished, upload-ready faceless video with one pipeline:

```
brief -> script (you write it) -> project.json
      -> voiceover + word timestamps -> B-roll per shot -> timeline.json
      -> music bed + SFX -> Remotion render -> -14 LUFS master -> contact-sheet check
      -> thumbnail -> (YouTube upload, only when the user wants it)
```

Everything mechanical is scripted in `assets/template/`. Your job is the parts that
decide whether anyone watches: **the hook, the script, the edit decisions, the
B-roll keywords, and the visual check.** Generic faceless videos fail on those,
never on rendering.

## Step 1 - Brief (ask only what you can't default)

| Field | Default if the user doesn't say |
|---|---|
| Topic / source text | required |
| Format | `shorts` (1080x1920). `landscape` for YouTube long-form, `square` for feed posts |
| Length | Shorts 30-45s. Landscape 8-15 min; up to 40+ min supported (see Long form) |
| Language + voice | match the user's language; see voice table in `references/voice-and-audio.md` |
| Style | `bold` (energetic), `documentary` (story/history/crime), `minimal` (tech/finance) |
| Music mood | `tense` for mysteries/facts, `calm` for stories/motivation, `upbeat` for lists/tips |
| Edit style | `viral` for Shorts, `story` for long form; `explainer`, `calm` by niche (see Step 2b) |

If the user gave a topic and nothing else, don't interrogate them. Pick defaults,
state them in one line, build.

**Look in the working folder first.** A recording there (`voice.wav`, `*.mp3`) plus
a script (`script.txt`, `.md`, `.docx`) means long form from the user's own
recording: `landscape`, `"voice": {"provider": "file"}`, the script word for word
as scene text (chapter headings `## ...` become chapters, `[...]` notes become
beats and are never spoken), `editStyle` `story`. Copy the recording to the
project's `public/`, `clips/` to `public/clips/`. `reference/` holds style
references: look at every image (and frames pulled from any video with ffmpeg),
read `notes.txt`, then write the style you will apply in a few lines (look,
cut pace, captions, graphics, transitions, sound) and render a 30-60 s preview
for approval before the full render. A YouTube link in the notes is never
downloaded: use only its public oEmbed data (`https://www.youtube.com/oembed?url=<link>&format=json`:
title, channel, thumbnail URL) and the screenshots. References inform style
only; never copy their wording or footage.

**Report every footage key that is set**, not just Pexels/Pixabay: `PIXABAY_API_KEY`,
`PEXELS_API_KEY`, `COVERR_API_KEY`, `DVIDS_API_KEY`, plus the Adobe and Epidemic
Sound connectors when present. Check with the environment, not assumptions
(`node -e "console.log(['PIXABAY','PEXELS','COVERR','DVIDS'].map(k=>k+':'+!!process.env[k+'_API_KEY']).join(' '))"`).

## Step 2 - Write the script into project.json

Read `references/script-formula.md` before writing. Non-negotiables:

1. **Hook in the first sentence, under ~14 words** - pick an archetype from
   `references/editing-playbook.md` (curiosity gap, bold claim, stakes, question,
   in medias res...). Never a warm-up ("In this video", "Did you know", greetings).
   Scene 1 always has an `emphasis` (2-4 words) - it is on screen on frame 0.
2. **Word budget = length x 2.5 words/sec** (at `rate: "+8%"`). 30s ~ 75 words,
   45s ~ 110, 60s ~ 150. Over budget means cut, not speed up.
3. **One scene = one idea = 1-2 sentences** (2-8s of speech). Shorts: 5-9 scenes.
4. **`emphasis` on at most 1 in 3 scenes** - numbers, reveals, the CTA. If
   everything is emphasized nothing is.
5. **B-roll as beats locked to the words.** Every scene's `broll` is a list of
   beats: `{"on": "words copied from the line", "kw": ["what to show", "a second angle"]}`.
   The shot starts on its `on` words, so the viewer sees the thing as they hear it.
   One beat per thing the line names (the noun, the action, the number), keywords
   concrete and filmable ("hands typing laptop night", not "productivity").
   Plain keyword strings still work, but they are only matched to the line
   automatically. Read `references/broll-keywords.md`.
   **Pick the source by what the line says** (`references/footage-sources.md`):
   stock for generic things, `archive:` for real people / places / events, and a
   **motion graphic** for facts: `{"on": "173 million", "graphic": {"type": "bars", ...}}`
   (counter, bars, map, timeline, quote; give every number or map a `source`).
   A graphic is drawn from your data, so it is exactly right; no stock clip can
   show "more people than Russia". 1-3 graphics in a Short, a few per minute in long form.
   **Write a shot list, not a keyword list.** Go through the line phrase by
   phrase and decide what the viewer must SEE while hearing it:

   | The words say... | Beat |
   |---|---|
   | a concrete thing, person, place, action | footage: `kw` = what the camera sees (subject + action + setting), 2-3 angles |
   | a real, named person / place / event / date | `archive:` (or DVIDS / the user's clip), plus `lowerThird` |
   | how something works, a process, "first... then..." | `graphic` `steps`, each step `on` its words |
   | several points, reasons, features, mistakes | `graphic` `list`, each item `on` its words |
   | A vs B, before/after, pros/cons, old/new | `graphic` `compare` (tone good/bad) |
   | the key claim, a definition, the thesis line | `graphic` `statement` (a few words, `highlight` the key one) |
   | an app, website, dashboard, product, setting | `graphic` `ui` with the user's screenshot and a `highlight` box |
   | a number / share / ranking / place / date / quote | `counter` / `bars` / `map` / `timeline` / `quote` |

   A new beat for every new idea, roughly every 2-4 s of speech: lint warns
   when one picture covers more than ~18 words (12 in a Short), because one clip
   under a long stretch stops matching what is said. Abstract lines ("this
   changes everything", "the real problem is trust") never get stock: use a
   `statement`, `list` or `compare`, or the concrete example the line refers to.
   Explainer items reveal on their own words:
   `{"on": "three things", "graphic": {"type": "list", "title": "Why it fails", "items": [{"text": "No budget", "on": "no budget"}, {"text": "Wrong team", "on": "the wrong people"}]}}`.
6. Mark 1-2 power words per scene with `*asterisks*` (the number, the twist):
   accent captions + punch-in zooms. The voice never hears the asterisks.
7. Last scene: a loop-back line or a CTA. Never "thanks for watching".

```json
{
  "title": "...", "format": "shorts", "editStyle": "viral", "style": "bold", "targetSeconds": 35,
  "voice": { "provider": "edge", "voice": "en-US-AndrewNeural", "rate": "+8%" },
  "music": { "mood": "tense", "volume": 0.12 },
  "scenes": [
    { "text": "Your phone was *designed* so you can't put it down.", "emphasis": "IT'S ON PURPOSE",
      "broll": [{ "on": "Your phone", "kw": ["person scrolling phone night"] },
                { "on": "can't put it down", "kw": ["phone screen glow face close up"] }] },
    { "text": "Every refresh works like a *slot machine*.", "layout": "split", "broll": ["finger swipe phone", "slot machine lever"] },
    { "text": "In 1956, a scientist found the same trick in pigeons.", "look": "flashback", "badge": "1956", "ambience": "sfx/amb/old-lab.mp3",
      "broll": [{ "on": "In 1956", "kw": ["archive:Skinner box pigeon"] },
                { "on": "the same trick", "kw": ["pigeon close up"], "sfx": "sfx/spot/pigeon-coo.mp3" }] },
    { "text": "The fix takes ten seconds.", "fx": "reveal", "emphasis": "10 SECONDS", "emphasisOn": "ten seconds",
      "broll": [{ "on": "The fix", "kw": ["file:my-clip.mp4"] }] },
    { "text": "...Follow for part two.", "visual": "kinetic" }
  ]
}
```
Working example: `assets/template/project.example.json`.
Full field reference: `references/project-schema.md`.

## Step 2b - Edit pass (this is where "high quality" comes from)

Read `references/editing-playbook.md`, then walk the scenes and decide the edit
on purpose:
- `editStyle`: viral | story | explainer | calm (pacing, transitions, zooms, SFX).
- Per scene where it earns it: `badge` (list items, dates), `lowerThird` (people,
  places), `layout: "split"` (comparisons), `look` (flashback, dramatic, night,
  vhs, dream), `transition` overrides, `fx`: `reveal` (the payoff / rehook),
  `freeze` (the moment it went wrong), `shake` (rarely).
- Pattern interrupt every 8-12s (Shorts) / 60-90s (long). Restraint everywhere else.
- Transitions: leave `transitionStyle: "auto"`, which picks by meaning (flash into a
  reveal, dip into a flashback or a new chapter, whip to the next list item, zoom
  into a comparison, otherwise whip and zoom alternate). Set `transition` on a scene only to break that rule on purpose.
- Sound design, like big channels: a beat `sfx` where the picture makes a sound
  (camera shutter, door slam, cash register, crowd gasp; or a kit sound: `hit`,
  `whoosh`, `pop`), and a scene `ambience` where the place has a sound (rain,
  city night, office hum, forest). 2-5 beat sounds in a Short, not one per cut.
  Files come from the Epidemic Sound connector or the user (see below).
- `emphasis` lands when the voice says its words (or `emphasisOn`), so the text
  and the word hit together.

Then run the gate: `node scripts/lint-script.mjs`. It checks the hook (warm-ups,
length, tension), word budget vs `targetSeconds`, scene and sentence length,
emphasis/highlight overuse, filmable keywords, interrupt spacing, long-form
rehook and the ending. **Fix every error** (`npm run auto` refuses to start
with errors) and act on the warnings unless you have a reason not to.

## Long form (5-40+ minutes)

Read `references/long-form.md` first. In short: use `"format": "landscape"` and
`"chapters": [{ "title", "mood", "broll", "scenes": [...] }]` instead of
`scenes`. That switches on subtitle captions, chapter title cards, per-chapter
music, lower thirds (`scene.lowerThird`), chapter-only transitions, YouTube
chapter timestamps, and a chunked render that resumes after a crash and
re-renders only the parts that changed. Outline first, write chapter by chapter,
voice early to check the budget, draft-render at `--scale=0.5`. Set both B-roll
keys and `"brollSources": ["pixabay", "pexels"]` - Pexels alone hits its hourly
limit on a 40 minute video (re-running `--from=broll` fills the gaps).
Template: `assets/template/project.longform.example.json`.

## Music and SFX from a pro library (Epidemic Sound connector)

Synthesized music and SFX are a fallback. If an Epidemic Sound connector (MCP)
is available in this session, or the user supplies files, use real sound:

1. **Music**: search by the video's mood, genre and energy (e.g. "dark
   suspense documentary underscore", "upbeat lo-fi", "inspiring piano"), prefer
   instrumental / no vocals under narration, and ask for a version close to the
   video length (the connector can make length-adjusted or looping versions).
   Download into `public/music/` and set `"music": {"file": "music/<name>.mp3"}`.
   Flow with the connector: search recordings (filter `vocals: false`) ->
   create an edit with `targetDurationMs` = the video length (max 5 minutes;
   poll the job, usually done in seconds) -> download the edit. For anything
   longer use one track per chapter, or `loopable: true`. Download links are
   signed and expire: fetch the file (e.g. `curl -L -o public/music/x.mp3 "<url>"`)
   right after getting the link.
   Long form: one track per chapter mood, `chapters[].music: "music/<name>.mp3"`;
   they crossfade at chapter changes.
2. **SFX**: download 1-3 variants per slot into `public/sfx/` named
   `<slot>.mp3` or `<slot>-1.mp3`, `<slot>-2.mp3` (variants rotate so repeated
   cuts don't sound identical). Slots and good searches:
   | slot | plays on | search for |
   |---|---|---|
   | `whoosh` | whip/zoom/flash transitions | "whoosh transition fast", "swoosh short" |
   | `hit` | frame 0, reveals | "cinematic impact boom", "hit deep" |
   | `riser` | before a reveal (~1.2s) | "riser short tension build" |
   | `pop` | emphasis text landing | "pop ui", "text appear" |
   | `scratch` | freeze frames | "record scratch" |
   | `glitch` | glitch transitions | "glitch digital short" |
   | `tick` | highlighted words | "click soft ui" |
   Prefer short, punchy files (whoosh/pop/tick under ~1.5s, riser ~1-2s). The
   pipeline measures each file's loudest moment and lines THAT up with the
   cut / word / reveal, so where the peak sits inside the file doesn't matter.
   Any slot without a file uses the synthesized one.
   **Beat sounds and ambience** (what the footage itself sounds like): search sound
   effects for the thing on screen ("camera shutter", "door slam", "cash register",
   "city street night ambience", "rain on window", "office ambience"), download into
   `public/sfx/spot/` and `public/sfx/amb/`, and reference them from the beat
   (`"sfx": "sfx/spot/shutter.mp3"`) or the scene (`"ambience": "sfx/amb/rain.mp3"`).
   Beat sounds are peak-normalized and start on the beat's cut; ambience is
   loudness-normalized, loops under the scene (scenes in a row with the same file
   share one loop) and ducks under the voice like the music.
3. The `audio` step normalizes everything (SFX peaks to -1 dB, music to -14 LUFS)
   so `sfxLevel` and `music.volume` behave the same with any source, and
   measures where each SFX peaks. Nothing in `public/sfx/` or `public/music/` is
   ever overwritten.
4. Licensing: downloads are covered by the user's active subscription (a
   Business plan also covers client work). Remind the user to connect their
   YouTube channel in their Epidemic account so uploads aren't claimed. Never
   download with someone else's account or use tracks after the subscription ends.

## Step 3 - Set up, then pick the footage yourself

```bash
cp -r <this-skill>/assets/template ./my-video && cd my-video
npm install
pip install edge-tts            # free TTS; skip if using elevenlabs/openai/file
# write project.json (Step 2); keys come from the user's environment:
# PIXABAY_API_KEY (stock; Pexels has paused new keys, an existing PEXELS_API_KEY still works),
# COVERR_API_KEY (stock video, optional), DVIDS_API_KEY (US government archive video, optional),
# OPENAI_API_KEY (ai: images, optional). Adobe Stock goes through the Adobe connector (below).
node scripts/auto.mjs --review
```
`--review` runs lint and the voiceover, then builds **candidate sheets** in
`build/review/<scene>-<shot>.jpg` for every shot: up to 6 options, numbered 1-6
left to right, top to bottom, from every source that fits the keyword.
`build/review.json` gives each shot's `words`: exactly what the voice says while
it is on screen. (`node scripts/fetch-broll.mjs --review=key` limits it to the
hook, emphasis / reveal / split scenes and weak matches, for very long videos.)

**Do the picking yourself, without asking the user** - this is what makes the
footage accurate. In long form, and whenever the user asks for accurate or
"perfect" footage, review EVERY shot (`--review`, never `--review=key`), chapter
by chapter (`--review --chapter=N`), and don't leave a single shot on the
automatic pick:
1. Look at every sheet (`build/review.json` has the keyword, the shot's `words`
   and each candidate's source/text). Pick the candidate that shows what those
   WORDS say, not just the keyword. The test: someone who only sees the tile
   could guess the words. A tile that only shares the keyword's mood ("city at
   night" bokeh for "Dhaka's traffic") fails it. Reject green screens, watermarks, text-heavy
   frames, dark or blurry tiles, and anything that contradicts the line.
2. Write the picks to `build/picks.json`: `{"s001-1": 3, "s002-2": 1}`.
3. No candidate fits? Change that keyword in project.json instead: more concrete
   words, `archive:` for real people / places / events / dates (Wikimedia
   Commons + NASA), `photo:` for stills, `ai:<prompt>` for something that
   can't be filmed (needs OPENAI_API_KEY; never for real events), or `file:` for
   the user's own asset. Re-run `node scripts/fetch-broll.mjs --review` and
   check the new sheet. With the **Adobe connector** in this session, search
   Adobe Stock for that shot too, build its sheet and add the licensed clip
   (`scripts/adobe-stock.mjs`, flow in `references/footage-sources.md`); free
   assets license directly, anything with a price only after the user says yes.
   A fact, number, place or quote with no honest footage: make the beat a `graphic`.
4. Continue: `node scripts/auto.mjs --from=broll` (downloads, frame-checks,
   renders, masters, checks).

Without picks the fetcher still chooses automatically (relevance-scored, with
black / green-screen clips rejected), so `npm run auto` works end to end; the
review is how you get from "plausible" to "accurate". It never uses a random
clip: a result that shares too few words with the keyword (`brollMinRelevance`,
default 0.4; cartoons, renders and holiday scenes count as no match unless asked for) is skipped, then the beat's other keywords are tried, then the
shot falls back to the kinetic background and the run says which words it
couldn't illustrate. Fix those keywords. Stock clips that are edits of several
shots are cut-detected; the timeline plays a stretch without an internal cut. Re-run any step with
`node scripts/auto.mjs --from=<step>` (lint, voice, broll, timeline, audio,
render, master, check). Voice, searches and downloads are cached.

CC BY / BY-SA archive images need attribution: the run says so - put
`build/credits.txt` in the video description.

User has their own recording? Put it in `public/`, set
`"voice": {"provider": "file", "file": "my-voice.mp3", "language": "bn"}` - the
pipeline cleans it (noise, de-ess, compression, -16 LUFS), gets word timestamps
(local whisper.cpp, or `"transcriber": "elevenlabs"` / `"openai"`, or the user's own
`"transcript"` JSON), splits it into the scenes and jump-cuts pauses over 0.4s
(`voice.tightenPauses: false` to keep them). `references/voice-and-audio.md` has the options.

If the render can't download Chrome, set `REMOTION_BROWSER=/path/to/chrome`
(Playwright's `chrome-headless-shell` works). No stock key? Archive photos and
`file:` assets still work; other shots fall back to an animated kinetic
background - fine for a test, not for a real upload; tell the user.

**Read the storyboard before any render.** `auto.mjs` writes it after the
timeline (`node scripts/storyboard.mjs` on its own): `build/storyboard/sb-NN-K.jpg`,
one tile per shot in order - the exact frame the edit will show (or a card for a
graphic) with its time and the words spoken over it underneath - plus
`storyboard.txt`. Look at every tile: does the picture show what its words say,
at that moment? Any tile that fails (or says NO FOOTAGE) is fixed now - a pick,
a sharper keyword, a split beat, or a graphic - then `--from=broll` again. The
storyboard costs seconds; a wrong shot found after the render costs the render.

**Show a preview before the full render.** For long form, after the picks:
render the first 30-60 s (`npx remotion render src/index.ts Faceless out/preview.mp4 --frames=0-1799`),
look at its frames, and tell the user in a few lines what the edit does (look,
cut pace, captions, graphics, transitions, music). Give them the preview to
approve; render the whole video only after that, so the first full render is
the one they keep.

## Step 4 - VERIFY (mandatory, never skip)

`npm run check` (last step of `auto`) writes `out/check/contact.jpg` (hook frames +
the middle of every shot) and lints the timeline and loudness. **Open
contact.jpg and look at it**, then open single frames where something looks off.
Check, in this order:

1. **Hook frame** (first two tiles): is something big, readable and moving? Is the
   emphasis inside the safe zone (not under the top 12% / bottom 20% UI)?
2. **Sync** - open `out/check/sync.txt` next to the sheet (tiles are numbered):
   each line is one shot with the words spoken over it, its keyword and how well
   the clip matched. Does every tile show what ITS words say? A wrong clip is
   worse than a kinetic background. Check the "weak?" and "KINETIC" lines first.
   Fix: better keyword or a pick from the review sheet, re-run `--from=broll`.
3. **Repeats**: same clip or same-looking clip twice in a row.
4. **Captions**: readable over every shot, no word touching the frame edge, no
   page over two lines.
5. **Effects landed where intended**: split screens show two different clips,
   looks read (flashback is clearly "the past"), freeze/reveal hit the right line.
6. The **retention report** `check` prints: first word under 0.5s, hook text on
   frame 0, longest hold without a visual change (<= 3.5s Shorts / 8s long),
   longest stretch without a pattern interrupt (<= 12s / 90s), speech rate,
   dead-air pauses. Fix every "(!)".
7. Lint warnings (short shots, overlong holds, loudness off -14 LUFS, kinetic ratio).

Long form: the check writes one or more sheets per chapter (`chNN-K.jpg`) and
prints each sheet's time range. Look at every chapter, not just the first.

Fix -> re-run the affected steps -> re-check. Deliver only after a clean pass:
no `KINETIC` line and no `weak?` line left in sync.txt, and every tile showing
its own words. Re-render only what changed (`--from=render` reuses unchanged parts).

## Step 5 - Deliver

`auto` also renders `out/thumbnail.jpg` (1280x720): scene 1's emphasis (or
`thumbnail.text`) over a frame of the best B-roll. **Look at it** like a contact
sheet: subject not hidden by the text, readable at phone size. Fix with
`thumbnail.text` / `scene` / `image` / `side`, then `npm run thumbnail`.

Write the upload metadata into `project.json` -> `"youtube"`: title (under 60
chars, curiosity gap), description (first two lines are the hook), tags,
3-5 hashtags. Chapters (`build/youtube-chapters.txt`) and credits
(`build/credits.txt`) are appended to the description automatically.

Give the user `out/final.mp4` + `out/thumbnail.jpg`, and the title, description and
hashtags in the reply. Mention anything you defaulted (voice, style, length).

## Step 6 - Upload to YouTube (when the user wants it)

Read `references/youtube-upload.md`. The first time, the user creates a Google
Cloud OAuth client (about 10 minutes, steps in the reference) and signs in once with
`node scripts/youtube.mjs --auth`. From a phone / a cloud session: a "TVs and
Limited Input devices" client in the environment (`YOUTUBE_CLIENT_ID`,
`YOUTUBE_CLIENT_SECRET`) and `node scripts/youtube.mjs --auth --device` run in
the background; give the user the code it prints for google.com/device. Then:

1. `node scripts/youtube.mjs --dry-run`: show the user the exact title, description,
   privacy and schedule, and **get an explicit yes**. A public upload can't be taken back.
2. `node scripts/youtube.mjs`: resumable upload + thumbnail, then the `youtu.be` link.
   Re-running resumes an interrupted upload and refuses duplicates (`--force` to override).

Defaults to `"privacy": "private"`. Scheduling: `"publishAt"` (ISO time, privacy
private). Tell the user the two limits up front: videos stay **locked private
until their Google Cloud project passes YouTube's API audit**, and the sign-in
expires every 7 days while the consent screen is in Testing.

## Editing rules baked into the template (don't fight them)

- Shots start on their beat's words (2 frames early, so the picture lands with
  the word); beats longer than ~`maxShotSeconds` get more shots of the same subject.
- Stock clips play a stretch without their own internal cut.
- Zoom-punch on every cut, Ken Burns drift on every shot, punch-ins on highlights,
  transitions + matching SFX between scenes (chapters in long form).
- Five-layer stack: mesh background -> footage -> scrim -> text -> grade/grain/vignette.
- Music (and ambience) duck under the voice and come up in the gaps between lines
  (`music.gapBoost`, default 1.7x), swell in the outro; hit SFX on frame 0.
- All colors, fonts, easings live in `src/theme.ts` (`STYLES`). Change the look there,
  never inline in a component. Bengali/Hindi glyph fallbacks are already loaded.

To change visuals beyond the presets (new caption style, lower thirds, maps,
charts), edit `src/components/` and follow the motion rules of the
`remotion-motion-graphics` skill if it is installed: springs not linear, 2-3
property entrances, staggers, exits faster than entrances.

## Batch mode

For N videos: one folder per video (`cp -r template video-01`), share
`node_modules` via a symlink, write each `project.json`, run `npm run auto` in each.
Check every contact sheet - batch is where unwatched mistakes ship.
For daily posting, give each project a `publishAt` a day apart and upload them all
at once (`references/youtube-upload.md`, Batch + schedule; about 6 uploads a day fit the default quota).

## Reference files
- `references/script-formula.md` - hooks, retention structure, niche templates, word budgets.
- `references/editing-playbook.md` - every edit tool, when to use it, niche recipes, hook archetypes, sound design.
- `references/broll-keywords.md` - turning lines into searchable, filmable keywords; beats; motion graphics.
- `references/footage-sources.md` - which source for which line, Adobe Stock through the connector, archives, paid libraries.
- `references/voice-and-audio.md` - providers, voices per language, music, loudness.
- `references/long-form.md` - chapters, retention for 10-40 min, B-roll at scale, chunked rendering.
- `references/project-schema.md` - every project.json field and what it does.
- `references/youtube-upload.md` - thumbnail options, Google Cloud setup, upload, scheduling, limits.
- `references/troubleshooting.md` - render, network, TTS and alignment failures.
