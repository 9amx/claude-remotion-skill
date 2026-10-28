# project.json reference

```jsonc
{
  "title": "string",                 // for your reference + delivery notes
  "format": "shorts",                // shorts 1080x1920 | landscape 1920x1080 | square 1080x1080
  "fps": 30,
  "style": "bold",                   // bold | documentary | minimal  (src/theme.ts STYLES)
  "voice": {
    "provider": "edge",              // edge | elevenlabs | openai | file | none
    "voice": "en-US-AndrewNeural",   // provider-specific voice name / ID
    "rate": "+8%",                   // edge only
    "model": "...",                  // elevenlabs / openai model override
    "instructions": "...",           // openai only: delivery style
    "file": "my-voice.mp3",          // file only: recording in public/
    "language": "bn",                // file only: whisper language
    "whisperModel": "small",         // file only
    "wpm": 165                       // none only: reading speed
  },
  "music": { "mood": "tense", "file": null, "volume": 0.12 },
  "captions": {
    "style": "pop",                  // pop | karaoke | boxed
    "maxWords": 3,                   // words per caption page (1-4)
    "position": 0.64,                // vertical center, fraction of height
    "uppercase": true                // default from style
  },
  "maxShotSeconds": 2.8,             // B-roll cut length (default 2.8 shorts, 4.5 otherwise)
  "progressBar": true,               // default true for shorts
  "sfx": true,
  "sceneGapMs": 120,                 // breath between scenes
  "outroMs": 900,                    // hold after the last word
  "scenes": [
    {
      "text": "Spoken line.",        // required
      "emphasis": "BIG TEXT",        // optional on-screen text, 1-4 words
      "broll": ["keyword", "photo:keyword", "file:clip.mp4"],
      "visual": "kinetic"            // optional: skip B-roll for this scene
    }
  ]
}
```

## Generated files

| Path | Written by | Contents |
|---|---|---|
| `public/vo/sNN.mp3`, `build/vo/sNN.json` | voice / transcribe | audio + word timings per scene |
| `public/broll/*`, `build/broll.json` | broll | downloaded clips, shot plan |
| `build/credits.txt` | broll | stock creators |
| `public/timeline.json` | timeline | everything the composition renders |
| `public/audio/*.wav` | audio | music bed + SFX |
| `out/video.mp4`, `out/final.mp4` | render, master | raw render, loudness-mastered final |
| `out/check/` | check | key frames + contact sheet |

`public/timeline.json` is plain data - for a one-off tweak (move a cut, swap a
clip) you can edit it and re-run `--from=audio`, but changes there are lost on
the next `timeline` step. Durable changes go in project.json.

Preview interactively with `npm run studio`.
