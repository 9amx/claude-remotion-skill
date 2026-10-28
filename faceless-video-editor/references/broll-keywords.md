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

## Fixing a bad clip

Look at the contact sheet. For a wrong shot: change that keyword in
project.json, delete the matching `public/broll/sNN-K-*.mp4`, then
`node scripts/auto.mjs --from=broll`. Search results are cached in
`build/search-cache/`; a changed keyword is a new search. Already-used clip IDs
are skipped automatically, so the same clip won't appear twice in one video.

## Free API keys

- Pexels: https://www.pexels.com/api/ - instant, 200 req/hour. Best portrait library.
- Pixabay: https://pixabay.com/api/docs/ - instant. Mostly landscape; good fallback.

Both are free for commercial use; `build/credits.txt` lists the creators so you
can credit them in the description (appreciated, not required).
