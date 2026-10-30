# Autopilot: a video a day, made, checked and uploaded on schedule

A scheduled task wakes a fresh Claude session at a set time every day. That
session makes the next video from start to finish, checks it like an editor,
uploads it for its slot with title, description and thumbnail, and reports back
(the scheduled task sends a push notification to the user's phone).

## What it makes, and what it never does

- **Topics** come from the user's queue first, then from the target channel's
  best-performing videos (`channel-research.mjs`: titles, views, lengths through
  the YouTube Data API).
- **Scripts are always new.** Research the topic yourself (2-4 reliable sources,
  listed in the description) and write it with `script-formula.md`. Never copy,
  translate or paraphrase the target's video: YouTube demonetizes channels for
  reused content, and a script is copyrighted like footage is. Same topic,
  your own facts, angle, hook and structure.
- **The user's own script or recording** (queue types `script` and `voice`) is
  kept word for word; you add the edit.
- **Nothing is uploaded that failed a check.** After `maxRevisionRounds` the job
  stays in the queue, and the report says what is wrong.

## One-time setup

### 1. The channel workspace (a private repository)
Copy `assets/channel/` into a new **private** repository (e.g. `yt-autopilot`):
`channel.json` (from `channel.example.json`), `autopilot.mjs`,
`channel-research.mjs`, `queue/`. It holds the queue, research and the upload
log, and every run commits to it. Keep it private: it is the channel's plan.

### 2. Google (YouTube) access that works without anyone signing in
Scheduled sessions start in an empty container, so the uploader takes a
refresh token from the environment instead of a sign-in:
1. Steps 1-3 of `youtube-upload.md` (project, YouTube Data API v3, consent screen).
2. Consent screen -> **Publishing status: In production**. Google shows an
   "unverified app" warning at sign-in (fine for your own channel: Advanced ->
   continue). In "Testing" the token dies after 7 days and the autopilot stops.
3. Credentials -> OAuth client ID -> **Web application**, authorized redirect URI
   `https://developers.google.com/oauthplayground`.
4. Open https://developers.google.com/oauthplayground -> gear icon -> "Use your
   own OAuth credentials" -> the client's ID and secret. Step 1: scopes
   `https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly`
   -> Authorize APIs -> pick the account AND the channel -> Allow. Step 2:
   "Exchange authorization code for tokens" -> copy the **Refresh token**.
5. Optional: Credentials -> API key (restrict it to YouTube Data API v3) for
   research.
6. **Public on schedule needs YouTube's API audit**: until the project passes it
   ("YouTube API Services - Audit and Quota Extension" form), API uploads are
   locked private. The autopilot still makes and uploads everything; the user
   then publishes each video in YouTube Studio (one tap), and the report says so.

### 3. The cloud environment's settings (never in the chat)
Environment menu in the session's title bar -> Edit:
- Environment variables: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`,
  `YOUTUBE_REFRESH_TOKEN` (the Web client's values + the token from step 4),
  `PIXABAY_API_KEY`, optionally `YOUTUBE_API_KEY`.
- Network access: allow `speech.platform.bing.com` (voice), `pixabay.com`,
  `cdn.pixabay.com`, `oauth2.googleapis.com`, `www.googleapis.com`,
  `nominatim.openstreetmap.org`, plus the archive and Adobe hosts if used
  (or a broader access level).

### 4. The schedule
Create the scheduled task (Claude does this when asked; the user names the
time): a fresh session per run (`create_new_session_on_fire`), push
notification on, about 2-3 hours before the first upload slot so a revision
round has time, in the user's time zone (e.g.
`CRON_TZ=Asia/Dhaka 47 15 * * *` for a 19:00 slot), connectors the run should
use (Adobe for stock, Epidemic Sound for music and SFX) if the user has them.
Its prompt is the block at the end of this file, filled in.

## The daily run (what the scheduled session does)

1. **Get the code.** `add_repo` + clone the skill repository and the channel
   workspace. `cd` into the workspace. `node autopilot.mjs next` gives the
   `slot` (when the video goes live) and the `job`. No job: report "queue empty
   and no research topics left" and stop. Research older than 14 days, or none:
   run `node channel-research.mjs <target>` first and commit it.
2. **Project.** Copy `faceless-video-editor/assets/template` to a work folder,
   `npm install`, `pip install edge-tts`. Settings from `channel.json`: format,
   language, voice, editStyle, style; `youtube`: privacy, categoryId, hashtags,
   `publishAt` = the slot when `upload.publishAtSlot` is true.
3. **Script** (SKILL.md Step 2 + `script-formula.md`):
   - `topic`: research it on the web, write an original script with a real
     hook; facts on screen as graphics with their source.
   - `script`: keep the user's words; split into scenes, add beats and markup.
   - `voice`: `voice.provider: "file"` with the recording; scenes from its text.
   The inspiration video (`job.inspiration`) is for the topic only: don't watch
   it for wording, don't follow its structure line by line.
4. **Edit pass** (Step 2b): beats with `on` for every shot, a graphic for
   every number / place / date that carries the story, sound design, motivated
   transitions. `node scripts/lint-script.mjs --strict` until clean.
5. **Footage.** `node scripts/auto.mjs --review`, pick EVERY shot from the
   sheets against its words (Adobe Stock through the connector where stock is
   weak; free assets only unless the user allowed paid ones), then
   `node scripts/auto.mjs --from=broll`.
6. **Revision (the gate).** Open every contact sheet, `out/check/sync.txt`, the
   retention report and `out/thumbnail.jpg`. All of these must hold:
   - hook: text on frame 0, voice within 0.5s, the strongest shot first;
   - every tile shows what its words say; no KINETIC fallback on the hook or a
     key beat; no "weak?" match left unchecked;
   - captions readable on every tile, nothing under the top/bottom UI zones;
   - transitions only where the story turns; no clip's own cut showing;
   - no "(!)" in the retention report; loudness -14 LUFS +-1;
   - the thumbnail: subject visible, 2-4 words readable at phone size;
   - facts: every number and name on screen matches a source.
   Fix what fails and re-run from the step it touches. At most
   `quality.maxRevisionRounds` rounds; still failing: stop, upload nothing,
   report the failures, keep the job.
7. **Upload.** Title (under 60 characters, curiosity gap, in the channel's
   language), description (hook line, sources, credits, hashtags), tags.
   `node scripts/youtube.mjs --dry-run`, then `node scripts/youtube.mjs`. The
   schedule is the user's standing yes for videos that passed every gate: no
   need to ask. If the API answers with a quota or upload-limit error, report
   it and keep the job for tomorrow.
8. **Record.** `node autopilot.mjs done <job.id> <videoId> <slot> --title "..." [--based-on <job.basedOn>]`.
   Copy the final `project.json` to `videos/<job.id>/project.json` in the
   workspace (scripts only, no media), commit and push the workspace.
9. **Report** (the last message; it is what the user's phone shows): the
   title, the link, when it goes live, revision rounds and what they fixed,
   anything defaulted or skipped. If the upload is locked private (no audit
   yet): "uploaded as private, publish it in YouTube Studio".

## Scheduled task prompt (fill in the <...>)

```
Daily YouTube autopilot for <channel name>. Follow faceless-video-editor/references/autopilot.md
("The daily run") exactly. Skill repo: <owner>/claude-remotion-skill. Channel workspace:
<owner>/<workspace repo>. Make one video for the next free slot, run every revision check,
upload it only if all checks pass, record it, push the workspace, and end with a short report
(title, link, go-live time, what the revision fixed). Never copy or paraphrase another channel's
script; topics only. Free stock only<, or: paid Adobe Stock allowed up to N per video>.
```

## The user adds things from the phone

- "Add to the queue: <topic>" / "this is my script for tomorrow" / an attached
  recording: write the queue file (`queue/README.md`), commit and push the workspace.
- "Change the time to 20:00" / "two videos a day": update `channel.json`
  (`schedule.times`) and the scheduled task's cron.
- "Pause" / "resume": disable / enable the scheduled task.
