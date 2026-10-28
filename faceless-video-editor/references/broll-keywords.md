# B-roll Keywords - getting clips that match the line

`fetch-broll.mjs` splits every scene into shots of at most `maxShotSeconds` and
searches one keyword per shot, cycling through the scene's `broll` list. A 7s
scene at 2.8s/shot = 3 shots = keywords 1, 2, 1 (give 3 keywords to avoid a repeat).

## Rules

1. **Filmable nouns + action + setting**: `"woman jogging city sunrise"`, not
   `"motivation"`. Stock search matches what is *visible*, not what it means.
2. **2-4 words.** One word is too broad, six is too narrow (zero results).
3. **English**, even for Bengali/Hindi videos.
4. **Show the metaphor, not the word**: "debt" -> `"pile of bills on table"`;
   "anxiety" -> `"person biting nails close up"`; "time passing" -> `"clock timelapse"`.
5. **Vary the shot size** across a scene: one wide (`"aerial city night"`), one
   close (`"eyes close up screen light"`).
6. **Avoid** faces looking into the lens for narration you didn't write for them,
   brand logos, text on screen (fights the captions), and anything that dates the
   video (old phones) unless it's the point.
7. People + specific action beats objects. Movement beats static.

## Prefixes

| Entry | Meaning |
|---|---|
| `"city traffic night"` | search Pexels video, then Pixabay, then Pexels photo |
| `"photo:old map of london"` | photo only (Ken Burns). Good for history, places, documents |
| `"file:intro.mp4"` / `"file:chart.png"` | user's own asset in `public/` |

Scene-level `"visual": "kinetic"` skips B-roll entirely (animated background) -
use for the CTA or for a big-number `emphasis` scene.

## What the fetcher does for you

- **Relevance**: each hit is scored by how many keyword words appear in its
  tags (Pixabay) or page slug / alt text (Pexels), then orientation, then
  length. So write the words you want to SEE: they are matched literally.
- **Sharpness**: picks the smallest rendition that fills the frame with at most
  ~1.35x upscaling (a landscape clip in a 9:16 Short needs ~1440p+).
- **Frame check**: after download it samples three frames and rejects clips that
  are nearly black or chroma-key green (green-screen mockups), then takes the
  next result automatically. Clips tagged green screen / mockup / template are
  skipped before download.
- `photo:` searches Pexels photos, then Pixabay photos.

Still look at the contact sheet: relevance scoring can't see that a "phone
settings" clip shows lipstick.

## Fixing a bad clip

Look at the contact sheet. For a wrong shot, change that keyword in
project.json and run `node scripts/auto.mjs --from=broll`: a changed keyword
gets a new search, every other shot keeps its clip, and the unused file is
deleted. To re-roll a shot with the *same* keyword, delete its file (the path
is in `build/broll.json` under the scene id) and re-run. Search results are
cached in `build/search-cache/`, and a clip is never used twice in one video.

## Free API keys

- Pexels: https://www.pexels.com/api/ - instant, 200 req/hour. Best portrait library.
- Pixabay: https://pixabay.com/api/docs/ - instant, 100 req/minute. Mostly landscape;
  the workhorse for long form.

Both are free for commercial use; `build/credits.txt` lists the creators so you
can credit them in the description (appreciated, not required).
