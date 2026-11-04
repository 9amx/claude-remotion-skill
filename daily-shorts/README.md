# daily-shorts: one finished YouTube Short every night

Every night, Claude Code finds a recent real event and makes a Short about it. Topics are plane crashes, missing aircraft, aviation incidents and natural disasters. USA comes first, then Europe and other top-tier countries.

Each run, Claude:
- researches the event and verifies the facts,
- writes the script,
- voices it with ElevenLabs v3, including expression tags,
- edits it with the `faceless-video-editor` skill (9:16, maps, motion graphics, captions),
- passes a hard quality gate,
- uploads it to YouTube.

This guide covers a Windows laptop. The laptop has to be on, plugged in and signed in at night.

## One-time setup (about 30 minutes)

### 1. Install both skills
In PowerShell:
```powershell
cd D:\Faceless\claude-remotion-skill
git pull
Copy-Item -Recurse -Force .\faceless-video-editor $env:USERPROFILE\.claude\skills\
Copy-Item -Recurse -Force .\daily-shorts $env:USERPROFILE\.claude\skills\
```

### 2. Add the keys
Paste each key into the matching line yourself. Never send a key in a chat.
```powershell
setx ELEVENLABS_API_KEY "your-elevenlabs-key"
setx ELEVENLABS_VOICE_ID "the-voice-id"
setx DAILY_MODE "approval"
```
- ElevenLabs key: elevenlabs.io → Profile → API Keys.
- Voice ID: elevenlabs.io → Voices → pick a voice → copy its ID.
- `DAILY_MODE` decides how videos go up:
  - `approval` uploads each video as **private**. You check it in the YouTube Studio app and publish it.
  - `auto` uploads it **public**.

Keys you already set stay as they are:
- `PIXABAY_API_KEY`, `COVERR_API_KEY`, `DVIDS_API_KEY`
- `REMOTE_URL`, `REMOTE_AGENT_TOKEN` (Studio)

After `setx`, close PowerShell and open a new one.

### 3. Connect YouTube (once)
Follow `faceless-video-editor/references/youtube-upload.md` to create the Google Cloud OAuth client and save `client_secret.json`. Then sign in once from any project folder:
```powershell
cd D:\Faceless\video1\project
node scripts/youtube.mjs --auth
```
Until Google approves your API project (the "audit"), YouTube keeps API uploads private. You can still publish them by hand.

### 4. Phone notifications (optional, recommended)
1. Install the free **ntfy** app (Android / iPhone).
2. In the app, subscribe to a topic with a long random name nobody can guess, for example `faceless-k7q2x9m4p1`.
3. On the laptop:
   ```powershell
   setx DAILY_NOTIFY_URL "https://ntfy.sh/faceless-k7q2x9m4p1"
   ```
You get a push for every finished Short (with its link), every held Short (with the reason), and every failed or paused run.

### 5. Music (optional, recommended)
Download 20–30 tracks from your Epidemic Sound subscription (dark, tense, documentary) into `D:\Faceless\daily\music\`. The run picks a fitting track each night. If the folder is empty, it uses a built-in music bed.

### 6. Turn on the nightly run
```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\skills\daily-shorts\scripts\install-task.ps1" -Time 02:30
```

### 7. Test it now
```powershell
Start-ScheduledTask -TaskName "Faceless Daily Shorts"
```
Follow it in either place:
- the log: `D:\Faceless\daily\logs\<date>.log`
- the Studio website: the project appears with a live progress screen.

A run takes about 1–3 hours.

## How each Short is made, and its gates
1. **Learn:** fetches the views of past Shorts. Formats and topics that perform get picked more often.
2. **Find and measure:** 6–10 candidate events. YouTube search shows how much people watch each one right now (demand) and how crowded it is.
3. **Verify (gate 1, `factcheck.mjs`):** every fact needs two sources on two different sites, and each source must carry the exact sentence. The script opens every page and fails on:
   - a dead link,
   - a misquote,
   - a number or name in the voice, captions, graphics or title that no fact backs,
   - a map/globe place that doesn't match the verified coordinates.

   Causes need an official source. Casualty figures need to be less than 24 hours old.
4. **Script:** one of six formats, rotated: breaking, minute-by-minute, mystery, what-went-wrong, on-this-day, by-the-numbers. It has a hook of 14 words or fewer and a loop ending.
5. **Voice (gate 2, `voicecheck.mjs`):** every scene is transcribed again and compared with the script. A skipped, repeated or garbled phrase or a missing number means that scene is re-voiced.
6. **Edit:** decided beat by beat. Real footage is used only when it really shows this event and is allowed; each file is listed with its source and checked by gate 1. Where there is none, an animation explains it:
   - **3D globe:** the route, with a flying plane.
   - **Radar scope:** contact lost.
   - **Flight-profile chart:** altitude or speed over time.
   - **3D aircraft diagram:** which part failed, banking, pitching.
   - **Maps, timelines, counters, quotes.**

   Neutral stock footage is used only for context. Everything is vertical 9:16, and wide real footage is shown whole over a blurred background, never cropped.
7. **Quality (gate 3, `qa.mjs`):** checks for black frames, a frozen picture, dead air, clipping, loudness (−14 LUFS), audio/picture sync and length. Claude also looks at every second of the video. Fix and re-render, up to 5 rounds.
8. **Packaging (gate 4, `package-check.mjs`):**
   - hook and length,
   - a loop,
   - an honest searchable title with no bait,
   - sources in the description,
   - hashtags,
   - the AI-voice disclosure,
   - privacy that matches the mode,
   - the publish time: 12:00 New York time in auto mode. Change it with `setx DAILY_PUBLISH_ET "15:00"`.

If a gate fails and can't be fixed, the Short is **held**, not uploaded, and you get the reason.

## Every morning
For each day, look in `D:\Faceless\daily\<date>\`:
- `build\daily-log.md`: what Claude picked and why, the sources, and every check it ran.
- `build\daily-result.json`: one of these statuses:
  - `uploaded`: the video is on YouTube.
  - `held`: the video finished but did not pass a check, so it was not uploaded. The log says why.
  - `failed`: the run broke. The task tries again 2 hours later.
- `out\final.mp4`: the video.

In approval mode, open the YouTube Studio app, watch the new private Short, then publish it or delete it.

## Stop or change it
- Pause it: `Disable-ScheduledTask -TaskName "Faceless Daily Shorts"`
- Remove it: `Unregister-ScheduledTask -TaskName "Faceless Daily Shorts" -Confirm:$false`
- Change the time: run `install-task.ps1` again with a different `-Time`.

## Limits
- **Claude Pro:** the nightly run shares your usage limit with everything else you do in Claude. If the limit runs out mid-run, the task retries up to 3 times, 2 hours apart, and continues where it stopped.
- **3D:** the globe and the aircraft diagrams are 3D in a clean technical-drawing style (CSS/SVG 3D, fast on a laptop CPU). They are not photoreal 3D models.
- **Accuracy:** the gates catch dead links, misquotes, unbacked numbers and names, voice mistakes and wrong places. They cannot judge whether a source itself is wrong. That is why agencies come first, and why approval mode is the default.
- **Views:** demand checks, format rotation and the learning loop raise the odds. Nobody can promise views. Expect the first 2–4 weeks to be a test period while the channel builds its audience.
- **YouTube API audit:** until Google approves your API project, every upload stays private. Publish by hand, or apply for the audit in Google Cloud. The audit is free and takes a few weeks.
- **Footage:** only free and public-domain sources (NTSB, FAA, NOAA, NASA, USGS, FEMA, DVIDS, Wikimedia, Pixabay, Coverr). Never news-channel footage.
