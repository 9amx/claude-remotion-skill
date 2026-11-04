---
name: daily-shorts
description: Make one finished YouTube Short a day, unattended - research a recent real event (plane crashes, missing aircraft, aviation incidents, natural disasters; USA first, then Europe and other top-tier countries), pick the topic with the most viewer demand, verify every fact against sources that are checked automatically, write a high-retention script, voice it with ElevenLabs v3 (expressive audio tags), edit it with the faceless-video-editor skill (9:16, 3D globe, maps, motion graphics, captions), pass fact, voice, packaging and quality gates, and upload it. Use when the nightly runner starts it ("daily-shorts run"), or when the user asks for today's short / a short about a recent incident.
---

# Daily Shorts

One Short per run, made to the standard of a top documentary Shorts channel, for two goals that
do not trade off: **every fact correct**, and **as many views and subscribers as possible**.
Quality beats speed and cost. Nothing ships that fails a gate.

The editing itself is the **faceless-video-editor** skill (installed next to this one). Read its
SKILL.md and references when you build the project. This skill decides what to make, how to
package it for Shorts, and adds four gates. `<skill>` below means this skill's folder
(the "Base directory" you were given); run its scripts from the project folder:
`node <skill>/scripts/factcheck.mjs`.

## Inputs

| What | Where |
|---|---|
| Project folder for today | the working directory (e.g. `D:\Faceless\daily\2026-11-04`), a copy of the editor template with `node_modules` linked |
| History and results | `../history.json` (every Short made), `../performance.json` (what got views; refreshed by `yt-stats.mjs`) |
| Mode | env `DAILY_MODE`: `approval` (default: upload **private**, the owner publishes) or `auto` (public at the next US peak slot) |
| Voice | env `ELEVENLABS_VOICE_ID`, `ELEVENLABS_API_KEY` |
| Footage keys | env `PIXABAY_API_KEY`, `COVERR_API_KEY`, `DVIDS_API_KEY` |
| Music | `../music/` (the owner's own Epidemic Sound downloads) |

Never print, log or commit keys or tokens.

## Resume first
The run may be a retry (usage limit, crash). If `build/daily-log.md` exists, read it and
`build/` and **continue from where it stopped** - same topic, keep finished work (facts, voice,
footage). Never start a second topic in the same folder. If `build/daily-result.json` says
uploaded or held, stop.

## Step by step
Log every decision and every gate result in `build/daily-log.md` as you go.

### 1. Learn from the channel
`node <skill>/scripts/yt-stats.mjs` (the runner already did it; run it if `../performance.json`
is missing or older than a day). Read `../performance.json`: which formats and categories get the
most views at 72 h. Lean towards what works, but keep testing: at least 1 day in 4 tries a
different format or category.

### 2. Find candidates
`references/research.md`. 6-10 candidate events, newest first (last 14 days), then strong
anniversaries this week, then unresolved classics. For each: what happened, official sources,
usable visuals, and 1-2 search phrases people would type (`"delta flight 2210"`,
`"tampa tornado"`). Drop anything already in `../history.json`.

### 3. Measure demand and pick
Save the candidates to `build/candidates.json` (`[{"id","title","query","category","date"}]`) and run
`node <skill>/scripts/yt-demand.mjs --file=build/candidates.json`. Score each candidate with the
table in `references/research.md`, which combines demand, crowding, freshness, verifiability,
visuals and harm. Pick the best. Then pick the **format** from `references/formats.md` (rotate:
not the same format 2 days in a row; follow `performance.json`). Write the choice and the scores
into the log.

### 4. Verify (gate 1: facts)
Research the picked event properly. Write `build/facts.json` (format in the header of
`scripts/factcheck.mjs`): every fact you will say or show, each with 2+ sources on different
sites, each source with the **exact sentence copied from the page** (`quote`), the official
investigators' or agencies' pages first; `places` with exact coordinates.
Then: `node <skill>/scripts/factcheck.mjs` - it opens every page, checks the quotes are really
there, and later checks that every number and name in the video is backed. Fix until PASS.
If key facts cannot be verified, go back to step 3 and take the next candidate.

### 5. Script
`references/script.md` and the format's structure from `references/formats.md`. 110-140 words,
under 55 seconds, hook of 14 words or fewer, a loop ending. Write ElevenLabs v3 audio tags where
the delivery should change. Self-review as a strict editor against `build/facts.json`.

### 6. Build the project
faceless-video-editor workflow, with:
- `"format": "shorts"`, `"editStyle": "viral"` (breaking, by-the-numbers) or `"story"` (mystery,
  minute-by-minute, on-this-day), `"style": "documentary"`, `"loop": true`, `"outroMs": 300`.
- `"voice": { "provider": "elevenlabs", "model": "eleven_v3" }` (voice ID from the environment).
- Visuals: decide **beat by beat** with `references/visuals.md`. Use real footage or photos of the
  event when they are exactly right and allowed. Download them to `public/footage/`, use `file:`
  beats and list them in `facts.json` `"media"`. Where none exists, explain with the best-fitting
  animation:
  - `globe`/`map` for where and the route (3D/2D)
  - `radar` for contact lost (instrument UI)
  - `profile` for altitude/speed/wind over time (2D)
  - `aircraft` for which part failed and how it banked or pitched (3D airliner over clouds;
    twin-engine jet airliners only, `light` = local time of the event)
  - `timeline`/`counter`/`quote`/`statement` for sequence, numbers and official words

  Use neutral stock only for context, never as the event. Keep everything 9:16: wide real footage
  gets `"fit": true` (automatic for `file:`/official), or `"focus"` when cropping is safe.
  Open on the globe or real footage.
- Music: a fitting track from `../music/` copied into `public/music/`, `"music": { "file": ..., "volume": 0.1 }`;
  not the same track as yesterday. None there: `"music": { "mood": "tense" }`.
- `"daily": { "format", "category", "topic" }` (for learning what works).
- `"youtube"`: see `references/packaging.md` - title, description with "Sources:", tags,
  hashtags incl. `shorts`, `"syntheticMedia": true`, `"categoryId": 25` (news) or `27` (history),
  privacy `"private"` in approval mode; in auto mode `"privacy": "private"` with
  `"publishAt"` = the output of `node <skill>/scripts/package-check.mjs --slot`.

Run `node scripts/auto.mjs --no-render` first (lint, voice, footage, timeline).

### 7. Voice (gate 2)
`node <skill>/scripts/voicecheck.mjs` - transcribes every scene and compares it with the script.
On FAIL: re-voice those scenes (adjust the wording or add `"seed"` to `voice`, delete
`build/vo/sNNN.json`, run `node scripts/auto.mjs --only=voice`, then `--from=broll`). Up to 3
takes per scene; then rewrite the line.

### 8. Render and review (gate 3: quality)
`node scripts/auto.mjs --from=render` (renders, masters, checks, runs `qa.mjs`). Then do all of
`references/qa.md`: look at every tile of `out/qa/hook.jpg`, `out/qa/sheet-*.jpg` and
`out/check/contact*.jpg`; fix and re-render until clean (up to 5 rounds).

### 9. Package (gate 4) and upload
`node <skill>/scripts/factcheck.mjs` again (captions, titles, graphics are final now) and
`node <skill>/scripts/package-check.mjs`. Both must PASS; fix every warning you can.
Then `node scripts/youtube.mjs`. (No sign-in on this machine: stop with status "held" and the
reason - never try to sign in unattended.)

### 10. Record
- Append to `../history.json` `videos`: `{ date, topic, eventDate, title, videoId, url, privacy,
  format, category, query, sources: [urls], uploadedAt }`.
- `build/daily-result.json`: `{ "status": "uploaded" | "held" | "failed", "title", "url", "privacy",
  "reason", "gates": { "facts", "voice", "qa", "package" } }`. "held" = finished but not
  uploaded; "failed" = could not finish (the runner retries).
- Last message: topic and why, format, title, link, the gate results, anything to look at.

## Hard rules
- Only footage you may use: faceless-video-editor sources and the public-domain list in
  `references/visuals.md`. Never TV or news footage, other channels' clips, or social posts.
- Never show victims, bodies, injured or grieving people. Reconstructions are maps and diagrams,
  never fake "real" footage.
- Never state a cause, blame, or a casualty number the official sources do not. "Investigators
  have not said why" is a fine line.
- No tragedy bait in titles or text ("shocking", "horrific", "you won't believe").
- A gate failing that cannot be fixed means status "held". An empty day is better than a wrong video.
