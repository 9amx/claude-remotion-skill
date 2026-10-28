# project.json reference

```jsonc
{
  "title": "string",                 // for your reference + delivery notes
  "format": "shorts",                // shorts 1080x1920 | landscape 1920x1080 | square 1080x1080
  "fps": 30,
  "editStyle": "viral",              // viral | story | explainer | calm - pacing, transitions, zooms, SFX (see editing-playbook.md)
  "style": "bold",                   // colors/fonts: bold | documentary | minimal (default from editStyle)
  "targetSeconds": 35,               // lint compares the script's estimated length to this
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
    "concurrency": 4,                // scenes voiced in parallel
    "tightenPauses": true,           // file only: jump-cut pauses longer than maxPauseMs
    "maxPauseMs": 400
  },
  "music": { "mood": "tense", "file": null, "volume": 0.12 },  // file: own track in public/ (e.g. "music/track.mp3")
  "captions": {
    "style": "pop",                  // pop | karaoke | boxed | subtitle | none (default from editStyle; subtitle for long form)
    "maxWords": 3,                   // words per caption page (1-4; subtitle default 8)
    "position": 0.64,                // vertical center, fraction of height
    "uppercase": true                // default from style
  },
  "maxShotSeconds": 2.2,             // B-roll cut length (default from editStyle)
  "brollSources": ["pexels", "pixabay"], // search order; sources without a key are skipped
  "brollMaxWaitMinutes": 0,          // wait out a Pexels hourly limit up to this long (else fall back)
  "trimBroll": true,                 // trim long stock clips to what each shot needs
  "progressBar": true,               // default true for shorts
  "sfx": true,                       // false = no SFX at all
  "sfxLevel": 1,                     // 0-1 scales every SFX (default from editStyle)
  "transitions": "scene",            // WHERE: scene | chapter | none; default chapter when chapters exist
  "transitionStyle": "auto",         // WHICH: auto (cycles whip/zoom/glitch/flash) | whip | zoom | glitch | flash | dip | fade | cut
  "punchIns": true,                  // punch-in zoom on highlighted words (default from editStyle)
  "hookShake": true,                 // impact shake on the hook (default: viral only)
  "loop": false,                     // true = the last line loops into the first (silences the CTA note)
  "chapterCards": true,              // chapter title cards (only with 2+ chapters)
  "sceneGapMs": 120,                 // breath between scenes
  "chapterGapMs": 900,               // breath before a new chapter
  "outroMs": 900,                    // hold after the last word
  "renderChunkMinutes": 5,           // videos longer than 1.5x this render in cached parts
  "scenes": [
    {
      "text": "Spoken *line*.",      // required; *word* = highlight (accent caption + punch-in), never spoken
      "emphasis": "BIG TEXT",        // optional on-screen text, 1-4 words; numbers count up
      "lowerThird": { "title": "Name", "subtitle": "Role, place or date" },  // optional tag, 4.5s
      "badge": "#3",                 // corner tag: list numbers, steps, dates
      "layout": "split",             // two broll clips side by side with a VS divider
      "look": "flashback",           // normal | flashback | dramatic | night | vhs | dream
      "transition": "whip",          // how this scene enters: whip | zoom | glitch | flash | dip | fade | cut
      "fx": ["reveal"],              // reveal (riser + silence + hit) | freeze | shake | punch
      "broll": ["keyword", "photo:keyword", "file:clip.mp4"],
      "visual": "kinetic"            // optional: skip B-roll for this scene
    }
  ]
}
```

Long form: replace `scenes` with chapters (never both). Scene fields are the same.

```jsonc
"chapters": [
  { "title": "The Launch", "mood": "calm", "music": "music/launch.mp3", "broll": ["fallback keyword"], "scenes": [ ... ] }
]
```
`mood` overrides `music.mood` for that chapter; `music` is an own track for it (file in public/); `broll` is used by scenes that
have none; `look` is the default look for its scenes.

## Generated files

| Path | Written by | Contents |
|---|---|---|
| `public/vo/sNNN.mp3`, `build/vo/sNNN.json` | voice / transcribe | audio + word timings per scene |
| `public/broll/*`, `build/broll.json` | broll | downloaded (trimmed) clips, shot plan |
| `build/search-cache/` | broll | cached API searches |
| `build/credits.txt` | broll | stock creators |
| `public/timeline.json` | timeline | everything the composition renders |
| `build/youtube-chapters.txt` | timeline | chapter timestamps for the description (2+ chapters) |
| `public/audio/*.wav` | audio | synthesized music loops per mood + SFX kit |
| `public/sfx/`, `public/music/` | you / Claude | own SFX (slot-named) and music; never overwritten |
| `public/audio/user/` | audio | normalized copies of your own SFX and music |
| `out/parts/` | render | long form: cached parts, audio, manifest |
| `out/video.mp4`, `out/final.mp4` | render, master | raw render, loudness-mastered final |
| `out/check/` | check | key frames + contact sheets |

`public/timeline.json` is plain data - for a one-off tweak (move a cut, swap a
clip) you can edit it and re-run `--from=audio`, but changes there are lost on
the next `timeline` step. Durable changes go in project.json.

Preview interactively with `npm run studio`.
