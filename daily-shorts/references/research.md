# Research: finding and verifying the day's topic

## Where to look (in this order)

**Aviation (USA first)**
- NTSB: news releases, investigations, the CAROL database, preliminary reports, media briefings.
- FAA: statements, Accident and Incident notices, airworthiness directives.
- Aviation Herald (avherald.com), Aviation Safety Network (aviation-safety.net) for incident lists.
- Major outlets (AP, Reuters, NYT, WSJ, Washington Post, BBC, CNN, NBC, ABC, CBS) to confirm.
- Europe and others: AAIB (UK), BEA (France), BFU (Germany), EASA, ATSB (Australia), TSB (Canada).

**Natural disasters**
- USA: NOAA / National Weather Service, National Hurricane Center, USGS (earthquakes, volcanoes),
  FEMA, NASA Earth Observatory, state emergency agencies.
- Europe: Copernicus EMS, national meteorological offices, EU civil protection.

**When nothing recent is strong enough:** famous unresolved or instructive cases (missing aircraft,
historic crashes that changed safety rules, record storms), ideally tied to an anniversary this week.

## Scoring (pick the highest total; 1-5 each)

| Criterion | 5 means | From |
|---|---|---|
| Demand | people are watching this topic now (median views/hour high) | `build/demand.json` demand |
| Room | few strong Shorts on it yet, or we have a fresher angle | 6 - `build/demand.json` crowding |
| Fresh or timely | happened in the last 72 h, or an anniversary this week | your research |
| Verified | official investigators/agencies have published the key facts | your research |
| Visuals we may use | official photos/video, satellite imagery, a clear route/place for the globe | your research |
| Channel fit | category and format that do well in `../performance.json` | performance.json |
| Low harm | can be told without graphic detail or blaming anyone | your judgement |

Double-weight **Demand** and **Verified**. Do not pick a topic below 3 on **Verified** or **Low harm**,
whatever its total. Demand 1 means nobody is searching it: pick it only if nothing else is good.

## Verification rules
- Two independent reliable sources for every fact on screen or in the voice.
- Prefer the primary source (the NTSB/agency document) over articles about it.
- Use exact figures from the source and the date they were true ("as of Tuesday, officials
  said 12 people were injured"). Death tolls change: say who reported it and when.
- Note what is *unknown*. "The cause is under investigation" is a valid, honest line.
- Every fact goes into `build/facts.json` with the exact supporting sentence copied from each page
  (`quote`). `factcheck.mjs` opens the pages and fails on a misquote, a dead link, or a number or
  name in the video that no fact backs. Pages it cannot open (paywalls, bot walls) do not count as
  confirmed: add an agency page or a wire service (AP) that can be read.
- The YouTube description lists the sources.
