# B-roll Keywords - getting clips that match the line

## Beats: the picture follows the words

Write every scene's `broll` as beats. A beat names the words it illustrates
(`on`, copied from the line) and what to show (`kw`):

```json
{ "text": "Every pull to refresh works exactly like a *slot machine*. You never know what you'll get.",
  "broll": [
    { "on": "Every pull to refresh", "kw": ["finger swipe phone screen"] },
    { "on": "slot machine", "kw": ["slot machine lever casino", "slot reels spinning close up"], "sfx": "sfx/spot/slot-lever.mp3" },
    { "on": "You never know", "kw": ["gift box opening surprise"] }
  ] }
```

- The shot starts on the first word of `on` (2 frames early) and runs until the
  next beat. The first beat always opens the scene.
- `on` must be in the line word for word, beats in the order of the line (lint
  checks both). Bengali/Hindi lines: `on` is in the line's language, `kw` in English.
- One beat per thing the voice names: the noun, the action, the number, the
  place. A beat under ~0.6s can't be seen and is merged into the previous one.
- `kw` is a list: the first is the main shot; the others are second angles of
  the same subject, used when the beat is long (over ~`maxShotSeconds`) and as
  fallbacks when the first finds nothing relevant. Long beat, one keyword: a
  second clip of the same keyword.
- `sfx` (optional): a sound for what the picture shows, starting on the cut.
- `credit` (optional): attribution for that clip, e.g. `"\"Title\" by Name, CC BY 4.0 - <link>"`.
  It goes to `build/credits.txt` and into the YouTube description.

Plain strings (`"broll": ["kw a", "kw b"]`) still work: each is matched to the
first word of the line it names ("phone screen glow" -> "phone"), else spread
evenly. That's a guess, so use beats when it matters, always for non-English lines.

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
| `"photo:old map of london"` | photos only (stock + archive, Ken Burns). Good for places, documents |
| `"archive:Apollo 11 launch"` | Wikimedia Commons + NASA only: real people, places, events, dates. CC/PD licences that allow commercial use; CC BY needs the credits in the description |
| `"ai:a 1950s lab with pigeons in boxes"` | generated still (OPENAI_API_KEY). For things that can't be filmed; never to "show" a real event. Disclose if it looks real |
| `"file:intro.mp4"` / `"file:chart.png"` | user's own asset in `public/` |
| `"file:clips/talk.mp4#12.5-16"` | just that part of your own or licensed video (seconds, or `#1:05-1:09`); cut once, exactly |
| `"adobe:430358060"` | an Adobe Stock clip licensed through the Adobe connector and added with `scripts/adobe-stock.mjs` (see footage-sources.md) |

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
- `photo:` searches stock photos and the archives; plain keywords that name
  something real (a year, a proper noun) automatically include Wikimedia / NASA
  results too.
- Review sheets (`--review`) let Claude look at 6 candidates per shot and pick
  the one that matches the line; see SKILL.md Step 3.

Still look at the contact sheet: relevance scoring can't see that a "phone
settings" clip shows lipstick.

## Motion graphics: when the line is a fact

A beat can be a graphic instead of footage. It is drawn from the data you give,
so it is exactly right, and it counts as a pattern interrupt:

```json
{ "on": "more people than Russia", "graphic": { "type": "bars", "title": "Population, millions",
  "data": [["Bangladesh", 173.6], ["Russia", 144.8]], "highlight": 0, "source": "UN World Population Prospects 2024" } }
{ "on": "3 million", "graphic": { "type": "counter", "value": 3000000, "label": "people", "source": "..." } }
{ "on": "Dhaka", "graphic": { "type": "map", "countries": ["Bangladesh"], "places": ["Dhaka"], "source": "Natural Earth" } }
{ "on": "from Dhaka", "graphic": { "type": "map", "places": ["Dhaka", "Tokyo"], "route": true } }
{ "on": "In 1977", "graphic": { "type": "timeline", "events": [["1977", "Launch"], ["1979", "Jupiter"]], "highlight": 1 } }
{ "on": "Sagan wrote", "graphic": { "type": "quote", "text": "Look again at that dot.", "by": "Carl Sagan, Pale Blue Dot (1994)" } }
```

- **counter**: `value` is a number (3000000, not "3 million"); `prefix`, `suffix`,
  `decimals`, `label`. It counts up.
- **bars**: 2-6 rows of `[label, number]`, `unit`, `highlight` (row index). Bars grow in order.
- **map**: `countries` by English name as Natural Earth spells them ("United
  States of America"; lint lists close names), `places` as names (geocoded with
  OpenStreetMap and cached; the log says what each resolved to, check it) or
  `{ "name", "lat", "lon", "label" }`, `route: true` draws a great-circle line
  through the places in order. The map frames what you name.
- **timeline**: 2-6 `[date, what]` rows, `highlight`.
- **quote**: `text`, `by` (who, where, when).
- Every type takes `title`; counter, bars and map should carry a `source`.
- Use the real figure and say it the same way in the line. Don't round in one place and not the other.
- Don't put `emphasis` on a scene with a graphic: both use the top of the frame.

## No random footage

A search result is used automatically only if its tags / title share words with
the keyword (`brollMinRelevance`, default 0.25: at least one of four words). If
the main keyword has none, the beat's other keywords are tried; if none has a
relevant result the shot becomes the kinetic background, and the run prints the
words it couldn't illustrate. A review pick always wins. `out/check/sync.txt`
lists every shot with its words, keyword and match score ("weak?" under 0.5).

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
