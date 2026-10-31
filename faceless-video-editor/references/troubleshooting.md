# Troubleshooting

**Windows: whisper.cpp install dies silently ("unsettled top-level await")**
The Windows binary for whisper.cpp 1.7.5 is gone from GitHub (404). Unpack a release zip (`whisper-blas-bin-x64.zip`, v1.9.2 works) into `.whisper/build/bin/` and put `ggml-medium.en.bin` in `.whisper/`, then re-run. A 17 minute recording takes about 20 minutes on 12 cores: run it in the background without a time limit.

**Storyboard tiles all gray, "Fontconfig error"**
ffmpeg on Windows has no fontconfig, so drawtext needs `fontfile` (handled by `DRAWTEXT_FONT`). The pipeline's storyboard pages can also drop tiles when pixel formats change; read `build/storyboard/tiles/` directly if a page looks short.

**Review sheet thumbnails gray for Wikimedia**
Wikimedia rejects non-standard thumbnail widths (400): use 330px, not 320px (already fixed in fetch-broll).

**Night-vision stills or clips rejected as "green screen"**
The frame check can't tell night vision from chroma key. Save the picture to `public/stills/` and use `file:stills/name.jpg` with a `credit`.

**Render: "Downloading Chrome Headless Shell" fails / ENOTFOUND**
Remotion couldn't download its browser. Point it at any Chrome:
`REMOTION_BROWSER=/path/to/chrome-headless-shell npm run auto -- --from=render`.
Playwright installs one under `~/.cache/ms-playwright` or `/opt/pw-browsers`
(`chrome-headless-shell-linux64/chrome-headless-shell`). Full Chrome erroring with
"Old Headless mode has been removed" means use a headless-shell binary.

**Render: "Timeout ... Fetching Montserrat font"**
The browser can't reach fonts.gstatic.com. Behind a corporate/TLS-inspecting
proxy run with `REMOTION_FLAGS="--ignore-certificate-errors"`, or self-host the fonts: put .woff2 files in `public/fonts/` and swap the
`loadFont` calls in `src/theme.ts` for `@font-face` + `staticFile`.

**edge-tts: 403 / SkewAdjustmentError / DNS error**
Network can't reach `speech.platform.bing.com`. Update (`pip install -U edge-tts`),
check the network, or switch provider. Behind a proxy, `HTTPS_PROXY` is passed
through automatically.

**Node scripts can't reach Pexels behind a proxy**
Node's fetch ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node 22.21+/24).

**Captions drift from the voice**
- `openai` and `none` providers estimate timings - switch to `edge`/`elevenlabs`,
  or render once and transcribe the result with `provider: "file"`.
- Numbers/symbols read aloud ("1990" -> "nineteen ninety") are interpolated; small
  drift on those words is expected.

**Recording split into scenes at the wrong place (`file` provider)**
Make each scene's `text` match what was said, word count matters most. Then
re-run `--from=voice`.

**Every shot is the kinetic background**
No `PEXELS_API_KEY`/`PIXABAY_API_KEY` in the environment, or every search
failed (see the `[broll]` log lines).

**Clip freezes on its last frame**
The clip was shorter than the shot even at 0.6x. Lower `maxShotSeconds` or use a
different keyword; `fetch-broll` prefers clips at least as long as the shot.

**Text cut off at the edges**
Long single words (> 14 chars) shrink the caption page; `check` warns about
them. Rephrase or hyphenate. For `emphasis`, keep to 1-4 short words.

**Render is slow**
Expected cost is ~0.5-2x realtime per CPU core. Pass render flags through
`REMOTION_FLAGS`, e.g. `REMOTION_FLAGS="--concurrency=8"`, or
`REMOTION_FLAGS="--scale=0.5"` for a quick draft.

**Long form: "pexels rate limit reached"**
Expected on big videos with Pexels only. Add `PIXABAY_API_KEY` and
`"brollSources": ["pixabay", "pexels"]`, or re-run `--from=broll` in an hour
(cached searches and existing clips are kept; only gaps are filled), or set
`"brollMaxWaitMinutes": 60`.

**Long form: render crashed halfway**
Run `npm run auto -- --from=render` again. Finished parts in `out/parts/` are
reused if nothing in their range or in `src/` changed.

**Long form: a part re-renders every time**
Something inside its range changes on every timeline build (e.g. B-roll
re-picked because a file was deleted), or `src/` was edited. Changing only
`--concurrency` does not invalidate parts; other `REMOTION_FLAGS` do.

**Long form: disk filling up**
`out/parts/` holds a second copy of the video until you delete it; `public/broll/`
holds the trimmed clips. Both are safe to delete after delivery.
