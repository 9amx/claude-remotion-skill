# 🎬 Claude Remotion Skill — Make AI Video Editing & Motion Graphics with Claude

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Agent Skill](https://img.shields.io/badge/Claude-Agent%20Skill-8A63D2)](https://docs.anthropic.com/en/docs/claude-code)
[![Remotion](https://img.shields.io/badge/Built%20for-Remotion-00C2A8)](https://remotion.dev)
[![Star this repo](https://img.shields.io/github/stars/haidrrrry/claude-remotion-skill?style=social)](https://github.com/haidrrrry/claude-remotion-skill)

**An open-source [Claude](https://claude.com) agent skill that turns Claude Code, Claude Desktop, and Claude AI into a real motion-graphics editor.** It teaches Claude to create and edit professional **AI videos with [Remotion](https://remotion.dev)** — springs, staggered choreography, color grades, film grain, Ken Burns, word-synced captions, and sound design — from a single prompt. Text to video, the way an actual editor would do it.

> If you've ever asked an AI to "make a video" and gotten flat fades and linear motion, this is the fix. **Remotion is never the bottleneck — motion-design craft is.** This skill encodes that craft as hard rules plus a mandatory **render → inspect frames → fix → re-render** loop, so Claude verifies its own output instead of shipping blind.

## 🎥 Demo — made with this skill

[![Demo — motion graphics made with this skill](demo.gif)](https://github.com/haidrrrry/claude-remotion-skill/raw/main/demo.mp4)

> A motion-graphics clip produced by Claude Code using this skill. ▶️ [Watch/download the full-quality MP4 (with audio)](https://github.com/haidrrrry/claude-remotion-skill/raw/main/demo.mp4)

## 🤖 What is this? (TL;DR)

**Claude Remotion Skill** is a free, open-source [agent skill](https://docs.anthropic.com/en/docs/claude-code) for Anthropic's Claude. You install it once, then ask Claude — in plain English — to make or fix a video, and Claude renders a finished, professionally animated clip using Remotion (React + TypeScript for video). It handles motion design, B-roll, captions, transitions, and sound design automatically.

## ❓ FAQ

**Can Claude edit videos?**
Yes. Out of the box Claude can write video code; with this skill it produces *professional* motion graphics — proper easing, staggered timing, color grading, grain, captions — and verifies the render by extracting and inspecting frames before delivering.

**Do I need After Effects or Premiere?**
No. Everything runs in code via [Remotion](https://remotion.dev) (React + TypeScript). No timeline software, no manual keyframing. You describe the video; Claude builds and renders it.

**Which Claude models work?**
Claude Code and Claude Desktop on Sonnet or Opus. The skill is model-agnostic — any Claude that supports agent skills can use it.

**Is it free?**
Yes. MIT licensed, fully open source. You only need Remotion (free, open source) and a Claude subscription/API access.

**What can it make?**
Logo animations, brand intros, vertical Reels/Shorts/TikToks, faceless content videos, product explainers, animated captions/subtitles, lower thirds, kinetic typography, and B-roll-driven edits.

**How is this different from text-to-video models (Sora, Runway, etc.)?**
Those generate pixels and hallucinate. This produces *deterministic, editable, brand-controlled* motion graphics from real code — exact text, exact colors, exact timing, re-renderable forever.

## 🆚 Generic AI video vs. with this skill

| Without this skill | With Claude Remotion Skill |
|---|---|
| Linear interpolation everywhere | Springs + bezier curves only (`easeOutExpo`, presets) |
| Lonely opacity fades | 3-property entrances (fade + rise + scale) |
| Everything enters at once | Staggered choreography (3–6 frame offsets) |
| Flat solid backgrounds | Drifting gradient mesh + grade + grain + vignette stack |
| Static pasted images | Ken Burns on every still, `OffthreadVideo` for footage |
| Ships unverified renders | ffmpeg frame extraction + visual inspection, every time |

## 📦 What's inside

```
remotion-motion-graphics/
├── SKILL.md                    # Workflow + 10 non-negotiable motion rules
├── references/
│   ├── motion-patterns.md      # 17 copy-paste components (reveals, grade, grain,
│   │                           #   Ken Burns, counters, transitions, captions...)
│   └── design-rules.md         # Palettes, typography, pacing, sound, checklist
└── assets/
    └── theme.ts                # Theme template (colors, easings, spring presets)
```

## 🎙️ Faceless Video Editor skill (new)

A second skill in this repo, [`faceless-video-editor/`](faceless-video-editor/), automates the whole faceless-channel workflow. Give Claude a topic and it delivers a finished, upload-ready MP4:

```
topic -> script (hook, retention beats) -> AI voiceover with word timestamps
      -> stock B-roll for every shot -> word-synced captions -> music bed + SFX
      -> Remotion render -> -14 LUFS master -> contact sheet Claude inspects
      -> thumbnail -> YouTube upload (optional, scheduled or private)
```

- **Voice:** free edge-tts (real word timestamps), ElevenLabs, OpenAI, or your own recording transcribed locally with whisper.cpp
- **B-roll locked to the voiceover:** each shot starts on the exact words it illustrates (`{"on": "slot machine", "kw": [...]}` beats, cut 2 frames before the word), long beats get a second angle of the same subject, and nothing random: results that don't match the keyword are skipped. Stock clips that contain their own cuts play only a clean stretch. Pexels / Pixabay (free API keys), Wikimedia / NASA archives, your own files, or an animated fallback
- **Sync report:** numbered contact sheet + `sync.txt` listing every shot with the words spoken over it, so Claude checks the picture against the voice before delivering
- **Captions:** `pop`, `karaoke` or `boxed`, 1-4 words per page, active-word highlight
- **Editing:** cuts every ~2.8s snapped to speech, zoom-punch on cuts, Ken Burns, scene whooshes, music ducking, progress bar
- **Styles:** `bold`, `documentary`, `minimal`. Shorts, landscape or square
- **Any language:** Bengali and Hindi glyphs are bundled; English, Spanish, Urdu and more via edge-tts voices
- **Real editing toolkit:** edit styles (`viral`, `story`, `explainer`, `calm`), punch-in zooms on highlighted words, whip / zoom / glitch / flash / dip / crossfade transitions, looks (flashback, dramatic, night, VHS, dream), split screen, freeze frames, count-up numbers, list badges, and riser-into-silence reveals
- **Sound design:** sounds on the beats where the picture makes a sound (shutter, door, cash register), ambience beds per scene (rain, city, office), music that ducks under the voice and lifts in the pauses, and transitions picked by meaning (flash into a reveal, dip into a flashback, whip to the next list item)
- **Pro music and SFX:** with the [Epidemic Sound connector](https://www.epidemicsound.com/tools/mcp/) in Claude (paid subscription), Claude picks music per mood or chapter and real SFX for every slot. Any files in `public/music/` and `public/sfx/` work too. Everything is loudness-normalized; without them a synthesized kit is used
- **Hook and retention gate:** a script lint that blocks warm-up hooks and checks word budget, pacing and pattern interrupts before any rendering, plus a retention report on the finished video
- **Long form up to 40+ minutes:** chapters with title cards, subtitles, lower thirds, per-chapter music, YouTube chapter timestamps, rate-limit-aware B-roll, and a chunked render that resumes after a crash and re-renders only what changed
- **Thumbnail:** `out/thumbnail.jpg` (1280x720) from the best B-roll frame plus 2-4 big words, fitted to size in any language (Bengali included)
- **YouTube upload:** title, description, tags, chapters, credits, thumbnail and scheduling (`publishAt`) through the YouTube Data API. The upload resumes if the connection drops, the same video is never uploaded twice, and it handles several channels. You need a free Google Cloud OAuth client (about 10 minutes, see [`references/youtube-upload.md`](faceless-video-editor/references/youtube-upload.md)). Videos stay private until your Google Cloud project passes YouTube's API audit
- **One command:** `npm run auto` (`-- --upload` to upload as well), with caching so editing one line re-voices only that line

Try it: *"Make a 40 second Short about why octopuses are so smart"*, *"Make a 20 minute documentary about the Voyager probes"* or *"আমার এই রেকর্ডিং দিয়ে B-roll আর ক্যাপশনসহ একটা faceless ভিডিও বানাও"*.

Install it the same way as the main skill (folder name `faceless-video-editor`, or upload `faceless-video-editor.skill` on Desktop). It works on its own, and it follows the motion rules of `remotion-motion-graphics` when you customise visuals.

### Faceless videos on your own computer (Windows, macOS, Linux)

1. Install [Node.js 20+](https://nodejs.org), [Python 3.10+](https://www.python.org/downloads/) (Windows: tick "Add python.exe to PATH"), [Git](https://git-scm.com) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).
2. Install the skill and the free voice engine:
   ```bash
   git clone https://github.com/9amx/claude-remotion-skill.git
   mkdir -p ~/.claude/skills && cp -r claude-remotion-skill/faceless-video-editor ~/.claude/skills/
   pip install edge-tts
   ```
   Windows (PowerShell): `Copy-Item -Recurse claude-remotion-skill\faceless-video-editor $HOME\.claude\skills\` (create the folder first with `mkdir $HOME\.claude\skills`).
3. Get free stock-footage keys at [pexels.com/api](https://www.pexels.com/api/) and [pixabay.com/api/docs](https://pixabay.com/api/docs/), then set them once:
   - macOS/Linux: add `export PEXELS_API_KEY=...` and `export PIXABAY_API_KEY=...` to `~/.zshrc` or `~/.bashrc`
   - Windows: `setx PEXELS_API_KEY "..."` and `setx PIXABAY_API_KEY "..."`, then open a new terminal
4. Make a folder for your videos, open Claude Code in it and ask:
   ```bash
   mkdir my-videos && cd my-videos && claude
   ```
   > *Make a 40 second Short about why octopuses are so smart*

Claude copies the template, runs `npm install`, writes the script, and runs the pipeline. When it's done, the video is at `<project>/out/final.mp4`. The first render downloads a headless Chrome (~100 MB).

Upload to YouTube: follow the one-time setup in [`references/youtube-upload.md`](faceless-video-editor/references/youtube-upload.md) (create a Google Cloud "Desktop app" OAuth client, then `node scripts/youtube.mjs --auth` once). After that, ask *"upload it to YouTube, schedule for tomorrow 6pm"*. Claude shows you the title and description first and uploads only after you say yes.

Your own voice: put the recording in the project's `public/` folder and say *"use my-voice.mp3 as the voiceover"*. whisper.cpp is set up on first use: on macOS run `xcode-select --install` once first, on Linux install `build-essential`.

## 🚀 Install

**Claude Code (per-user — available in every project):**
```bash
git clone https://github.com/haidrrrry/claude-remotion-skill.git
mkdir -p ~/.claude/skills
cp -r claude-remotion-skill/remotion-motion-graphics ~/.claude/skills/
cp -r claude-remotion-skill/faceless-video-editor ~/.claude/skills/   # optional
```

**Claude Code (per-project — share with your team):**
```bash
git clone https://github.com/haidrrrry/claude-remotion-skill.git
mkdir -p .claude/skills
cp -r claude-remotion-skill/remotion-motion-graphics .claude/skills/
cp -r claude-remotion-skill/faceless-video-editor .claude/skills/     # optional
```

**Claude Desktop / Claude.ai:** upload `remotion-motion-graphics.skill` in **Settings → Capabilities → Skills**.

**Verify it worked:** ask Claude *"make me a 3 second logo sting"*. It should read the skill before writing any code, and it should extract and inspect frames before delivering. A render shipped without frame checks means the skill is not loaded.

**Update later:** run `git pull` in your clone, then copy the folder again (on Desktop, re-upload the `.skill` file).

## 🎯 Usage

Just talk to Claude normally — the skill triggers itself:

- *"Create a 5 second logo animation for my brand"*
- *"My Remotion video looks generic and basic, fix it"*
- *"Add word-synced captions to this clip"*
- *"Build a vertical Reel intro, dark tech aesthetic"*

Claude reads the skill, applies the motion rules, renders with Remotion, extracts frames with ffmpeg, inspects them, fixes issues, and only then delivers.

## 🧠 The 10 rules (short version)

1. Never linear interpolation — springs/bezier + clamp, always
2. Entrances animate 2–3 properties together
3. Stagger everything
4. Exits exist and are faster than entrances
5. Five-layer stack: bg mesh → assets → graphics → grade → grain+vignette
6. Every still gets Ken Burns; footage uses `OffthreadVideo`
7. Idle elements breathe (sin-wave micro-motion)
8. All timing derives from `fps` — no magic frame numbers
9. One `theme.ts` — no inline colors or easings
10. Render → inspect frames → fix → re-render. Never ship unverified.

## Examples

[`examples/`](examples/) is a Remotion project with four finished compositions built with this skill: a profile promo, the Focus Cat app promo, a "watch this video fix itself" demo where the motion rules apply themselves one by one, and a beat-synced code edit with a synthesized 120 BPM track. Each shipped only after the render, inspect frames, fix, re-render loop.

Here is the Focus Cat promo, 15.5 seconds, with a pixel-art mascot drawn in code. Click it for the MP4 with sound:

[![Focus Cat promo, made with this skill](examples/videos/focus-cat.gif)](https://github.com/haidrrrry/claude-remotion-skill/raw/main/examples/videos/focus-cat-promo.mp4)

The other three render from source in a few minutes:

```bash
cd examples
npm install
npm run audio            # synthesize the SFX and music, no asset files needed
npm run render:selffix   # or render:codeedit / render:profile / render:focuscat
```

## 🤝 Contributing

PRs welcome — new motion patterns, palettes, or fixes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## ⭐ Star this repo

If this saved you from shipping another flat-fade video, **[star it](https://github.com/haidrrrry/claude-remotion-skill)** — it helps other people find it.

## 📄 License

[MIT](LICENSE) — use it, fork it, ship videos with it.

---

Made by [@haidrrrry](https://github.com/haidrrrry) · Follow [@haidercodes](https://instagram.com/haidercodes) for AI + dev content
