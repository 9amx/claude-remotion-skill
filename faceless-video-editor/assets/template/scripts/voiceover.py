#!/usr/bin/env python3
"""Generate one voiceover clip per scene, with word-level timestamps.

Writes public/vo/<scene>.mp3 and build/vo/<scene>.json:
  {"audio": "vo/s01.mp3", "durationMs": 3120, "words": [{"text", "startMs", "endMs"}]}

Providers (project.json -> voice.provider):
  edge        free Microsoft neural voices, real word timestamps   (pip install edge-tts)
  elevenlabs  ELEVENLABS_API_KEY, real timestamps from character alignment
  openai      OPENAI_API_KEY, timestamps estimated from audio length
  none        no audio; timing estimated from reading speed (text/music-only videos)
  file        your own recording -> use `npm run transcribe` instead of this script

Unchanged scenes are cached, so editing one line only re-voices that line.
"""
import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VO_AUDIO = os.path.join(ROOT, "public", "vo")
VO_DATA = os.path.join(ROOT, "build", "vo")


def log(msg):
    print(f"\033[36m[voice]\033[0m {msg}", flush=True)


def die(msg):
    print(f"\033[31m[error]\033[0m {msg}", file=sys.stderr)
    sys.exit(1)


def scene_id(i):
    return f"s{i + 1:02d}"


def tokens(text):
    return text.split()


def norm(word):
    # Strip punctuation only; keeps combining vowel signs of Indic scripts intact.
    return re.sub(r"[\s.,!?;:\"'“”‘’()\[\]…—–\-।॥]", "", word.lower())


def probe_duration_ms(path):
    for cmd in (["ffprobe"], ["npx", "remotion", "ffprobe"]):
        if cmd[0] == "ffprobe" and not shutil.which("ffprobe"):
            continue
        try:
            out = subprocess.run(
                cmd + ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
                capture_output=True, text=True, cwd=ROOT, timeout=120,
            ).stdout.strip().splitlines()
            return int(float(out[-1]) * 1000)
        except Exception:
            continue
    return None


def estimate_words(text, total_ms, lead_ms=80):
    """Spread words over total_ms, weighted by length, with pauses after punctuation."""
    words = tokens(text)
    weights = []
    for w in words:
        pause = 7 if w[-1] in ".!?।" else 3 if w[-1] in ",;:" else 0
        weights.append((len(norm(w)) + 2, pause))
    unit = (total_ms - lead_ms) / max(1, sum(a + b for a, b in weights))
    t, out = lead_ms, []
    for w, (speak, pause) in zip(words, weights):
        out.append({"text": w, "startMs": round(t), "endMs": round(t + speak * unit)})
        t += (speak + pause) * unit
    return out


def align_to_script(text, timed):
    """Map provider word timings back onto the script tokens (keeps punctuation/casing)."""
    words = tokens(text)
    out = [None] * len(words)
    j = 0
    for i, w in enumerate(words):
        n = norm(w)
        for k in range(j, min(j + 4, len(timed))):
            if norm(timed[k]["text"]) == n or (n and norm(timed[k]["text"]).startswith(n)):
                out[i] = {"text": w, "startMs": timed[k]["startMs"], "endMs": timed[k]["endMs"]}
                j = k + 1
                break
    # Fill unmatched tokens (numbers read aloud, symbols) by interpolating between neighbours.
    for i, w in enumerate(words):
        if out[i]:
            continue
        prev_end = next((out[p]["endMs"] for p in range(i - 1, -1, -1) if out[p]), 0)
        nxt = next((out[q]["startMs"] for q in range(i + 1, len(words)) if out[q]), None)
        if nxt is None:
            nxt = timed[-1]["endMs"] if timed else prev_end + 300
        run = 0
        while i + run < len(words) and not out[i + run]:
            run += 1
        step = max(60, (nxt - prev_end) / run)
        out[i] = {"text": w, "startMs": round(prev_end), "endMs": round(prev_end + step)}
    return out


# ---------- providers ----------

