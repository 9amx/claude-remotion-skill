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
decide whether anyone watches: **the hook, the script, the B-roll keywords, and
the visual check.** Generic faceless videos fail on those, never on rendering.

## Step 1 - Brief (ask only what you can't default)

| Field | Default if the user doesn't say |
|---|---|
| Topic / source text | required |
| Format | `shorts` (1080x1920). `landscape` for YouTube long-form, `square` for feed posts |
| Length | Shorts 30-45s. Landscape 8-15 min; up to 40+ min supported (see Long form) |
| Language + voice | match the user's language; see voice table in `references/voice-and-audio.md` |
| Style | `bold` (energetic), `documentary` (story/history/crime), `minimal` (tech/finance) |
| Music mood | `tense` for mysteries/facts, `calm` for stories/motivation, `upbeat` for lists/tips |

If the user gave a topic and nothing else, don't interrogate them. Pick defaults,
state them in one line, build.

## Step 2 - Write the script into project.json

Read `references/script-formula.md` before writing. Non-negotiables:

1. **Hook in the first sentence, under 2 seconds** - a claim, a stakes, or a
   pattern break. Never "In this video..." or "Did you know...". Scene 1 always has
   an `emphasis` (2-4 word on-screen hook).
2. **Word budget = length x 2.5 words/sec** (at `rate: "+8%"`). 30s ~ 75 words,
   45s ~ 110, 60s ~ 150. Over budget means cut, not speed up.
3. **One scene = one idea = 1-2 sentences** (2-8s of speech). Shorts: 5-9 scenes.
4. **`emphasis` on at most 1 in 3 scenes** - numbers, reveals, the CTA. If
   everything is emphasized nothing is.
5. **2-3 `broll` keywords per scene, concrete and filmable**: "hands typing laptop
   night", not "productivity". Read `references/broll-keywords.md`.
6. Last scene: a loop-back line or a CTA. Shorts that loop get replayed.

```json
{
  "title": "...", "format": "shorts", "fps": 30, "style": "bold",
  "voice": { "provider": "edge", "voice": "en-US-AndrewNeural", "rate": "+8%" },
  "music": { "mood": "tense", "volume": 0.12 },
  "captions": { "style": "pop", "maxWords": 3 },
  "maxShotSeconds": 2.8,
  "scenes": [
    { "text": "spoken line", "emphasis": "ON SCREEN", "broll": ["kw a", "kw b"] },
    { "text": "...", "broll": ["file:my-clip.mp4", "photo:old map"] },
    { "text": "...", "visual": "kinetic" }
  ]
}
```
Full field reference: `references/project-schema.md`.

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

## Step 3 - Set up and run

```bash
cp -r <this-skill>/assets/template ./my-video && cd my-video
npm install
pip install edge-tts            # free TTS; skip if using elevenlabs/openai/file
# write project.json (Step 2)
export PEXELS_API_KEY=...       # free at pexels.com/api - strongly recommended
npm run auto
```
`npm run auto` runs every step and prints what it did. Re-run from a step with
`node scripts/auto.mjs --from=broll` (steps: voice, broll, timeline, audio,
render, master, check). Voiceover and downloads are cached, so editing one
scene's text only re-voices that scene.

User has their own recording? Put it in `public/`, set
`"voice": {"provider": "file", "file": "my-voice.mp3"}` - the pipeline transcribes
it locally with whisper.cpp and splits it into the scenes.

If the render can't download Chrome, set `REMOTION_BROWSER=/path/to/chrome`
(Playwright's `chrome-headless-shell` works). No B-roll key? Shots fall back to an
animated kinetic background - fine for a test, not for a real upload; tell the user.

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
5. Lint warnings (short shots, overlong holds, loudness off -14 LUFS, kinetic ratio).

Long form: the check writes one or more sheets per chapter (`chNN-K.jpg`) and
prints each sheet's time range. Look at every chapter, not just the first.

Fix -> re-run the affected steps -> re-check. Deliver only after a clean pass.

## Step 5 - Deliver

Give the user `out/final.mp4` plus, in the reply: a title (under 60 chars, curiosity
gap), a 1-2 line description, 3-5 hashtags, `build/youtube-chapters.txt` for
long form, and `build/credits.txt` if stock footage was used. Mention anything you defaulted (voice, style, length).

## Editing rules baked into the template (don't fight them)

- Cut every `maxShotSeconds` (2.8s Shorts, 5s landscape), snapped to word starts.
- Zoom-punch on every cut, Ken Burns drift on every shot, flash + whoosh between scenes.
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
- `references/broll-keywords.md` - turning lines into searchable, filmable keywords.
- `references/voice-and-audio.md` - providers, voices per language, music, loudness.
- `references/long-form.md` - chapters, retention for 10-40 min, B-roll at scale, chunked rendering.
- `references/project-schema.md` - every project.json field and what it does.
- `references/troubleshooting.md` - render, network, TTS and alignment failures.
