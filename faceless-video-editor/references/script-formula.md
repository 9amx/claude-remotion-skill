# Script Formula - writing faceless scripts people finish

The voice and visuals are automated. Retention is decided here.

## Word budgets (edge-tts at rate +8%, ~2.5 words/sec)

| Target | Words | Scenes (Shorts) |
|---|---|---|
| 20s | 50 | 4-5 |
| 30s | 75 | 5-7 |
| 45s | 110 | 7-9 |
| 60s | 150 | 9-12 |
| 5 min (landscape) | 750 | 35-50 |

Count words before running. If over, cut sentences - don't raise the rate past +15%.

## Structure (Shorts)

1. **Hook (0-2s)** - one sentence, with `emphasis`. Must create a question the
   viewer needs answered.
2. **Context (2-8s)** - why this matters to *them*. One concrete detail.
3. **Body (8s-end-5s)** - 3-5 beats, each one scene. Each beat adds a new fact,
   twist or step. Open a small loop every ~8s ("but that's not the strange part").
4. **Payoff** - the answer the hook promised. Pay it off; unpaid hooks kill reach.
5. **End (last 3s)** - loop line that flows back into the first sentence, or a CTA
   ("Follow for part 2"). Never "thanks for watching".

## Hook patterns that work

More archetypes, the first-frame rules and the hook checklist are in
`editing-playbook.md`; `scripts/lint-script.mjs` enforces the basics.

- **Stakes**: "This one habit is quietly costing you two hours a day."
- **Contradiction**: "The safest seat on a plane isn't where you think."
- **Specific number**: "In 1983 one man stopped a nuclear war by doing nothing."
- **Direct address**: "If you sleep with your phone next to you, stop."
- **Mid-action**: "The diver had 4 minutes of air left when the cave collapsed."

Banned openers: "Did you know", "In this video", "Hey guys", "Have you ever
wondered", "Today we're going to", any greeting.

## Highlights

Wrap the one or two words that carry each scene in asterisks: the number, the
twist, the "never". `It costs *$4,000* a year.` They get the accent caption
color, a punch-in zoom (viral/explainer) and a tick. Numbers are highlighted
automatically, so mark words, not every digit.

## Line-level rules

- Write for the ear: short sentences, contractions, one clause per sentence.
- Concrete over abstract: "a $4 coffee every morning" beats "small expenses".
- Numbers as digits in the script ("1983", "$4") - captions show them as digits
  and the TTS reads them fine.
- No parentheses, slashes, emoji, or abbreviations the voice will mangle (e.g.
  write "for example", not "e.g.").
- Every scene must be showable with stock footage. If you can't picture a clip
  for it, rewrite the line or mark it `"visual": "kinetic"` with an `emphasis`.

## Niche templates

**Facts / "things you didn't know"**: hook = the most surprising fact, stated as a
claim. Body = 3 facts, escalating. End = "and the last one is the reason..." loop.

**Story / history / true crime** (`documentary` style, `calm` or `tense`): open
mid-action, rewind with "Twelve hours earlier...", reveal in the last 20%.

**Listicle / tips** (`bold`, `upbeat`): "3 X that Y". Each item one scene with
`emphasis` = the item number + 1-2 words ("#2 NO PHONE").

**Motivation** (`documentary`, `calm`): one story or quote, one lesson, one
instruction. Slower rate (+0%).

**Finance / tech explainer** (`minimal`): problem -> mechanism -> what to do. Put
the key number in `emphasis`.

**Reddit / text stories**: keep the poster's voice, trim to the conflict, end on
the update or the verdict question ("Was she wrong?"). B-roll: moody generic
(rain window, city night, hands phone) - never literal.

## Other languages

Write natively in the target language - don't translate an English script line
by line. Same structure and budgets apply (Bengali and Hindi run ~10% fewer
words per second; budget 2.2 words/sec). B-roll keywords stay in English: stock
sites search best in English.
