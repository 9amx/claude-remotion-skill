# Quality review before upload

Four gates must PASS before upload, each re-run after any change:
1. `node <skill>/scripts/factcheck.mjs` - sources open, quotes are on the pages, every number and
   name in voice, captions, graphics and title is backed, map/globe places match.
2. `node <skill>/scripts/voicecheck.mjs` - the voice said exactly the script.
3. `node scripts/qa.mjs` (runs inside `auto`) - picture and sound (below).
4. `node <skill>/scripts/package-check.mjs` - hook, length, loop, title, description, disclosure, timing.

Then the review by eye below. Run all of it. Fix, re-render and re-check until everything is clean (up to 5 rounds).
Record each round in `build/daily-log.md`.

## 1. Automated gate: `node scripts/qa.mjs` must PASS
It fails on: wrong size or frame rate, too long for Shorts, audio/picture length mismatch,
unintended black frames, picture frozen 3 s or more, dead air in the middle, loudness outside
-14 LUFS +-1, true peak above -1 dBTP, clipping, broken samples. Warnings must be looked at
and either fixed or explained in the log.

## 2. Look (open the images, look at every tile)
- `out/qa/hook.jpg`: the first 3 seconds. Is the subject on screen from frame one? Is the
  hook line readable? Does it make you want the next second?
- `out/qa/sheet-*.jpg`, `out/check/contact*.jpg` with `out/check/sync.txt`: does every shot
  match the words over it? Right aircraft type, right place, right weather?
  Any watermark, logo, burned-in text from the source, letterbox bars, or blurry/upscaled clip?
- Captions and text pops: spelled right, inside the safe area, not covering faces or the subject.

## 3. Listen (through the numbers, since you cannot hear)
- Voice: re-transcribe `out/final.mp4` audio if in doubt (ElevenLabs Scribe or whisper) and
  diff against the script: no missing, doubled or garbled words; names said correctly.
- Music under the voice: the voice must sit clearly above it (the mix already ducks; check
  `build/` mix logs). Sound effects only on real moments, not on every cut.
- Ending: the music fades, nothing cuts off mid-word.

## 4. Facts, last time
- Every number, name and date in captions and voice against `build/research.md`.
- Title and description: true, not misleading, sources listed, no tragedy-baiting words.

Only when all four are clean: upload. If something cannot be fixed, mark the day "held" with
the reason - an empty day is better than a wrong video.
