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

### 4. Music (optional, recommended)
Download 20–30 tracks from your Epidemic Sound subscription (dark, tense, documentary) into `D:\Faceless\daily\music\`. The run picks a fitting track each night. If the folder is empty, it uses a built-in music bed.

### 5. Turn on the nightly run
```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\skills\daily-shorts\scripts\install-task.ps1" -Time 02:30
```

### 6. Test it now
```powershell
Start-ScheduledTask -TaskName "Faceless Daily Shorts"
```
Follow it in either place:
- the log: `D:\Faceless\daily\logs\<date>.log`
- the Studio website: the project appears with a live progress screen.

A run takes about 1–3 hours.

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
- **Claude Pro:** the nightly run shares your usage limit with everything else you do in Claude. If the limit runs out mid-run, the task retries up to 3 times, 2 hours apart.
- **3D:** routes and locations are 2D animated maps. Full 3D aircraft animation is not included yet.
- **Footage:** only free and public-domain sources (NTSB, FAA, NOAA, NASA, USGS, FEMA, DVIDS, Wikimedia, Pixabay, Coverr). Never news-channel footage.
