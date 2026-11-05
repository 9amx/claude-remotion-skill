// The owner's comments from the Studio, each on a frame of the video. Read these
// before changing the edit, and answer them here so the owner sees it on the page.
//   node scripts/comments.mjs                          open comments
//   node scripts/comments.mjs --all                    also the resolved ones
//   node scripts/comments.mjs --reply=<id> "text"      answer one, as Claude
//   node scripts/comments.mjs --resolve=<id> ["text"]  mark it done, with an optional answer
import fs from "node:fs";
import path from "node:path";
import { BUILD, fail, readJson } from "./lib.mjs";

const file = path.join(BUILD, "comments.json");
const comments = readJson(file, { comments: [] }).comments ?? [];
const args = process.argv.slice(2);
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const words = args.filter((a) => !a.startsWith("--")).join(" ").trim();
const replyTo = option("reply"), resolveId = option("resolve");

if (replyTo || resolveId) {
  const id = replyTo ?? resolveId;
  const comment = comments.find((c) => c.id === id);
  if (!comment) fail(`no comment ${id}`);
  if (replyTo && !words) fail("--reply needs the answer as text");
  if (words) comment.replies.push({ author: "Claude", text: words, created: new Date().toISOString() });
  if (resolveId) comment.resolved = true;
  fs.writeFileSync(file, JSON.stringify({ comments }, null, 2));
  console.log(`${id}: ${resolveId ? "resolved" : "answered"}`);
  process.exit(0);
}

const list = comments.filter((c) => args.includes("--all") || !c.resolved).sort((a, b) => a.frame - b.frame);
const open = comments.filter((c) => !c.resolved).length;
console.log(`${open} open comment(s), ${comments.length - open} resolved`);
for (const c of list) {
  console.log(`\n[${c.id}] ${c.time} (frame ${c.frame})${c.resolved ? " RESOLVED" : ""}${c.drawing ? " + drawing on the frame" : ""}`);
  console.log(`  ${c.text}`);
  if (c.shot) console.log(`  shot ${c.shot}${c.shotNumber ? ` (#${c.shotNumber})` : ""}: ${c.media || "graphic"}`);
  if (c.words) console.log(`  voice here: "${c.words}"`);
  if (c.watching) console.log(`  watching: ${c.watching}`);
  for (const r of c.replies ?? []) console.log(`  ${r.author}: ${r.text}`);
}
