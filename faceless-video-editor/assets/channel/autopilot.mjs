// Channel autopilot bookkeeping: what to make next and when it goes live.
// Runs in the channel workspace (a private repo: channel.json, queue/, research/, uploads.json).
//   node autopilot.mjs next              -> JSON { slot, job }: the next free publish slot and what to make for it
//   node autopilot.mjs done <job-id> <videoId> <slot> [--title "..."] [--based-on <videoId>]
//                                        -> records the upload in uploads.json, archives the queue item
//   node autopilot.mjs status            -> the next slots, the queue, the last uploads
// Jobs come from queue/ first (your topics, your scripts, your recordings), then from
// the target channel's research (its best topics you haven't covered yet).
import fs from "node:fs";
import path from "node:path";

const [cmd, ...args] = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : d);
const fail = (m) => {
  console.error(`\x1b[31m[error]\x1b[0m ${m}`);
  process.exit(1);
};

const channel = readJson("channel.json", null);
if (!channel) fail("No channel.json here - copy channel.example.json and fill it in.");
const sched = channel.schedule ?? {};
const tz = sched.timezone ?? "UTC";
const uploads = readJson("uploads.json", []);

// ---------- time slots in the channel's time zone ----------
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const partsIn = (date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: p.weekday.toLowerCase().slice(0, 3) };
};
// Local wall time in tz -> the real instant (corrects for the zone's offset, DST included).
function zoned(y, m, d, h, mi) {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(t));
    t += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  }
  return new Date(t);
}
function slots(count) {
  const times = (sched.times ?? ["18:00"]).map((s) => s.split(":").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const days = sched.days?.map((d) => d.toLowerCase().slice(0, 3)) ?? DAYS;
  const earliest = Date.now() + (sched.minLeadMinutes ?? 45) * 60_000;
  const taken = new Set(uploads.map((u) => new Date(u.slot).toISOString()));
  const today = partsIn(new Date());
  const out = [];
  for (let k = 0; k < 60 && out.length < count; k++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + k, 12));
    const { y, m, d } = { y: day.getUTCFullYear(), m: day.getUTCMonth() + 1, d: day.getUTCDate() };
    if (!days.includes(DAYS[day.getUTCDay()])) continue;
    for (const [h, mi] of times) {
      const at = zoned(y, m, d, h, mi);
      if (at.getTime() >= earliest && !taken.has(at.toISOString())) out.push(at);
      if (out.length >= count) break;
    }
  }
  return out;
}
const local = (date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(date) + ` (${tz})`;

// ---------- jobs ----------
const QUEUE = "queue";
const queued = () => (fs.existsSync(QUEUE) ? fs.readdirSync(QUEUE).filter((f) => f.endsWith(".json")).sort() : []);
function nextJob() {
  const first = queued()[0];
  if (first) return { id: path.basename(first, ".json"), source: "queue", file: path.join(QUEUE, first), ...readJson(path.join(QUEUE, first), {}) };
  // Research: the target's best topics not covered yet.
  const used = new Set(uploads.map((u) => u.basedOn).filter(Boolean));
  const targets = [].concat(channel.target ?? []);
  for (const t of targets) {
    const f = path.join("research", `${String(t).replace(/^@/, "").replace(/[^\w.-]/g, "_")}.json`);
    const r = readJson(f, null);
    if (!r) continue;
    const pool = r.videos.filter((v) => !used.has(v.id) && (channel.format === "landscape" ? !v.short : channel.format === "shorts" ? v.short || v.seconds <= 180 : true));
    const pick = pool.sort((a, b) => b.views - a.views)[0];
    if (pick) return { id: `topic-${pick.id}`, source: "research", type: "topic", topic: pick.title, basedOn: pick.id, inspiration: pick.url, views: pick.views, seconds: pick.seconds };
  }
  return null;
}

if (cmd === "next") {
  const [slot] = slots(1);
  const job = nextJob();
  console.log(JSON.stringify({ slot: slot?.toISOString() ?? null, slotLocal: slot ? local(slot) : null, job,
    ...(job ? {} : { hint: "queue/ is empty and research has no unused topics: run channel-research.mjs or add to queue/" }) }, null, 2));
} else if (cmd === "done") {
  const title = opt("title"), basedOn = opt("based-on");
  const [jobId, videoId, slot] = args;
  if (!jobId || !videoId || !slot) fail('usage: node autopilot.mjs done <job-id> <videoId> <slot> [--title "..."] [--based-on <videoId>]');
  uploads.push({ jobId, videoId, url: `https://youtu.be/${videoId}`, slot: new Date(slot).toISOString(), title: title ?? null, basedOn: basedOn ?? null, at: new Date().toISOString() });
  fs.writeFileSync("uploads.json", JSON.stringify(uploads, null, 2) + "\n");
  const q = path.join(QUEUE, `${jobId}.json`);
  if (fs.existsSync(q)) {
    fs.mkdirSync(path.join(QUEUE, "done"), { recursive: true });
    fs.renameSync(q, path.join(QUEUE, "done", `${jobId}.json`));
  }
  console.log(`recorded ${videoId} for ${local(new Date(slot))}`);
} else if (cmd === "status") {
  console.log(`channel: ${channel.name ?? "?"}  target: ${[].concat(channel.target ?? []).join(", ") || "-"}  format: ${channel.format ?? "shorts"}`);
  console.log(`next slots: ${slots(3).map(local).join(" | ")}`);
  console.log(`queue: ${queued().join(", ") || "(empty)"}`);
  for (const u of uploads.slice(-5)) console.log(`  ${local(new Date(u.slot))}  ${u.url}  ${u.title ?? ""}`);
} else {
  fail("usage: node autopilot.mjs next | done <job-id> <videoId> <slot> | status");
}
