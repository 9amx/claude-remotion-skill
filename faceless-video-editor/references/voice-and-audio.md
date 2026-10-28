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
transcribes, then splits the recording into the project's scenes in proportion
to each scene's word count, snapping each cut to the longest pause nearby. Keep
the project's scene texts close to what was actually said. Non-English: set
`voice.language` (e.g. `"bn"`) - this switches to the multilingual `small` model.
Override with `voice.whisperModel` (`medium` for best accuracy).

## Music

- `music.mood`: `calm` | `tense` | `upbeat` -> synthesized royalty-free bed sized
  to the video (`public/audio/bed.wav`). `"none"` = no music.
- `music.file`: `"music/track.mp3"` (in `public/`) to use a real track instead.
  Only use tracks the user has rights to (YouTube Audio Library, licensed libraries).
- `music.volume`: 0.08-0.15 under voice. The composition ducks to this level
  during speech and swells x2.2 in the outro.

## SFX

Synthesized into `public/audio/`: `hit.wav` (frame 0), `whoosh.wav` (scene
changes), `pop.wav` (emphasis lands). `"sfx": false` disables all.

## Loudness

The `master` step runs `loudnorm` to -14 LUFS integrated, -1.5 dBTP - what
YouTube, TikTok and Instagram normalize to. `check` reports the measured value and
warns outside -17..-11.
