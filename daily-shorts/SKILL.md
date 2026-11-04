---
name: daily-shorts
description: Make one finished YouTube Short a day, unattended - research a recent real event (plane crashes, missing aircraft, aviation incidents, natural disasters; USA first, then Europe and other top-tier countries), verify the facts, write the script, voice it with ElevenLabs v3 (expressive audio tags), edit it with the faceless-video-editor skill (9:16, maps, motion graphics, captions), pass a hard quality gate, and upload it. Use when the nightly runner starts it ("daily-shorts run"), or when the user asks for today's short / a short about a recent incident.
---

# Daily Shorts

One Short per run, made to the standard of a top documentary Shorts channel. Quality beats
speed and cost: research thoroughly, check every fact, and do not ship anything that fails a check.

The editing itself is the **faceless-video-editor** skill (installed next to this one). Read its
SKILL.md and references when you build the project; this skill decides *what* to make and the
extra rules for real-world tragedies, then runs that pipeline.

## Inputs (set by `scripts/run-daily.ps1`, or ask when run by hand)

| What | Where |
|---|---|
| Project folder for today | the working directory (e.g. `D:\Faceless\daily\2026-11-04`), a copy of the editor template with `node_modules` linked |
| History of past topics | `../history.json` (one level up). Create it if missing: `{"videos": []}` |
| Mode | env `DAILY_MODE`: `approval` (default: upload **private**, the owner publishes) or `auto` (upload **public**) |
| Voice | env `ELEVENLABS_VOICE_ID` (and `ELEVENLABS_API_KEY`) |
| Footage keys | env `PIXABAY_API_KEY`, `COVERR_API_KEY`, `DVIDS_API_KEY` (whatever is set) |
| Music | `../music/` - tracks the owner downloaded from their own Epidemic Sound subscription |

Never print, log or commit API keys or tokens.

## The run, step by step

Work through these in order. Write progress notes to `build/daily-log.md` as you go (what you
picked and why, sources, every check and its result) - the owner reads it in the morning.

### 1. Find candidate topics (research)
Read `references/research.md`. Search the web for events from the **last 14 days** first, then
notable anniversaries ("on this day") and unresolved historical cases if nothing recent fits.
Collect 5-8 candidates. For each: what happened, where, when, official sources, what visuals
exist that we may legally use, and why a viewer would stop scrolling.

Skip any topic already in `history.json` (same event, even with a different angle) and anything
covered in the last 30 days that is too similar.

### 2. Pick one and verify it
Score candidates with the table in `references/research.md`. Pick the best. Then verify every
fact you will say with **at least two independent reliable sources** (official investigators,
agencies, or two major outlets). Write `build/research.md`: the facts, each with its sources and
links, plus what is *not* known yet. If the key facts cannot be confirmed, pick the next topic.

### 3. Write the script
Read `references/script.md`. 40-55 seconds spoken (about 110-140 words), one idea, a hook in
the first line, a payoff at the end. No speculation about causes or blame that investigators
have not stated. Respectful about victims. Then review your own script as a strict editor:
every claim checked against `build/research.md`, numbers and names exact, nothing filler.
Rewrite until it passes.

### 4. Build the project
Use the faceless-video-editor workflow with these settings in `project.json`:
- `"format": "shorts"`, `"editStyle": "viral"` for breaking incidents or `"story"` for history,
  `"style": "documentary"` (or `"bold"` when the story is fast and numeric).
- `"voice": { "provider": "elevenlabs", "model": "eleven_v3" }` - the voice ID comes from the
  environment. Put ElevenLabs v3 audio tags in the scene text where the delivery should change
  (see `references/script.md`); they are spoken as delivery only, captions never show them.
- Captions on (Shorts default). Text pops only for numbers, names and dates that matter.
- Visual plan from `references/visuals.md`: a map with the route or location, a timeline or
  counter where it explains, archival/official photos and footage, stock B-roll for mood.
- Music: pick a track from `../music/` that fits (tense or calm), copy it into `public/music/`
  and set `"music": { "file": "music/<name>.mp3", "volume": 0.1 }` (faceless-video-editor
  `references/voice-and-audio.md`). Do not use the same track two days in a row (check history).
  No tracks there: use `"music": { "mood": "tense" }` (built-in) and note it in the log.
- `"youtube"`: title (under 60 characters, no clickbait lies), description with the sources list
  from `build/research.md`, 5-10 tags, `"syntheticMedia": true` (AI voice), `"categoryId": 25`
  (News & Politics) for news or `27` (Education) for history, and
  `"privacy"`: `"private"` in approval mode, `"public"` in auto mode.

Run the editor pipeline (`node scripts/auto.mjs`). Fix every lint and footage problem it reports.

### 5. Review and polish (do this properly - it is the job)
Follow the faceless-video-editor review gate, then read `references/qa.md` and go through all
of it:
- Look at **every tile** of `out/check/contact*.jpg`, `out/qa/hook.jpg` and `out/qa/sheet-*.jpg`.
  Every shot must show what the voice says at that moment; no watermark, no unrelated or
  disrespectful image, no wrong aircraft type, no wrong country on a map.
- Read every caption against the script. Check names, numbers, flight numbers, places, dates.
- `node scripts/qa.mjs` must PASS (black frames, frozen picture, dead air, clipping, loudness,
  sync, length). If anything fails or looks weak: fix it, render again, check again. Repeat
  until it is clean. Up to 5 rounds; if it is still not clean, do not upload.

### 6. Upload and record
- If QA passed and you are satisfied: `node scripts/youtube.mjs`. (First time on this machine
  the owner signs in once with `node scripts/youtube.mjs --auth`; if there is no sign-in, stop
  and say so - do not try to sign in unattended.)
- Append to `../history.json`: date, topic, event date, title, video id/URL, privacy, sources.
- Write `build/daily-result.json`: `{"status": "uploaded" | "held" | "failed", "title", "url",
  "privacy", "reason", "qa": out/qa/report.json summary}`. "held" = finished but not uploaded
  (a check failed, or nothing good enough to make today).
- Finish with a short summary: topic, why it was chosen, title, link, anything the owner should
  look at.

## Hard rules
- No footage, photos or audio from TV channels, news sites or other YouTubers. Only sources in
  the faceless-video-editor footage list and the public-domain sources in `references/visuals.md`.
- Never show victims' bodies, injured people, or identifiable grieving families. No crash
  "re-enactment" that pretends to be real footage; reconstructions are maps and diagrams.
- Never state a cause, blame a person, or give a death toll that the official sources do not.
  Say "investigators have not said why yet" when that is the truth.
- If the voice, footage or upload service fails, stop with a clear message in
  `build/daily-result.json`; never upload a half-finished video.
