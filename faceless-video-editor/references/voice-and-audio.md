# Voice and Audio

## Providers (`voice.provider`)

| Provider | Cost | Timestamps | Setup |
|---|---|---|---|
| `edge` | free | real, per word | `pip install edge-tts` |
| `elevenlabs` | paid, best quality | real (character alignment) | `ELEVENLABS_API_KEY`, `voice` = voice ID |
| `openai` | paid, cheap | estimated from length (shots and captions can drift; prefer edge/elevenlabs when sync matters) | `OPENAI_API_KEY`, `voice` = alloy/onyx/nova/..., optional `instructions` |
| `file` | free (local) or per-minute (API) | real: whisper.cpp, ElevenLabs Scribe, OpenAI, or your transcript | user recording in `public/`, `voice.file` |
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

The user records (or exports from ElevenLabs etc.) and puts the file in `public/`.
`npm run transcribe` (run by `auto`) then:

1. **Cleans the recording** (`voice.enhance`, default on): rumble cut, noise
   reduction and a soft gate set from the measured noise floor, de-esser, gentle
   compression, linear -16 LUFS -> `build/voice-clean.wav`. On a hissy test
   recording the noise sat 22 dB under the speech before and 38 dB after. Needs a
   system ffmpeg; Remotion's bundled one only levels the loudness. `"enhance": false`
   keeps the file as it is (already mastered audio).
2. **Word timestamps**, which drive every cut, caption and beat:
   | Setting | What | Needs |
   |---|---|---|
   | `voice.transcript: "voice.json"` | a transcript you already have: ElevenLabs Speech-to-Text JSON or OpenAI verbose_json with word timestamps | nothing |
   | `voice.transcriber: "local"` (default) | whisper.cpp here. `large-v3-turbo` for non-English, `medium.en` for English (`voice.whisperModel` overrides). The first run compiles it (git, make, C++) and downloads the model from huggingface.co | CPU time: a 20 min recording can take 30-60 min on 4 cores |
   | `voice.transcriber: "elevenlabs"` | ElevenLabs Scribe; the strongest option for Bengali / Hindi | `ELEVENLABS_API_KEY`, host `api.elevenlabs.io` |
   | `voice.transcriber: "openai"` | OpenAI whisper-1 with word timestamps; up to ~70 min per recording (25 MB limit) | `OPENAI_API_KEY`, host `api.openai.com` |
   Set `voice.language` (`"bn"`, `"hi"`) for non-English. The result is cached in
   `build/transcript.json` until the recording or these settings change.
3. **Splits it into scenes** by aligning the script's words to the transcript
   (robust to skipped lines, ad-libs and misheard words, so it holds over a 40
   minute recording) and jump-cuts pauses over `maxPauseMs`. It logs the overall
   match and names every scene under 50%: those were said differently from the
   script, so their cuts are estimated. Check them in `out/check/sync.txt`, or
   fix the scene's text to what was actually said.

## Music

- `music.mood`: `calm` | `tense` | `upbeat` -> synthesized royalty-free loop
  (`public/audio/bed-<mood>.wav`, up to ~2 min, looped seamlessly). `"none"` = no
  music. Long form: each chapter can set its own `mood`; moods crossfade at
  chapter changes.
- `music.file`: `"music/track.mp3"` (in `public/`) to use a real track instead.
  Only use tracks the user has rights to (YouTube Audio Library, licensed libraries).
- `music.volume`: 0.08-0.15 under voice. The composition ducks to this level
  while someone speaks (a few frames before each line, so no first word is
  masked), lifts it `music.gapBoost` (default 1.7x) in pauses over ~0.3s, and
  swells in the outro. Ambience beds duck the same way, half as much.

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
