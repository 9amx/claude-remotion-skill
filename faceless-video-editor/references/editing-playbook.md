# Editing Playbook - every edit type, when to use it, how to call it

The template does the mechanics. This file is the editor's judgement: which tool
for which moment. Do an **edit pass** over project.json after the script is
written and before running the pipeline: walk the scenes and assign the tools
below on purpose, not at random.

A note on evidence: retention advice online is mostly practitioner experience
and vendor blogs, not controlled studies. The numbers here are sensible
defaults that most sources agree on. Check the creator's own YouTube Studio
retention graph and "viewed vs swiped away" (Shorts) and adjust.

## The rules that matter most

1. **The first frame is a thumbnail.** Shorts autoplay muted in the feed: frame 0
   needs big readable text (scene 1 `emphasis`, visible on frame 0) over the most
   striking shot you have. The voice starts within 0.5s.
2. **One promise, kept.** The hook makes a promise; the video exists to pay it
   off. A hook the video doesn't pay off wins the swipe and loses the watch time.
3. **The picture changes every 2-4s (Shorts) / 4-8s (long).** Cuts, punch-ins
   and transitions all count. `check` reports the longest hold.
4. **A pattern interrupt every 8-12s (Shorts) / 60-90s (long).** Something bigger
   than a cut: emphasis, badge, lower third, look change, split, freeze, reveal.
   `lint` and `check` report the longest stretch without one.
5. **No dead air.** Pauses over ~0.4s inside a thought get cut. TTS is already
   tight; for recordings `voice.tightenPauses` (default on) jump-cuts them.
6. **Sound sells the cut.** Whoosh on movement, hit on impact, riser into a
   reveal, silence right before it. Music sits under the voice, never over it.
7. **Restraint.** Every effect used everywhere becomes noise. If every scene
   has an emphasis, a shake and a glitch, none of them register.

## Edit styles (`editStyle`)

Pick one per video; it sets the defaults below. Anything set explicitly wins.

| editStyle | Shot length (Shorts / long) | Transitions | Punch-ins | SFX | Captions | For |
|---|---|---|---|---|---|---|
| `viral` | 2.2s / 3.5s | auto: whip, zoom, glitch, flash | on highlights | dense | pop | facts, lists, tech, money, "things you didn't know" |
| `story` | 3.5s / 5s | dip to black | off | medium | karaoke / subtitle | true crime, history, documentary, mystery |
| `explainer` | 3s / 4.5s | zoom | on highlights | medium | boxed / subtitle | how-it-works, finance, science, tutorials |
| `calm` | 3.8s / 6s | crossfade | off | light | karaoke / subtitle | motivation, stories, aesthetic, sleep, quotes |

## Script markup

- `*word*` or `*two words*` - highlight. Accent color in captions, a touch
  larger, a punch-in zoom (viral/explainer) and a soft tick. Numbers are
  highlighted automatically. One or two per scene, on the words that carry the
  point: the number, the twist, the "never".

## Scene-level tools (project.json)

| Field | Values | What it does | Use it for |
|---|---|---|---|
| `emphasis` | 1-4 words | Big text, staggered slam; numbers count up | the hook, a number, the reveal, the CTA |
| `badge` | "#3", "STEP 2", "MYTH", "1956" | corner tag for the scene | listicle items, steps, dates, myth/fact |
| `lowerThird` | `{title, subtitle}` | name/place/date tag | people, places, dates (documentary, true crime) |
| `layout` | `"split"` | two clips side by side (top/bottom on 9:16) with a VS divider | comparisons, then vs now, expectation vs reality |
| `look` | `flashback` `dramatic` `night` `vhs` `dream` | grade for the picture | flashback = the past; dramatic = danger, stakes; night = crime, mystery; vhs = 80s/90s, found footage; dream = memory, fantasy |
| `transition` | `whip` `zoom` `glitch` `flash` `dip` `fade` `cut` | how this scene enters (overrides the style) | whip = energy, a jump in place/time; zoom = going deeper; glitch = tech, error, twist; flash = impact; dip = time passing, chapter, serious beat; fade = calm, emotional; cut = continuity |
| `fx` | `"reveal"` | music drops out under a riser, the scene lands on a hit | the payoff, the twist, the mid-video rehook |
| `fx` | `"freeze"` | picture freezes with a flash and a record scratch | "that's me, and you're wondering how I got here", the moment it went wrong |
| `fx` | `"shake"` | impact camera shake | crashes, explosions, shocking lines (rarely) |
| `fx` | `"punch"` | punch-ins on this scene's highlights even in story/calm | a single hard line in a calm video |
| `visual` | `"kinetic"` | animated background instead of B-roll | CTA, big-number scene with emphasis |

`fx` takes a string or a list: `"fx": ["reveal", "shake"]`. Chapters can set a
default `look` for all their scenes.

## Recipes by niche

**Facts / "things you didn't know" (viral, bold, tense)**
Hook: the most surprising fact as a claim + `emphasis`. Each fact one scene with
a `badge` ("#1" ...), the best one last with `fx: "reveal"`. Highlight the
number in every fact. Loop line at the end.

**Listicle / tips (viral or explainer, upbeat)**
`badge` on every item, emphasis only on the best item. Split layout for a
"don't / do" item. CTA "Follow for part 2".

