# queue/

The autopilot makes the oldest file here first (sorted by name), before any
topic from the target channel's research. One JSON file per video:

- Your topic: `{ "type": "topic", "topic": "Why the Sundarbans has tigers that swim", "notes": "angle, facts to include" }`
- Your script (your words are kept as written): `{ "type": "script", "title": "...", "script": "full text ..." }`
- Your recording: `{ "type": "voice", "voice": "queue/files/2026-11-02.mp3", "script": "what you say (optional, helps the scene split)" }`

Name files so they sort in the order you want them out, e.g. `2026-11-02-sundarbans.json`.
Made videos move to `queue/done/`. Easiest from a phone: tell Claude in chat
("add this to the queue: ...") and it commits the file.
