# Visuals for aviation and disaster Shorts

Vertical 1080x1920. Something moves on screen every 1.5-3 seconds. Use the same look every day
(documentary style, the globe opener, the same caption style) so viewers recognise the channel. The first frame already shows
the subject (a plane, the storm, the map) - never a black or title-only opening.

## Choosing the visual for each beat (decide beat by beat)

Go through the script beat by beat and ask, in this order:

**1. Is there real footage or a real photo of THIS event that we may use and that is exactly right?**
Real means from the event itself, from an allowed source (agency, DVIDS, NASA, Wikimedia with a
free licence, the owner's own files), and **you checked what it shows** (same aircraft, same
place, same storm, same day). Then use it. Download it to `public/footage/` and use a `file:`
beat. Every such file goes into `build/facts.json` under `"media"` (`factcheck.mjs` fails
otherwise):
`{ "file": "footage/ntsb-wreckage.mp4", "shows": "NTSB investigators at the site, Nov 3", "source": "https://www.ntsb.gov/..." }`

**2. No exact real footage? Explain it with the animation that fits what must be understood:**

| What the viewer must understand | Use | Kind |
|---|---|---|
| Where it is, how far, the route | `globe` (opener: cinematic 3D Earth with satellite imagery; `light: "night"` for night events) or `map` | 3D / 2D |
| Radar contact lost, vanished, stopped responding | `radar` with `vanish` | instrument / UI (SaaS-style) |
| How altitude, speed, wind or water changed over time | `profile` | 2D motion graphic |
| Which part failed, a door, an engine, gear | `aircraft` (`top` or `side`) with `highlight` and `labels`; `light` = the local time of the event (`day`, `dusk`, `night`) | 3D airliner flying over clouds |
| How the plane moved: banked, pitched, dived | `aircraft` with `roll` (top) or `pitch` (side) | 3D airliner, real horizon |
| The order of events | `timeline` or `steps` | motion graphic |
| One number that matters | `counter`; comparisons `bars` / `compare` | motion graphic |
| Official words (report, statement, ATC transcript) | `quote` (with `by` and the date) | typography |
| The key line or the open question | `statement` | typography |
| An official web page or report, shown as it is | `ui` with a screenshot in `public/` | UI (SaaS-style) |

Pick the one that makes it clearest. Do not use the same graphic type twice in a row.

**The `aircraft` graphic is a generic twin-engine jet airliner** (two engines under the
wings, one fin): it fits a 737, A320 family, 757, 767, 777, 787, A330, A350 or an E-Jet.
Never use it for any other type: a turboprop (ATR, Q400), rear-engined jets (CRJ,
business jets), four-engine aircraft (747, A380), small planes, helicopters or military
types. Showing the wrong shape is a factual error. For those, show the part with real
photos of that type, or use `profile`, `radar`, `timeline` or `statement` instead.
Set `light` from the event's local time: `day`, `dusk` (around sunrise/sunset) or `night`.
A typical 50-second Short has 2-4 explainers plus real or neutral footage between them.

**3. Neutral stock footage only for context, never as the event.** An airport, a runway at
night, clouds, a cockpit, a storm sky. Never stock footage of a crash, wreckage, fire, rescue
or damage, and never a different aircraft type or airline than the one involved: viewers would
take it as the real event. That is inaccurate even if the voice is right.

## Vertical 9:16, always
- Everything renders 1080x1920. Graphics are laid out for the Shorts safe zone (clear of the
  title and buttons at the bottom and the right edge).
- Wide (16:9) real footage: `"fit": true` shows the whole frame over a blurred copy of itself.
  It is automatic for archival, official and `file:` footage. Use `"focus": [x, y]` instead when
  the subject can be cropped safely.
- Prefer vertical or square stock. Look at the QA sheets: no one important cut off at the edge.

## Visual plan, typical order
| Script moment | Best visual |
|---|---|
| The opening (most stories) | `globe`: the earth turns in and flies to the place; with `"route": true` it draws the flight path and flies a plane along it |
| Where it happened (later) | `map` with the place(s) and the highlighted country/state |
| The moment it went wrong | real footage if it exists, else `radar` (contact lost) or `aircraft` (what failed / how it moved) |
| How fast it happened | `profile` (altitude, speed) or `counter` |
| The investigation | official photos (NTSB/FAA/agency), then `quote` from the report |
| Weather / disaster | NOAA/NASA satellite imagery and loops, NWS radar images, USGS maps, FEMA photos; `profile` for wind or water |
| The open question | `statement` |

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
