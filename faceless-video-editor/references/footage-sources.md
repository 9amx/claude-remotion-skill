# Footage sources - the right picture for every kind of line

No single library is accurate for everything. Pick the source by what the line
says, then review every shot (SKILL.md Step 3). Accuracy comes from both.

| The voice says... | Use | Why |
|---|---|---|
| a generic thing or action ("scrolling a phone", "city at night") | stock: Pixabay, Adobe Stock (connector), Pexels if you have a key | filmed, plentiful |
| a real person, place, event, date ("Apollo 11", "Dhaka 1971") | `archive:` (Wikimedia Commons, NASA), licensed news footage | stock lookalikes and AI are wrong by definition |
| a number, comparison, ranking, share | `graphic` counter / bars | drawn from your data: exactly right |
| where something is, a route, a country | `graphic` map | real borders, geocoded places |
| a sequence of dates | `graphic` timeline | the dates are the content |
| someone's words | `graphic` quote (with source) | no stock clip "shows" a quote |
| an app, website, article, tweet | `file:` screenshot or screen recording | the real thing |
| something that can't be filmed (inside a cell, a hypothetical) | `ai:` still (or AI video through a connector) | disclose as synthetic; never for real events |

## Stock libraries

- **Pixabay** (`PIXABAY_API_KEY`, free, instant): video + photos, the main stock
  source now. Request at https://pixabay.com/api/docs/.
- **Pexels** (`PEXELS_API_KEY`): new API keys have been paused since about
  September 2026 with no reopening date. An existing key keeps working
  (200 requests/hour); without one, Pixabay + Adobe Stock cover it.
- **Adobe Stock** through the Adobe connector in Claude (no key in the script):
  search, license and download. Titles are descriptive, so matches are easier to
  judge; a free collection costs nothing, the rest uses the user's Stock plan.
  Flow below.
- **Coverr** (free key, 50 requests/hour, 2,000 on a paid plan): not built in.
  Its license allows commercial use but the API page asks for a logo credit and
  has a conflicting sentence on commercial use; confirm with team@coverr.co first.
- **Paid, by sales**: Storyblocks API (Enterprise), Shutterstock API, Getty
  Images (the legitimate source for news, sports and celebrities).
- **No API** (download by hand, use `file:`): Envato Elements, Artgrid, Mixkit,
  Videvo, Pond5.

## Adobe Stock through the connector

The connector's tools run in Claude; `scripts/adobe-stock.mjs` turns their
results into review sheets and local files.

1. After `node scripts/auto.mjs --review`, for a shot `<key>` (e.g. `s003-1`)
   whose stock candidates are weak, search Adobe Stock with the shot's keyword:
   `asset_search` with `entityScope: "StockAsset"`, `filters.contentType: "Video"`,
   `filters.pricing: "free"` first, `limit: 10`. For Shorts add
   `filters.orientation: "portrait"`; with too few results search without it: a
   4K landscape clip crops into 9:16 sharply.
2. Save the result JSON to `build/adobe/<key>.json` and run
   `node scripts/adobe-stock.mjs sheet <key> build/adobe/<key>.json`. Look at
   `build/review/<key>-adobe.jpg` (A1-A6, labelled FREE/PAID and size) next to
   the stock sheet, against the shot's `words` in `build/review.json`.
3. License the winner: `asset_license_and_download_stock` with its id, `size`
   `"1080"` (or `"2160"` for a landscape clip in a Short). A free asset licenses
   directly. If the tool answers `confirmationRequired` with a quote, the asset
   costs money or plan credits: show the user the quote and license only after
   they say yes.
4. Within the hour the URL is valid:
   `node scripts/adobe-stock.mjs add <id> "<downloadUrl>" --title "<title>" --pick <key>`.
   It converts any Adobe codec to H.264, registers the clip in `build/adobe.json`
   and writes the pick. Then `node scripts/auto.mjs --from=broll`.

`"adobe:<id>"` also works directly as a beat keyword. Licensed originals are
never deleted by the cleanup; `build/credits.txt` lists them as licensed.

## Short clips from other people's videos

Length doesn't make a clip safe: Content ID matches a few seconds, and there is
no "5 second" or "10 second" rule. A clip you don't have the rights to can cost
the video its revenue (claim), the channel a strike (three end it), and a
channel built from other people's footage its monetization ("reused content").
Never pull footage out of YouTube with a downloader: YouTube's terms forbid it.

Clips you can use:
- **Creative Commons (CC BY):** YouTube search -> Filters -> Creative Commons.
  Check the uploader made it (a re-upload marked CC still gets claimed), and get
  the file from the maker's own site or archive where possible.
- **With permission:** ask the maker for the file and written permission.
- **Public bodies:** NASA, ESA, government agencies, museums publish the same
  footage in their own archives (`archive:` covers NASA and Wikimedia).
- **Shorts Remix -> Cut** in the YouTube app: 1-5 seconds of an eligible video
  inside a Short, credited and linked by YouTube itself.

Use them as `"file:clips/source.mp4#12.5-16"` (just that part, cut exactly) with
a `"credit"` on the beat; the credit lands in `build/credits.txt` and the
YouTube description. Keep each clip short and talk over it with your own point:
it should support the story, not be the story.

## Archives

`archive:` searches Wikimedia Commons (licences that allow commercial reuse,
CC BY needs the credit in the description) and NASA (public domain). Other
public archives for manual `file:` use: Internet Archive (Prelinger and
newsreels; check each item's rights), DVIDS (US military, mostly public domain,
free API key), National Archives, national libraries.
