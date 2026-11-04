# Packaging: title, description, tags, timing

Shorts are found in the feed and through search. The feed tests the first seconds. Search needs
the words people type. `package-check.mjs` enforces the rules below.

## Title (40-60 characters)
- Lead with what people search: the airline + flight number, the place, the storm or quake name,
  the aircraft type. Then the hook. Examples of form:
  - "Delta 2210: The 4 Minutes Before It Vanished"
  - "Why Hurricane Lena Grew So Fast Over Tampa"
- Write 5 options, score each 1-5 on: searchable, curiosity, accuracy, respect. Take the highest.
  Write all 5 and the scores in the log.
- Never bait: no "shocking", "horrific", "you won't believe", no ALL CAPS, no promise the video
  does not keep. YouTube limits ads and reach on tragedy bait.

## Description
1. One plain sentence about the event (shows under the title).
2. Two or three lines of context or what is still unknown.
3. `Sources:` and the source URLs from `build/facts.json` (2 or more, official first).
4. A line saying the narration is AI-generated.
5. 3-5 hashtags, `#shorts` first, then the topic (`#aviation #ntsb #delta`).

## Tags
5-10 search terms: airline, flight number, aircraft type, place, event type, agency.

## Settings
- `"syntheticMedia": true` (AI voice about real events must be disclosed).
- `"madeForKids": false`.
- `"categoryId": 25` News & Politics for current events, `27` Education for history and explainers.
- Approval mode: `"privacy": "private"`; the owner publishes it from the YouTube Studio app.
- Auto mode: `"privacy": "private"` plus `"publishAt"` = `node <skill>/scripts/package-check.mjs --slot`
  (12:00 New York time by default, env `DAILY_PUBLISH_ET` to change). Note: until the owner's Google
  Cloud project passes YouTube's API audit, YouTube keeps API uploads private anyway.

## Subscribers
- A consistent look (same caption style, colours, globe opener) makes the channel recognisable.
- Series continuity: when a story develops (a final report, new findings), make a follow-up and
  mention it in the first line ("Update:"). Follow-ups convert viewers into subscribers.
- Topics that perform (see `../performance.json`) are the channel's identity: do more of them.