async def _edge(text, voice, rate, mp3_path):
    import edge_tts  # noqa: imported lazily so other providers work without it

    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    comm = edge_tts.Communicate(text, voice, rate=rate, boundary="WordBoundary", proxy=proxy)
    timed = []
    with open(mp3_path, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 10_000  # 100ns ticks -> ms
                timed.append({"text": chunk["text"], "startMs": round(start),
                              "endMs": round(start + chunk["duration"] / 10_000)})
    return timed


def edge(text, voice_cfg, mp3_path):
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        die("edge-tts is not installed. Run: pip install edge-tts")
    voice = voice_cfg.get("voice", "en-US-AndrewNeural")
    rate = voice_cfg.get("rate", "+0%")
    timed = asyncio.run(_edge(text, voice, rate, mp3_path))
    return align_to_script(text, timed)


def post_json(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def elevenlabs(text, voice_cfg, mp3_path):
    key = os.environ.get("ELEVENLABS_API_KEY") or die("Set ELEVENLABS_API_KEY.")
    voice_id = voice_cfg.get("voice", "JBFqnCBsd6RMkjVDRZzb")
    raw = post_json(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128",
        {"text": text, "model_id": voice_cfg.get("model", "eleven_multilingual_v2"),
         "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.3}},
        {"xi-api-key": key},
    )
    data = json.loads(raw)
    with open(mp3_path, "wb") as f:
        f.write(base64.b64decode(data["audio_base64"]))
    a = data["alignment"]
    timed, cur = [], None
    for ch, s, e in zip(a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"]):
        if ch.isspace():
            if cur:
                timed.append(cur)
            cur = None
        elif cur is None:
            cur = {"text": ch, "startMs": round(s * 1000), "endMs": round(e * 1000)}
        else:
            cur["text"] += ch
            cur["endMs"] = round(e * 1000)
    if cur:
        timed.append(cur)
    return align_to_script(text, timed)


def openai(text, voice_cfg, mp3_path):
    key = os.environ.get("OPENAI_API_KEY") or die("Set OPENAI_API_KEY.")
    body = {"model": voice_cfg.get("model", "gpt-4o-mini-tts"), "voice": voice_cfg.get("voice", "onyx"),
            "input": text, "response_format": "mp3"}
    if voice_cfg.get("instructions"):
        body["instructions"] = voice_cfg["instructions"]
    audio = post_json("https://api.openai.com/v1/audio/speech", body, {"Authorization": f"Bearer {key}"})
    with open(mp3_path, "wb") as f:
        f.write(audio)
    total = probe_duration_ms(mp3_path) or len(text.split()) * 380
    return estimate_words(text, total)


PROVIDERS = {"edge": edge, "elevenlabs": elevenlabs, "openai": openai}


def main():
    project_path = os.environ.get("PROJECT") or os.path.join(ROOT, "project.json")
    if not os.path.exists(project_path):
        die("No project.json. Copy project.example.json and write your script into it.")
    with open(project_path, encoding="utf8") as f:
        project = json.load(f)
    voice_cfg = {"provider": "edge", **project.get("voice", {})}
    provider = voice_cfg["provider"]
    if provider == "file":
        log("voice.provider is 'file': run `npm run transcribe` to time your own recording.")
        return
    if provider != "none" and provider not in PROVIDERS:
        die(f"Unknown voice.provider '{provider}'. Use edge, elevenlabs, openai, none or file.")

    os.makedirs(VO_AUDIO, exist_ok=True)
    os.makedirs(VO_DATA, exist_ok=True)
    wpm = float(voice_cfg.get("wpm", 165))

    for i, scene in enumerate(project["scenes"]):
        sid = scene_id(i)
        text = scene["text"].strip()
        key = hashlib.sha1(json.dumps([voice_cfg, text], sort_keys=True).encode()).hexdigest()[:12]
        data_path = os.path.join(VO_DATA, f"{sid}.json")
        mp3_path = os.path.join(VO_AUDIO, f"{sid}.mp3")
        if os.path.exists(data_path):
            with open(data_path) as f:
                cached = json.load(f)
            if cached.get("key") == key and (cached["audio"] is None or os.path.exists(mp3_path)):
                log(f"{sid} cached")
                continue

        if provider == "none":
            total = int(len(tokens(text)) / wpm * 60_000) + 250
            words, audio = estimate_words(text, total), None
        else:
            words = PROVIDERS[provider](text, voice_cfg, mp3_path)
            total = probe_duration_ms(mp3_path) or (words[-1]["endMs"] + 250)
            audio = f"vo/{sid}.mp3"

        with open(data_path, "w") as f:
            json.dump({"key": key, "audio": audio, "durationMs": total, "words": words}, f, indent=1)
        log(f"{sid} {total / 1000:.2f}s  \"{text[:60]}{'...' if len(text) > 60 else ''}\"")


if __name__ == "__main__":
    main()
