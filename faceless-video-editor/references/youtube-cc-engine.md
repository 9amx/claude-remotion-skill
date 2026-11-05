# Falcon Motion YouTube Engine - Creative Commons footage from YouTube

`scripts/yt-engine.mjs` turns a script into an editor's footage package of
licensed Creative Commons clips from YouTube: clips cut and numbered in script
order, a source link to the exact second for each one, and a license record for
every source video. Use it for lines that name something real (an event, a
machine, a place) when stock, `archive:` and DVIDS don't have it.

Needs `YOUTUBE_API_KEY` (Google Cloud -> enable YouTube Data API v3 -> API key)
or the channel sign-in from `node scripts/youtube.mjs --auth`. ffmpeg is used
for cutting; yt-dlp only for videos with a recorded authorization.

## Inside the normal pipeline

The same rules run as a footage source in `scripts/fetch-broll.mjs`, so a
normal `node scripts/auto.mjs` uses YouTube CC like DVIDS or Wikimedia: per
beat, relevance-ranked against the other libraries, on the `--review` sheets,
frame- and quality-checked, cut at the matched chapter, silent, credited in
`build/credits.txt`. It searches for `archive:` keywords, keywords that name
something real, and `yt:` keywords (YouTube only). Only videos whose license
passes and whose file is authorized are candidates; the rest that match well
land in `build/yt/wanted.json` with the maker's links. Get those files
(`source` / `import` / `authorize`, `approve` after checking the uploader), then
`node scripts/auto.mjs --from=broll`. Off with `"youtubeCC": false`; at most
`youtubeMaxSearches` (30) searches per run.

Use the standalone engine below when an editor wants a footage package for a
whole script instead of a rendered video.

## The seven steps

| # | Command | What happens | Output (build/yt/) |
|---|---|---|---|
| 1 | `analyze script.txt` (or `project.json`) | splits into sentences, drafts keywords | `script.json` |
| - | **Claude** | rewrites every sentence's `keywords` (1-3 English search phrases) and sets `refined: true` | `script.json` |
| 2 | `search [--hd]` | YouTube search with `videoLicense=creativeCommon`, then full video details | `videos.json` |
| 3 | `match` | ranks videos per sentence: keyword match on title/tags/description, description chapters for the timestamp, HD, license | `matches.json`, `matches.md` |
| 4 | `verify` | license record per candidate (below), then run `match` again so rejected videos drop out | `licenses.json` |
| - | **Claude / user** | `pick`, `approve` / `reject`, find the maker's file | `picks.json`, `sources.json` |
| 5 | `download` | fetches only from an authorized source | `raw/` |
| - | `scenes <id>` | contact sheet + internal cut times to set exact timestamps | `review/<id>.jpg` |
| 6 | `extract [--auto] [--keep-audio]` | ffmpeg cuts, 1080p30 H.264, silent by default, no internal cut inside a clip | `package/clips/` |
| 7 | `package` | manifest, spreadsheet, license records, attribution, project beats | `package/` |

`run script.txt` does 1-4 (refine the keywords first and run `search` again if the
drafts were weak). `status` shows every sentence: match, license, downloaded.

## Step 1 - writing the keywords (Claude's job)

The analyzer's drafts are heuristic. For each sentence write what a camera would
have filmed, in English even when the script is Bengali or Hindi:
real names + the action + the place/year ("Apollo 11 Saturn V liftoff 1969",
"Tesla Gigafactory Berlin assembly line"). Lines with nothing filmable (an
opinion, a number) get `keywords: []`: they become graphics, not footage.
Each keyword costs 100 quota units per search; 10,000 are free a day, so keep
1-2 keywords per sentence.

## Step 3 - confidence

`0.45 x keyword match (title, tags, description) + 0.15 x title match +
0.2 x chapter match + 0.1 x HD + 0.1 x license`. A `chapter` timestamp comes from
the description's chapter list; `estimated` means there was none: download, run
`scenes <id>`, look at the sheet and `pick L003 <id> 1:24 1:29`. Two sentences
never get the same stretch of one video. Read `matches.md` and pick by eye for
anything that matters (the hook, named events); `--auto` takes the best match at
or above `--min` (0.45) for the rest.

## Step 4 - what verification checks and what it can't

- **License**: `status.license` from the API. YouTube's only Creative Commons
  option is CC BY 3.0: commercial use and changes are allowed, attribution is
  required. Standard YouTube License -> `rejected`.
- **Attribution**: written for every video (title, channel, link, license link);
  `package` puts it in `ATTRIBUTION.txt` for the description.
- **Source permission** (did the uploader make it?): the API can't prove this,
  and a CC label on a re-upload is worthless - the real owner still claims it.
  Red flags (re-upload wording, "all rights go to", fair-use disclaimers,
  broadcaster/league names, film/TV/music/sports, compilations, Content ID
  partner content) put the video in `review`. A person checks the channel (does
  it upload its own filming? is the same footage elsewhere earlier?) and runs
  `approve <id> --note="..."` or `reject <id>`. No flags -> `ok`, still worth a
  look for anything central to the video.
- **Music**: CC on the video does not cover a third-party soundtrack. Clips are
  extracted silent unless `--keep-audio`.

## Step 5 - authorized download only

YouTube's terms forbid downloading with a third-party tool unless YouTube shows
a download option or the rights holder allows it, so the CC label alone never
starts yt-dlp. A video downloads when its license passes and one of these exists:

1. `source <id> <url>` - the maker's own file: their website, Vimeo download,
   Internet Archive, Wikimedia Commons (`download` prints links found in the
   description). Best option.
2. `import <id> <file>` - a file the maker sent, or one you got another
   permitted way.
3. `authorize <id> --type=own-channel|written-permission|download-button --note="..."` -
   your own upload, written permission from the rights holder (note who and
   where it is kept), or YouTube offered the download. Only these let yt-dlp run.

Anything else is listed as `blocked` with what to do. Never record an
authorization the user doesn't actually have.

## Step 7 - the package

```
build/yt/package/
  clips/001_L001_apollo-11_<videoId>_0m13s-0m16s.mp4   script order, sentence, keyword, source, times
  manifest.json     every clip: sentence, source link at the second, confidence, license, how obtained
  sources.csv       the same for a spreadsheet (UTF-8 with BOM, opens in Excel)
  LICENSES.md       one record per source video: checks, red flags, human decision, file origin, date
  ATTRIBUTION.txt   paste into the YouTube description
  beats.json        {"on", "kw": ["file:clips/..."], "credit"} beats for project.json
  README.txt        what is where + sentences still without footage
```

Into the faceless pipeline: copy `clips/` to `public/clips/`, paste each beat
into its scene's `broll` (adjust `on` to the exact words), and the credits reach
`build/credits.txt` and the description through the normal run. Keep CC clips
short and talk over them with your own point - they support the story; a channel
built mostly from other people's footage still risks "reused content".
