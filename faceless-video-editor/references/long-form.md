# Long Form (5-40+ minutes)

Same pipeline, different shape: `chapters` instead of `scenes`, landscape,
subtitles instead of pop captions, and a chunked render you can resume.

## What changes automatically for `format: "landscape"` / chapters

| | Shorts | Long form |
|---|---|---|
| Captions | `pop`, 3 words | `subtitle`, up to 8 words, bottom |
| Style default | `bold` | `documentary` |
| Edit style default | `viral` | `story` (see editing-playbook.md) |
| Shot length | 2.2s (viral) | 5s (story) |
| Transitions | every scene, cycling whip/zoom/glitch/flash | dip to black at every chapter |
| Chapter title cards | - | first 3.2s of each chapter |
| Music | one loop | one loop per mood, crossfaded at chapter changes |
| Render | single pass | ~5 min parts, cached, joined without re-encoding |
| Extra outputs | - | `build/youtube-chapters.txt` (paste into the description) |

## Workflow - never write 6000 words in one go

1. **Outline first.** Title, promise, 5-8 chapters (4-7 min each), 3-6 beats per
   chapter, where each open loop opens and closes. Show the outline to the user
   if they're around; it's the cheapest place to change direction.
2. **Write chapter by chapter** into `project.json`. Re-read the previous
   chapter's last scene before starting the next so the hand-offs connect.
3. **Voice it early**: `node scripts/auto.mjs --no-render` after the first two
   chapters. Real durations tell you whether you're on budget (2.5 words/sec;
   40 min ~ 6000 words ~ 300-400 scenes).
4. **Draft render** at half resolution to check flow cheaply:
   `REMOTION_FLAGS="--scale=0.5" npm run render`.
5. **Final render** without `--scale`. Parts already rendered at the same
   settings and unchanged are skipped; a crash resumes where it stopped.
6. **Check every chapter's contact sheets** (`out/check/chNN-*.jpg`), not just the first.

## project.json

```jsonc
{
  "title": "Voyager: The Machines That Refused to Die",
  "format": "landscape",
  "style": "documentary",
  "voice": { "provider": "edge", "voice": "en-US-AndrewNeural", "rate": "+0%", "concurrency": 4 },
  "music": { "volume": 0.1 },                 // mood comes from each chapter
  "brollSources": ["pixabay", "pexels"],      // Pixabay first: higher rate limit, mostly landscape
  "renderChunkMinutes": 5,
  "chapters": [
    {
      "title": "The Launch",
      "mood": "calm",
      "broll": ["rocket launch night", "nasa control room"],   // fallback for scenes without broll
      "scenes": [
        { "text": "In 1977 two spacecraft left Earth...", "broll": ["rocket launch slow motion"] },
        { "text": "...", "lowerThird": { "title": "Voyager 1", "subtitle": "Launched Sept 5, 1977" } },
        { "text": "...", "emphasis": "24 BILLION KM" }
      ]
    },
    { "title": "Lost in the Dark", "mood": "tense", "scenes": [ ... ] }
  ]
}
```

- Don't put `emphasis` or `lowerThird` on a chapter's first scene - the chapter
  card is there. `check` warns.
- Chapter titles: 1-5 words. YouTube needs the first chapter at 0:00 (done
  automatically), at least 3 chapters, each at least 10 seconds.

## Writing for retention (long form)

- **Cold open (first 30-60s)**: the most dramatic moment of the story or the
  sharpest version of the promise, then "but to understand how we got here...".
  No intro, no "welcome back", no subscribe ask in the first minute.
- **Each chapter opens with a question** and closes by answering it while
  opening the next one ("They fixed it. Then, in 2023, Voyager went silent.").
- **Pattern interrupt every 60-90s**: an `emphasis` number, a `lowerThird`, a
  `photo:` archival still, a mood change, a short scene after long ones.
- **Re-hook at 25%, 50%, 75%** with a line that raises the stakes.
- **Scenes of 2-4 sentences** (8-20s): fewer, longer scenes than Shorts, but
  `maxShotSeconds` keeps the picture changing every ~5s.
- **Ending**: pay off the cold open, one-line takeaway, then one CTA.

## B-roll at scale

A 40 minute video is ~400-500 shots. Searches are cached per keyword, so the
number of API calls is the number of *distinct* keywords.

- Pexels allows 200 searches/hour; Pixabay 100/minute. With both keys set and
  `"brollSources": ["pixabay", "pexels"]`, a 40 minute video searches in minutes.
- Pexels only? Expect to run `--from=broll` 2-3 times an hour apart, or set
  `"brollMaxWaitMinutes": 60` to let one run wait out the limit. Shots that
  fell back are filled in on the next run; shots that already have clips keep them.
- Give chapters a `broll` list so scenes without keywords still get footage.
- Reuse keywords deliberately: 2-3 keywords per *chapter theme* reused across
  its scenes keeps searches low and the look consistent (each shot still gets a
  different clip from the results).
- Long clips are trimmed to what the shot needs (`"trimBroll": false` to keep
  originals), so disk stays around 2 GB for 40 minutes.
- Use `photo:` for history (archival-looking stills with Ken Burns) and
  `file:` for anything you have rights to: screen recordings, maps, charts.

## Render time and resuming

Rough cost on an 8-core laptop at 1080p: 1-3x realtime, so 40 minutes takes
roughly 40 minutes to 2 hours. Faster: `REMOTION_FLAGS="--concurrency=<cores>"`.

`out/parts/manifest.json` records a hash per part (timeline content in that
range + all of `src/`). Edit a scene: its part re-renders, plus every later part
if the edit changed the scene's length (everything after it shifts). Earlier
parts are always kept, so fix late chapters freely and settle early chapters
first. Change a component in `src/`: everything re-renders. Audio is always
rendered in one pass for the whole video, so there are no clicks at the joins.

## Delivery extras

- `build/youtube-chapters.txt` - paste at the top of the description.
- `build/credits.txt` - stock creators.
- Suggest 3 title options; put the chosen one in `youtube.title`. `out/thumbnail.jpg` is
  rendered automatically. For long form, choose `thumbnail.scene` (the most striking
  B-roll) and the 2-4 words yourself (references/youtube-upload.md).
