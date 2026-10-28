---
name: faceless-video-editor
description: Fully automated faceless video production with Remotion - topic or script in, finished captioned video out. Use this skill EVERY time the user wants a faceless video, YouTube automation / "cash cow" channel content, Shorts/Reels/TikToks made from a topic, script, article, list, story or Reddit post, an AI voiceover video, a stock B-roll edit, auto-captioned narration, a top-10/facts/explainer/history/motivation/true-crime video, or says "make a video about X" without filming anything. Also trigger when they have their own voiceover recording and want B-roll + captions added automatically, want a batch of faceless videos, or want a long-form YouTube video (documentary, video essay, explainer, story) of 5 to 40+ minutes. Handles script writing, TTS voiceover with word timestamps (free edge-tts, ElevenLabs, OpenAI) or Whisper on their own recording, Pexels/Pixabay B-roll, word-synced captions, music bed, SFX, rendering, loudness mastering and frame verification. Works in any language (Bengali, Hindi, etc.).
---

# Faceless Video Editor

Turns a topic into a finished, upload-ready faceless video with one pipeline:

```
brief -> script (you write it) -> project.json
      -> voiceover + word timestamps -> B-roll per shot -> timeline.json
      -> music bed + SFX -> Remotion render -> -14 LUFS master -> contact-sheet check
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
5. **2-3 `broll` keywords per scene, concrete and filmable**: "hands typing laptop
   night", not "productivity". Read `references/broll-keywords.md`.
6. Mark 1-2 power words per scene with `*asterisks*` (the number, the twist):
   accent captions + punch-in zooms. The voice never hears the asterisks.
7. Last scene: a loop-back line or a CTA. Never "thanks for watching".

```json
{
  "title": "...", "format": "shorts", "editStyle": "viral", "style": "bold", "targetSeconds": 35,
  "voice": { "provider": "edge", "voice": "en-US-AndrewNeural", "rate": "+8%" },
  "music": { "mood": "tense", "volume": 0.12 },
  "scenes": [
    { "text": "Your phone was *designed* so you can't put it down.", "emphasis": "IT'S ON PURPOSE", "broll": ["kw a", "kw b"] },
    { "text": "Every refresh works like a *slot machine*.", "layout": "split", "broll": ["finger swipe phone", "slot machine lever"] },
    { "text": "In 1956...", "look": "flashback", "badge": "1956", "broll": ["photo:vintage laboratory"] },
    { "text": "The fix takes ten seconds.", "fx": "reveal", "emphasis": "10 SECONDS", "broll": ["file:my-clip.mp4"] },
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
# PIXABAY_API_KEY / PEXELS_API_KEY (stock), OPENAI_API_KEY (ai: images, optional)
node scripts/auto.mjs --review
```
`--review` runs lint and the voiceover, then builds **candidate sheets** in
`build/review/<scene>-<shot>.jpg`: up to 6 options per shot, numbered 1-6 left to
right, top to bottom, from every source that fits the keyword. By default it
covers the shots that matter most or that search is unsure about (the hook,
emphasis / reveal / split scenes, weak matches); `node scripts/fetch-broll.mjs
--review=all` covers every shot.

**Do the picking yourself, without asking the user** - this is what makes the
footage accurate:
1. Look at every sheet (`build/review.json` has the keyword, the line and each
   candidate's source/text). Pick the candidate that shows what the LINE says,
   not just the keyword. Reject green screens, watermarks, text-heavy frames,
   dark or blurry tiles, and anything that contradicts the line.
2. Write the picks to `build/picks.json`: `{"s001-1": 3, "s002-2": 1}`.
3. No candidate fits? Change that keyword in project.json instead: more concrete
   words, `archive:` for real people / places / events / dates (Wikimedia
   Commons + NASA), `photo:` for stills, `ai:<prompt>` for something that
   can't be filmed (needs OPENAI_API_KEY; never for real events), or `file:` for
   the user's own asset. Re-run `node scripts/fetch-broll.mjs --review` and
   check the new sheet.
4. Continue: `node scripts/auto.mjs --from=broll` (downloads, frame-checks,
   renders, masters, checks).

Without picks the fetcher still chooses automatically (relevance-scored, with
black / green-screen clips rejected), so `npm run auto` works end to end; the
review is how you get from "plausible" to "accurate". Re-run any step with
`node scripts/auto.mjs --from=<step>` (lint, voice, broll, timeline, audio,
render, master, check). Voice, searches and downloads are cached.

CC BY / BY-SA archive images need attribution: the run says so - put
`build/credits.txt` in the video description.

User has their own recording? Put it in `public/`, set
`"voice": {"provider": "file", "file": "my-voice.mp3"}` - the pipeline transcribes
it locally with whisper.cpp, splits it into the scenes and jump-cuts pauses
over 0.4s (`voice.tightenPauses: false` to keep them).

If the render can't download Chrome, set `REMOTION_BROWSER=/path/to/chrome`
(Playwright's `chrome-headless-shell` works). No stock key? Archive photos and
`file:` assets still work; other shots fall back to an animated kinetic
background - fine for a test, not for a real upload; tell the user.

## Step 4 - VERIFY (mandatory, never skip)

`npm run check` (last step of `auto`) writes `out/check/contact.jpg` (hook frames +
the middle of every shot) and lints the timeline and loudness. **Open
contact.jpg and look at it**, then open single frames where something looks off.
Check, in this order:

1. **Hook frame** (first two tiles): is something big, readable and moving? Is the
   emphasis inside the safe zone (not under the top 12% / bottom 20% UI)?
2. **B-roll relevance**: does each shot actually show what that line says? A wrong
   clip is worse than a kinetic background. Fix the keyword, delete the file from
   `public/broll/`, re-run `--from=broll`.
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

Fix -> re-run the affected steps -> re-check. Deliver only after a clean pass.

## Step 5 - Deliver

Give the user `out/final.mp4` plus, in the reply: a title (under 60 chars, curiosity
gap), a 1-2 line description, 3-5 hashtags, `build/youtube-chapters.txt` for
long form, and `build/credits.txt` if stock footage was used. Mention anything you defaulted (voice, style, length).

## Editing rules baked into the template (don't fight them)

- Cut every `maxShotSeconds` (from `editStyle`), snapped to word starts.
- Zoom-punch on every cut, Ken Burns drift on every shot, punch-ins on highlights,
  transitions + matching SFX between scenes (chapters in long form).
- Five-layer stack: mesh background -> footage -> scrim -> text -> grade/grain/vignette.
- Music ducks under the voice and swells in the outro; hit SFX on frame 0.
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

## Reference files
- `references/script-formula.md` - hooks, retention structure, niche templates, word budgets.
- `references/editing-playbook.md` - every edit tool, when to use it, niche recipes, hook archetypes, sound design.
- `references/broll-keywords.md` - turning lines into searchable, filmable keywords.
- `references/voice-and-audio.md` - providers, voices per language, music, loudness.
- `references/long-form.md` - chapters, retention for 10-40 min, B-roll at scale, chunked rendering.
- `references/project-schema.md` - every project.json field and what it does.
- `references/troubleshooting.md` - render, network, TTS and alignment failures.
