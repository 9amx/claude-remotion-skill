# project.json reference

```jsonc
{
  "title": "string",                 // for your reference + delivery notes
  "format": "shorts",                // shorts 1080x1920 | landscape 1920x1080 | square 1080x1080
  "fps": 30,
  "style": "bold",                   // bold | documentary | minimal  (default: bold for shorts, documentary otherwise)
  "voice": {
    "provider": "edge",              // edge | elevenlabs | openai | file | none
    "voice": "en-US-AndrewNeural",   // provider-specific voice name / ID
    "rate": "+8%",                   // edge only
    "model": "...",                  // elevenlabs / openai model override
    "instructions": "...",           // openai only: delivery style
    "file": "my-voice.mp3",          // file only: recording in public/
    "language": "bn",                // file only: whisper language
    "whisperModel": "small",         // file only
    "wpm": 165,                      // none only: reading speed
    "concurrency": 4                 // scenes voiced in parallel
  },
  "music": { "mood": "tense", "file": null, "volume": 0.12 },
  "captions": {
    "style": "pop",                  // pop | karaoke | boxed | subtitle | none (default: pop shorts, subtitle otherwise)
    "maxWords": 3,                   // words per caption page (1-4; subtitle default 8)
    "position": 0.64,                // vertical center, fraction of height
    "uppercase": true                // default from style
  },
  "maxShotSeconds": 2.8,             // B-roll cut length (default 2.8 shorts, 5 otherwise)
  "brollSources": ["pexels", "pixabay"], // search order; sources without a key are skipped
  "brollMaxWaitMinutes": 0,          // wait out a Pexels hourly limit up to this long (else fall back)
  "trimBroll": true,                 // trim long stock clips to what each shot needs
  "progressBar": true,               // default true for shorts
  "sfx": true,
  "transitions": "scene",            // scene | chapter | none (flash + whoosh); default chapter when chapters exist
  "chapterCards": true,              // chapter title cards (only with 2+ chapters)
  "sceneGapMs": 120,                 // breath between scenes
  "chapterGapMs": 900,               // breath before a new chapter
  "outroMs": 900,                    // hold after the last word
  "renderChunkMinutes": 5,           // videos longer than 1.5x this render in cached parts
  "scenes": [
    {
      "text": "Spoken line.",        // required
      "emphasis": "BIG TEXT",        // optional on-screen text, 1-4 words
      "lowerThird": { "title": "Name", "subtitle": "Role, place or date" },  // optional tag, 4.5s
      "broll": ["keyword", "photo:keyword", "file:clip.mp4"],
      "visual": "kinetic"            // optional: skip B-roll for this scene
    }
  ]
}
```

Long form: replace `scenes` with chapters (never both). Scene fields are the same.

```jsonc
"chapters": [
  { "title": "The Launch", "mood": "calm", "broll": ["fallback keyword"], "scenes": [ ... ] }
]
```
`mood` overrides `music.mood` for that chapter; `broll` is used by scenes that have none.

## Generated files

| Path | Written by | Contents |
|---|---|---|
| `public/vo/sNNN.mp3`, `build/vo/sNNN.json` | voice / transcribe | audio + word timings per scene |
| `public/broll/*`, `build/broll.json` | broll | downloaded (trimmed) clips, shot plan |
| `build/search-cache/` | broll | cached API searches |
| `build/credits.txt` | broll | stock creators |
| `public/timeline.json` | timeline | everything the composition renders |
| `build/youtube-chapters.txt` | timeline | chapter timestamps for the description (2+ chapters) |
| `public/audio/*.wav` | audio | music loops per mood + SFX |
| `out/parts/` | render | long form: cached parts, audio, manifest |
| `out/video.mp4`, `out/final.mp4` | render, master | raw render, loudness-mastered final |
| `out/check/` | check | key frames + contact sheets |

`public/timeline.json` is plain data - for a one-off tweak (move a cut, swap a
clip) you can edit it and re-run `--from=audio`, but changes there are lost on
the next `timeline` step. Durable changes go in project.json.

Preview interactively with `npm run studio`.