**True crime / mystery (story, documentary, tense; long: night look chapters)**
Cold open mid-action, `look: "night"` or `"dramatic"`. `lowerThird` for every
person, place and date the first time it appears. `photo:` keywords for
documents and places. Flashback look + `dip` for the backstory. `fx: "reveal"`
on the twist; `freeze` on the moment it went wrong. No shake, no glitch.

**History / documentary (story, documentary)**
`flashback` look on archival-style scenes, `lowerThird` for dates, `badge` for
years, `dip` between eras. Counting `emphasis` for scale ("24 BILLION KM").

**Explainer / finance / tech (explainer, minimal)**
Highlight every number. Split layout for comparisons. `badge` for steps.
`glitch` transition only on "but here's the problem" beats.

**Motivation / story (calm, documentary, calm music)**
Crossfades, karaoke captions, few highlights, no SFX beyond the hit. One
`fx: "reveal"` on the lesson. Slower rate (+0%).

**Reddit / text stories (viral or story)**
Hook = the conflict in one line. `badge` "UPDATE" for the update. Moody generic
B-roll (rain window, city night). End on the verdict question.

## Long-form structure (5-40 min)

- **Cold open (first 30-60s)**: the most dramatic moment or sharpest version of
  the promise, then "to understand how we got here...". No intro, no greeting.
- **Open loops**: plant one early ("and that decision would cost him everything")
  and close it later. 1-3 per video; every loop gets closed, or trust drops.
- **Rehook at ~40-50%**: a scene with `fx: "reveal"` that raises the stakes or
  previews what's next. `lint` warns if there is none between 30% and 70%.
- **Chapter rhythm**: each chapter opens with a question and ends answering it
  while opening the next.
- **Interrupt every 60-90s**: lower third, badge, look change, split, reveal.
- **Avoid an on-screen roadmap** ("in this video we'll cover 5 things"): it lets
  viewers judge how much is left and leave.

## Sound design (automatic, tune with sfxLevel)

- `hit` on frame 0 and on reveals; `whoosh` 4 frames before whip/zoom/flash
  cuts; `glitch` on glitch cuts; `pop` when emphasis lands; `scratch` on freezes;
  `riser` into reveals with the music dropped to ~12% under it; `tick` on
  highlighted words (viral/explainer only, max ~1/sec).
- `sfxLevel` 0-1 scales all of it; `"sfx": false` turns it off.
- Music: 8-15% under voice, ducked while someone speaks and lifted
  `music.gapBoost` (1.7x) in the gaps between lines, crossfades between chapter
  moods, swells after the last word.

## Sound design you add (what big channels do)

The kit above marks the EDIT (cuts, reveals). Big channels also make the
FOOTAGE sound real:

- **Beat sounds** (`broll[].sfx`): the thing on screen makes its sound as it
  appears: camera shutter on a photo, cash register on money, door slam, crowd
  gasp, keyboard typing, a heartbeat under tension. Kit names work too (`"hit"`
  on a shocking number). 2-5 in a Short, a few per minute in long form; on the
  beats that matter, not every cut.
- **Ambience** (`scene.ambience`): the place, under the voice: rain, city night,
  office hum, forest, crowd murmur, old film projector for archive footage.
  Very quiet (`volume` 0.06-0.15). It sells "we are there" more than any effect.
- Silence is a sound too: the reveal drops music and ambience for a beat.

## Transitions: motivated, not random

`transitionStyle: "auto"` (the viral default) chooses by meaning: **flash** into a
reveal, **dip** into a flashback / dream / new chapter, **glitch** into VHS,
**whip** out of a look and onto the next list item, **zoom** into a split
comparison, otherwise whip and zoom alternate (never the same twice by chance).
Inside a scene, shots are hard cuts on the words. That's how real edits work:
the transition marks a change, the cut carries the story.

## Hooks: archetypes

| Archetype | Example | Best for |
|---|---|---|
| Curiosity gap | "There's a reason most hotels skip the 13th floor." | facts, mystery |
| Bold claim | "Your phone was designed so you can't put it down." | explainers, tech |
| Stakes / loss | "This one habit is costing you two hours a day." | self-improvement, money |
| Question | "Why do planes still have ashtrays?" | facts, explainers |
| In medias res | "The diver had four minutes of air left." | stories, true crime |
| Specific number | "In 1983 one man stopped a nuclear war by doing nothing." | history |
| Direct address | "If you sleep next to your phone, stop." | tips |
| Contradiction | "The safest seat on a plane isn't where you think." | myths, facts |

Hook checklist (the `lint` step enforces the first three):
- No warm-up ("hey guys", "in this video", "did you know", greetings in any language).
- Under ~14 words (Shorts) / ~24 (long) for the first sentence.
- A tension signal: a number, "you", a contrast, a question, a stake.
- Readable `emphasis` text on frame 0 over the strongest shot.
- Pay the hook off. If the payoff is weak, change the hook, not the payoff.

## Endings

- Shorts: loop line (the last sentence flows into the first) or one CTA
  ("Follow for part 2"). Never "thanks for watching".
- Long form: pay off the cold open, one-line takeaway, one CTA, done.

## Staying monetizable

YouTube's inauthentic-content rule targets mass-produced, template-identical
videos, not faceless or AI-voiced ones as such. Vary edit styles, looks and
structure between videos; write real scripts with a point of view; prefer the
creator's own voice (`provider: "file"`) for channels they want to monetize.
Disclose realistic synthetic media where YouTube requires it.
