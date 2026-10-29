# Thumbnail + YouTube upload

Two scripts finish the job after `check`:

- `scripts/thumbnail.mjs` renders `out/thumbnail.jpg` (1280x720, under 2 MB).
  `npm run auto` runs it after `check`.
- `scripts/youtube.mjs` uploads `out/final.mp4` with title, description,
  tags, chapters, credits, schedule and the thumbnail. It runs only when asked:
  `npm run auto -- --upload` or `node scripts/youtube.mjs`.

## Thumbnail

```jsonc
"thumbnail": {
  "text": "THE 3AM RULE",     // 2-4 words; default: scene 1's emphasis, else the title
  "scene": 4,                 // whose B-roll to grab a frame from (1-based); default: first reveal scene, else 1
  "image": "thumb/mine.jpg",  // or your own picture in public/ (wins over scene)
  "side": "left",             // text side: left | right (put it opposite the subject)
  "style": "bold"             // default: the video's style
}
```
`"thumbnail": false` skips it. The text is fitted by measuring it, so Bengali and
Hindi come out as big as Latin text. Use `\n` in `text` to choose the line breaks.

**Look at `out/thumbnail.jpg` before uploading.** Check that the subject isn't
under the text, the words read at phone size (imagine it 1/6 as wide), and that
the bottom-right corner, where YouTube puts the duration, holds nothing important.
Wrong frame: set `thumbnail.scene` or `thumbnail.image` and run `npm run thumbnail`.

Thumbnail text is not the title: 2-4 words that add to the title ("Why your
phone is addictive" -> "IT'S ON PURPOSE"), never repeat it.

Shorts mostly show a frame from the video rather than the custom thumbnail, so
for Shorts the hook frame matters more. For long form the thumbnail is half the click.

## One-time setup (the user does this, about 10 minutes)

The upload goes through the user's own Google Cloud project. Walk them through it:

1. https://console.cloud.google.com -> create a project (e.g. "faceless-uploader").
2. APIs & Services -> Library -> **YouTube Data API v3** -> Enable.
3. OAuth consent screen (Google Auth Platform): user type **External**, fill in
   the app name and email, and under **Test users / Audience** add the Google
   account that owns the channel.
4. Credentials -> Create credentials -> OAuth client ID -> type **Desktop app**
   -> Download JSON. Save it as:
   - macOS / Linux: `~/.config/faceless-video/client_secret.json`
   - Windows: `%APPDATA%\faceless-video\client_secret.json`
   (or a `client_secret.json` in the project folder, or `YOUTUBE_CLIENT_SECRET=/path`)
5. Sign in once: `node scripts/youtube.mjs --auth`. A browser opens: pick the
   account, then the channel (brand accounts are listed there), and allow access.
   It prints the channel name it connected to. If the browser runs on another
   machine, paste the address the browser ended on (`http://127.0.0.1:...?code=...`)
   into the terminal.

The token is saved next to `client_secret.json`, outside the project, so every
video folder of a batch uses it. Never commit `client_secret.json` or the token
(both are in `.gitignore`).

More than one channel: `--auth --account=cooking`, then `"youtube": {"account": "cooking"}`
in that channel's projects (or `--account=cooking` when uploading).

### Limits to tell the user up front

- **Videos are locked to private until the Google Cloud project passes an audit.**
  YouTube locks videos uploaded through the API from unverified projects to
  private. To publish them as public or unlisted (or scheduled) automatically,
  the project needs YouTube's API compliance audit (the "YouTube API Services -
  Audit and Quota Extension" form). Until then, upload as private and make the
  video public in YouTube Studio by hand. That is still one click per video.
- **Sign-in expires after 7 days** while the consent screen is in "Testing".
  The script then says so: run `--auth` again. Publishing the app to
  "In production" removes the expiry but needs Google's verification for this scope.
- **Quota:** 10,000 units a day by default. An upload costs about 1,600, so about
  6 uploads a day. Check the current costs in Google's quota calculator.
- **Custom thumbnails** need a verified channel (phone verification at
  youtube.com/verify). Without it the video still uploads and the script says the
  thumbnail was skipped.

## Metadata

```jsonc
"youtube": {
  "title": "Why you can't stop scrolling",   // default: "title"; max 100, under 60 shows in full
  "description": "Hook line that repeats the promise.\n\nWhat you'll learn: ...",
  "tags": ["phone addiction", "dopamine"],   // max 500 characters together
  "hashtags": ["shorts", "psychology"],      // added as the last line; YouTube shows the first 3 above the title
  "privacy": "private",                      // private (default) | unlisted | public
  "publishAt": "2026-11-02T18:00:00+06:00",  // schedule: needs privacy "private", must be in the future
  "categoryId": 27,                          // default 22 People & Blogs; 27 Education, 24 Entertainment, 28 Science & Tech, 26 Howto
  "language": "bn",                          // default: from the voice name (bn-BD-... -> bn)
  "madeForKids": false,
  "syntheticMedia": false,                   // default: true when ai: images were used
  "notifySubscribers": true,
  "chapters": true,                          // append build/youtube-chapters.txt (long form)
  "credits": true,                           // append build/credits.txt (required for CC BY images)
  "account": "default"
}
```

The description is assembled as: `description`, chapters, credits, hashtags.
Write the first two lines as the hook: they show in search and above "more".

**Synthetic media:** YouTube requires disclosure when realistic content is
made or altered with AI (an AI image of a real-looking place or event, a cloned
voice of a real person). A TTS narrator over stock footage doesn't need it. The
script turns the flag on automatically when `ai:` B-roll was used. Set
`"syntheticMedia"` yourself if you know better.

## Upload flow (what to do)

1. `node scripts/youtube.mjs --dry-run`: prints the exact title, description and
   settings, and validates them (length, `< >`, tags, schedule). Show it to the
   user and **get a yes before the real upload**. Publishing is public and hard
   to take back.
2. `node scripts/youtube.mjs`: resumable upload with progress. If the connection
   drops it retries, and running the same command again resumes where it stopped.
   `build/youtube.json` records the video ID afterwards. A second run refuses to
   upload a duplicate unless you pass `--force`.
3. Give the user the `https://youtu.be/...` link. YouTube needs a few minutes to
   process it before HD plays.

Errors the script explains: expired sign-in (`--auth` again), `quotaExceeded`
(wait until midnight Pacific time), `uploadLimitExceeded` (the channel's daily
cap), no channel on the account, a thumbnail refused because the channel isn't verified.

## Batch + schedule (daily posting)

For a content calendar: build N video folders (see Batch mode in SKILL.md),
give each project a `publishAt` one day apart (pick the hour the audience is
online, e.g. 18:00 local), dry-run all of them, then upload all of them in one go.
YouTube publishes each at its time; nothing has to keep running. Remember the
quota (~6 uploads a day) and that the videos stay private until the audit
(see Limits above).

```bash
for d in video-*/; do (cd "$d" && node scripts/youtube.mjs --dry-run) || break; done
for d in video-*/; do (cd "$d" && node scripts/youtube.mjs) || break; done
```
