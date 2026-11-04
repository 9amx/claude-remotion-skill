# Visuals for aviation and disaster Shorts

Vertical 1080x1920. Something moves on screen every 1.5-3 seconds. Use the same look every day
(documentary style, the globe opener, the same caption style) so viewers recognise the channel. The first frame already shows
the subject (a plane, the storm, the map) - never a black or title-only opening.

## The visual plan (map it to the script before searching footage)
| Script moment | Best visual |
|---|---|
| The opening (most stories) | `globe` graphic: the earth turns in and flies to the place; with `"route": true` it draws the flight path and flies a plane along it; the last place pulses |
| Where it happened (later) | `map` graphic with the place(s) and highlighted country/state |
| A flight's route | `globe` with `"route": true` (origin first, then where it ended), exact coordinates from `facts.json` |
| Times, altitudes, counts | `counter` or `timeline` graphic (from official figures) |
| The aircraft | stock or Wikimedia photo of the **same type and, if possible, operator livery**; never another type |
| The investigation | official photos (NTSB/FAA/agency), investigators at work, documents |
| Weather / disaster | NOAA/NASA satellite imagery and loops, NWS radar images, USGS maps, FEMA photos |
| Mood / transitions | stock B-roll: night runway, cockpit at night, control tower, storm clouds, rain on glass |
| The open question | `statement` graphic with the key line |

## Public-domain and free sources (use these, credit them)
- NTSB media (photos and B-roll from investigations; US government work, public domain).
- FAA, NOAA, NWS, NASA, USGS, FEMA images and video (US government, public domain; credit the agency).
- DVIDS (US military media; public domain) for military aircraft or rescue operations.
- Wikimedia Commons (check each file's licence: PD or CC BY/BY-SA with credit).
- Stock: Pixabay, Coverr (via the faceless-video-editor `fetch-broll` script).
Every file used goes into the credits (`build/credits.txt`), which the description includes.

## Never use
- TV news footage, other YouTubers' clips, social media videos of the event (copyright and consent).
- Images of victims, bodies, injured people, or close-ups of grieving people.
- AI-generated "photos" of the real event presented as real.
- A different aircraft type or airline livery than the one involved, or a map of the wrong place.

## Captions and text
- Captions: 2-3 words per page, centered in the safe area (not under YouTube's buttons at the
  bottom right or the title at the bottom).
- Text pops only for a number, a name or a date the viewer must remember.
- Check every caption and pop against the script after the render.
