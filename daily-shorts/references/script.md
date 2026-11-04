# Script: 40-55 seconds that hold to the end

## Shape
1. **Hook (first 1-2 seconds, one line):** the most surprising true fact, a question, or the
   moment it went wrong. No "In this video". No greeting. Examples of form:
   - "At 11:42 p.m., Flight 2210 vanished from radar over the Gulf."
   - "This storm grew from a breeze to a Category 4 in 24 hours."
2. **Context (5-10 s):** where, when, who - only what is needed to follow.
3. **The turn (15-25 s):** what happened, in order, with the one or two details that make it vivid
   (an exact time, an altitude, a radio call quoted from the official transcript).
4. **What we know / what changes (8-12 s):** the investigators' findings or the open question.
5. **Payoff (last line):** the takeaway or the unanswered question that makes people comment.
   It should loop well into the hook if possible.

## Retention techniques
- Open on the turn, not the setup ("The tower called twice. No answer." beats "On Sunday a plane took off").
- An open loop by second 5: a question the video promises to answer ("So why did nobody see it?").
- Specifics over adjectives: "1,200 feet in 9 seconds" beats "a terrifying drop".
- Pattern breaks: a short line after long ones, a pause tag before the key fact.
- The last line returns to the first image or question so the replay feels natural.

## Writing rules
- 110-140 words. Short sentences. One fact per sentence. Spoken English, not written.
- Exact names, flight numbers, aircraft types, places, dates - matching `build/facts.json`.
- Numbers as they should be read ("two thousand feet" only if the voice misreads "2,000 ft").
- No speculation, no blame, no gore, no "shocking" adjectives in place of facts.
- Respect: mention people as people ("the two pilots", "a family of four"), never as spectacle.
- Mark the words to highlight with `*asterisks*` (faceless-video-editor caption markup).

## ElevenLabs v3 audio tags (delivery)
Put a tag in square brackets before the words it should colour. Use few, at real turning points;
a tag on every line sounds fake.
- Tension: `[tense]`, `[serious]`, `[urgent]`
- Quiet moments: `[whispers]`, `[softly]`, `[slowly]`
- Breath and pauses: `[short pause]`, `[long pause]`, `[exhales]`
- Never comedic tags for tragedies (`[laughs]` etc.).
Example: `[serious] At 3:12 a.m., the tower lost contact. [short pause] [softly] No mayday was ever sent.`
Tags never appear in captions and do not count as words.

## Self-review checklist (rewrite until all are yes)
- Would someone keep watching after the first line?
- Is every claim in `build/facts.json` with two sources?
- Is there anything a family member of a victim would find disrespectful?
- Does it fit in 55 seconds at a natural pace (about 2.5 words per second)?
- Does the last line pay off the hook?
