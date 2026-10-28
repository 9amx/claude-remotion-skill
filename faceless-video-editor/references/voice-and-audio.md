# Voice and Audio

## Providers (`voice.provider`)

| Provider | Cost | Timestamps | Setup |
|---|---|---|---|
| `edge` | free | real, per word | `pip install edge-tts` |
| `elevenlabs` | paid, best quality | real (character alignment) | `ELEVENLABS_API_KEY`, `voice` = voice ID |
| `openai` | paid, cheap | estimated from length | `OPENAI_API_KEY`, `voice` = alloy/onyx/nova/..., optional `instructions` |
| `file` | free | whisper.cpp, real | user recording in `public/`, `voice.file` |
| `none` | free | estimated (`wpm`) | text + music only videos |

Default to `edge` unless the user has a key and wants premium sound.

## Edge voices that work well

List all: `edge-tts --list-voices`. Rate `"+5%"` to `"+12%"` for Shorts.

| Language | Male | Female |
|---|---|---|
| English (US) | `en-US-AndrewNeural`, `en-US-ChristopherNeural` | `en-US-AvaNeural`, `en-US-EmmaNeural` |
| English (UK) | `en-GB-RyanNeural` | `en-GB-SoniaNeural` |
| Bengali (BD) | `bn-BD-PradeepNeural` | `bn-BD-NabanitaNeural` |
| Bengali (IN) | `bn-IN-BashkarNeural` | `bn-IN-TanishaaNeural` |
| Hindi | `hi-IN-MadhurNeural` | `hi-IN-SwaraNeural` |
| Urdu | `ur-PK-AsadNeural` | `ur-PK-UzmaNeural` |
| Spanish | `es-MX-JorgeNeural` | `es-MX-DaliaNeural` |
| Multilingual | `en-US-AndrewMultilingualNeural` | `en-US-EmmaMultilingualNeural` |

Documentary / story: deeper male voice, rate `+0%`. Facts / lists: `+8%`.

## Own recording (`provider: "file"`)

`npm run transcribe` (run by `auto`) compiles whisper.cpp once into `.whisper/`,
transcribes, then splits the recording into the project's scenes by aligning
the script's words to the transcript (robust to skipped lines, ad-libs and
misheard words, so it holds over a 40 minute recording). It logs how much of
the script matched; under 60% means project.json doesn't match the recording. Non-English: set
`voice.language` (e.g. `"bn"`) - this switches to the multilingual `small` model.
Override with `voice.whisperModel` (`medium` for best accuracy).

## Music

- `music.mood`: `calm` | `tense` | `upbeat` -> synthesized royalty-free loop
  (`public/audio/bed-<mood>.wav`, up to ~2 min, looped seamlessly). `"none"` = no
  music. Long form: each chapter can set its own `mood`; moods crossfade at
  chapter changes.
- `music.file`: `"music/track.mp3"` (in `public/`) to use a real track instead.
  Only use tracks the user has rights to (YouTube Audio Library, licensed libraries).
- `music.volume`: 0.08-0.15 under voice. The composition ducks to this level
  during speech and swells x2.2 in the outro.

## Your own music and SFX (Epidemic Sound, Artlist, YouTube Audio Library...)

- Music: `music.file` (whole video) or `chapters[].music` (per chapter) pointing
  at a file in `public/`, e.g. `public/music/track.mp3`. Normalized to -14 LUFS
  into `public/audio/user/` before rendering.
- SFX: files in `public/sfx/` named after a slot (`whoosh`, `hit`, `riser`,
  `pop`, `scratch`, `glitch`, `tick`), optionally numbered (`whoosh-1.mp3`,
  `whoosh-2.mp3`) to rotate variants. Peak-normalized to -1 dB. Files with other
  names are ignored. Slots without a file fall back to the synthesized kit.
- With the Epidemic Sound connector in Claude, see "Music and SFX from a pro
  library" in SKILL.md for search terms per slot.

## SFX

Synthesized into `public/audio/`: `hit.wav` (frame 0), `whoosh.wav` (scene
changes), `pop.wav` (emphasis lands). `"sfx": false` disables all.

## Loudness

The `master` step runs `loudnorm` to -14 LUFS integrated, -1.5 dBTP - what
YouTube, TikTok and Instagram normalize to. `check` reports the measured value and
warns outside -17..-11.
