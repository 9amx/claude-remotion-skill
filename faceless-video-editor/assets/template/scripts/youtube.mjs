// Upload out/final.mp4 (+ out/thumbnail.jpg) to YouTube with the YouTube Data API v3.
// No dependencies: OAuth (desktop app + PKCE, or the device flow) and a resumable upload over fetch.
// Usage:
//   node scripts/youtube.mjs --auth            one-time sign-in (opens a browser)
//   node scripts/youtube.mjs --auth --device   sign in from a phone: prints a code to enter at
//                                              google.com/device (cloud sessions, no browser here)
//   node scripts/youtube.mjs --dry-run         show the title/description/settings, upload nothing
//   node scripts/youtube.mjs                   upload (resumes an interrupted upload)
//   --account=<name>   separate sign-in per channel (default: youtube.account or "default")
//   --force            upload again although build/youtube.json says it is already up
//   --no-thumbnail     skip out/thumbnail.jpg
// Setup (client_secret.json from Google Cloud) and limits: references/youtube-upload.md.
// Env: YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET (the OAuth client's values, e.g. from a cloud
//      environment's settings), or YOUTUBE_CLIENT_SECRET_FILE=/path/client_secret.json;
//      YOUTUBE_CONFIG_DIR (token location)
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { BUILD, ROOT, fail, log, readJson, readProject, sleep, writeJson } from "./lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEVICE_URL = "https://oauth2.googleapis.com/device/code";
// upload: videos + thumbnails. readonly: show which channel you are signed in to.
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
// The device flow only allows the broader "manage your YouTube account" scope.
const DEVICE_SCOPES = ["https://www.googleapis.com/auth/youtube"];

const project = readProject();
const yt = project.youtube ?? {};
const account = (opt("account") ?? yt.account ?? "default").replace(/[^\w.-]/g, "_");
const CONFIG = process.env.YOUTUBE_CONFIG_DIR
  || (process.platform === "win32" ? path.join(process.env.APPDATA || os.homedir(), "faceless-video") : path.join(os.homedir(), ".config", "faceless-video"));
const tokenFile = path.join(CONFIG, `youtube-token-${account}.json`);
const stateFile = path.join(BUILD, "youtube.json");

// ---------- OAuth ----------
function clientSecret() {
  if (process.env.YOUTUBE_CLIENT_ID) {
    if (!process.env.YOUTUBE_CLIENT_SECRET) fail("YOUTUBE_CLIENT_ID is set but YOUTUBE_CLIENT_SECRET is not - add both to the environment.");
    return { client_id: process.env.YOUTUBE_CLIENT_ID.trim(), client_secret: process.env.YOUTUBE_CLIENT_SECRET.trim() };
  }
  const candidates = [process.env.YOUTUBE_CLIENT_SECRET_FILE, path.join(ROOT, "client_secret.json"), path.join(CONFIG, "client_secret.json")].filter(Boolean);
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) fail(`No OAuth client. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET, or save the client's JSON as ${path.join(CONFIG, "client_secret.json")} (references/youtube-upload.md)`);
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  const client = json.installed ?? Object.values(json).find((v) => v?.client_id);
  if (!client?.client_id) fail(`${file} is not an OAuth client JSON. Download it from Google Cloud -> Credentials.`);
  return client;
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function openBrowser(url) {
  const [cmd, cmdArgs] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {}
}

async function tokenRequest(params) {
  const r = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (json.error === "invalid_grant") fail(`YouTube sign-in expired or was revoked (apps in "Testing" mode expire after 7 days). Run: node scripts/youtube.mjs --auth${account !== "default" ? ` --account=${account}` : ""}`);
    fail(`Google token request failed: ${json.error_description || json.error || r.status}`);
  }
  return json;
}

async function signIn() {
  const client = clientSecret();
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(12));
  const server = http.createServer();
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "),
    code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256",
    access_type: "offline", prompt: "consent", state,
  });
  log("youtube", "sign in with the Google account that owns the channel (pick the channel / brand account if asked):");
  console.log(`\n  ${url}\n`);
  openBrowser(url);

  // The browser lands on our local server. If the browser runs on another machine,
  // the user pastes the address it ended on (http://127.0.0.1:...?code=...).
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const fromQuery = (q) => {
    if (q.get("state") !== state) throw new Error("state mismatch - start --auth again");
    if (q.get("error")) throw new Error(`Google said: ${q.get("error")}`);
    return q.get("code");
  };
  const code = await new Promise((resolve, reject) => {
    server.on("request", (req, res) => {
      const q = new URL(req.url, redirect).searchParams;
      if (!q.get("code") && !q.get("error")) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<h2>Signed in. You can close this tab.</h2>");
      try { resolve(fromQuery(q)); } catch (e) { reject(e); }
    });
    rl.question("Waiting for the browser... (or paste the address it ended on and press Enter)\n> ", (line) => {
      try { line.trim() && resolve(fromQuery(new URL(line.trim()).searchParams)); } catch (e) { reject(e); }
    });
  }).catch((e) => fail(e.message)).finally(() => { rl.close(); server.close(); });

  const tok = await tokenRequest({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirect,
    grant_type: "authorization_code", code_verifier: verifier });
  if (!tok.refresh_token) fail("Google returned no refresh token. Remove the app's access at myaccount.google.com/permissions and run --auth again.");
  fs.mkdirSync(CONFIG, { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify({ refresh_token: tok.refresh_token, client_id: client.client_id, scope: tok.scope, created: new Date().toISOString() }, null, 2), { mode: 0o600 });
  log("youtube", `signed in, token saved to ${tokenFile}`);
  return tok.access_token;
}

// Device flow: for a phone or a cloud session, where no browser can reach this
// machine. Needs an OAuth client of type "TVs and Limited Input devices".
async function signInDevice() {
  const client = clientSecret();
  const r = await fetch(DEVICE_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.client_id, scope: DEVICE_SCOPES.join(" ") }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    fail(/not found|deleted/i.test(d.error_description ?? "") ? "Google doesn't know this OAuth client: check YOUTUBE_CLIENT_ID (copy the whole Client ID)."
      : d.error === "invalid_client" || d.error === "unauthorized_client"
      ? 'This OAuth client can\'t use the device flow: create one of type "TVs and Limited Input devices" (references/youtube-upload.md).'
      : `Google refused the device sign-in: ${d.error_description || d.error || r.status}`);
  }
  log("youtube", `on your phone open ${d.verification_url} and enter the code:  ${d.user_code}`);
  log("youtube", "then pick the Google account and the channel, and allow access. Waiting...");
  let interval = (d.interval ?? 5) * 1000;
  const until = Date.now() + (d.expires_in ?? 1800) * 1000;
  while (Date.now() < until) {
    await sleep(interval);
    const t = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, device_code: d.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) });
    const tok = await t.json().catch(() => ({}));
    if (t.ok && tok.access_token) {
      if (!tok.refresh_token) fail("Google returned no refresh token. Run --auth --device again.");
      fs.mkdirSync(CONFIG, { recursive: true });
      fs.writeFileSync(tokenFile, JSON.stringify({ refresh_token: tok.refresh_token, client_id: client.client_id, scope: tok.scope, created: new Date().toISOString() }, null, 2), { mode: 0o600 });
      log("youtube", `signed in, token saved to ${tokenFile}`);
      return tok.access_token;
    }
    if (tok.error === "authorization_pending") continue;
    if (tok.error === "slow_down") interval += 5000;
    else if (tok.error === "access_denied") fail("Access was denied on the phone. Run --auth --device again and press Allow.");
    else if (tok.error === "expired_token") break;
    else fail(`device sign-in failed: ${tok.error_description || tok.error || t.status}`);
  }
  fail("The code expired before it was entered. Run --auth --device again.");
}

async function accessToken() {
  const saved = readJson(tokenFile, null);
  if (!saved) fail(`Not signed in to YouTube${account !== "default" ? ` (account "${account}")` : ""}. Run: node scripts/youtube.mjs --auth${account !== "default" ? ` --account=${account}` : ""} (add --device on a phone / in a cloud session)`);
  const client = clientSecret();
  const tok = await tokenRequest({ refresh_token: saved.refresh_token, client_id: client.client_id, client_secret: client.client_secret, grant_type: "refresh_token" });
  return tok.access_token;
}

async function api(token, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (r.ok || r.status === 308) return r;
  const body = await r.json().catch(() => ({}));
  const reason = body.error?.errors?.[0]?.reason || body.error?.status || r.status;
  const hints = {
    quotaExceeded: "daily API quota used up (10,000 units by default, about 1,600 per upload); try again after midnight Pacific time",
    uploadLimitExceeded: "the channel hit YouTube's daily upload limit; try again tomorrow",
    youtubeSignupRequired: "this Google account has no YouTube channel yet - create one, then run --auth again",
    forbidden: "the signed-in account can't upload to this channel",
    invalidTitle: "title rejected (empty, over 100 characters, or contains < >)",
    invalidDescription: "description rejected (over 5000 bytes, or contains < >)",
    invalidTags: "tags rejected (over 500 characters in total)",
    invalidPublishAt: "publishAt must be in the future and needs privacy \"private\"",
  };
  const err = new Error(`YouTube API ${r.status} ${reason}: ${hints[reason] || body.error?.message || ""}`);
  err.status = r.status;
  err.reason = reason;
  throw err;
}

async function channelName(token) {
  const r = await api(token, `${API}/channels?part=snippet&mine=true`);
  const ch = (await r.json()).items?.[0];
  return ch ? `${ch.snippet.title} (youtube.com/channel/${ch.id})` : null;
}

// ---------- metadata ----------
function buildMetadata() {
  const read = (f) => (fs.existsSync(path.join(BUILD, f)) ? fs.readFileSync(path.join(BUILD, f), "utf8").trim() : "");
  const chapters = yt.chapters === false ? "" : read("youtube-chapters.txt");
  const credits = yt.credits === false ? "" : read("credits.txt");
  const hashtags = (yt.hashtags ?? []).map((h) => `#${String(h).replace(/^#/, "").replace(/\s+/g, "")}`).join(" ");
  const description = [yt.description ?? "", chapters, credits && `Credits:\n${credits}`, hashtags].filter(Boolean).join("\n\n");
  // Language from youtube.language, else the voice name ("bn-BD-NabanitaNeural" -> "bn").
  const language = yt.language ?? (/^([a-z]{2,3})-[A-Z]{2}-/.exec(project.voice.voice || "")?.[1] || project.voice.language);
  const privacy = yt.privacy ?? "private";
  const ai = /^AI-generated/m.test(credits);
  const meta = {
    snippet: {
      title: yt.title ?? project.title,
      description,
      tags: yt.tags ?? [],
      categoryId: String(yt.categoryId ?? 22),
      ...(language ? { defaultLanguage: language, defaultAudioLanguage: language } : {}),
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: yt.madeForKids ?? false,
      // Realistic AI imagery must be disclosed; ai: B-roll turns it on unless set.
      containsSyntheticMedia: yt.syntheticMedia ?? ai,
      ...(yt.publishAt ? { publishAt: new Date(yt.publishAt).toISOString() } : {}),
      ...(yt.license ? { license: yt.license } : {}),
    },
  };

  const errors = [];
  const s = meta.snippet;
  if (!s.title) errors.push('no title: set "youtube.title" (or "title") in project.json');
  if (s.title?.length > 100) errors.push(`title is ${s.title.length} characters (max 100; under 60 shows in full)`);
  if (/[<>]/.test(s.title + s.description)) errors.push("title/description can't contain < or >");
  if (Buffer.byteLength(s.description) > 5000) errors.push(`description is ${Buffer.byteLength(s.description)} bytes (max 5000)`);
  const tagChars = s.tags.reduce((n, t) => n + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, s.tags.length - 1);
  if (tagChars > 500) errors.push(`tags are ${tagChars} characters together (max 500)`);
  if (!["private", "unlisted", "public"].includes(privacy)) errors.push(`privacy must be private, unlisted or public, not "${privacy}"`);
  if (yt.publishAt) {
    const at = new Date(yt.publishAt);
    if (Number.isNaN(at.getTime())) errors.push(`publishAt "${yt.publishAt}" is not a date (use e.g. 2026-11-02T15:00:00+06:00)`);
    else if (at <= new Date()) errors.push(`publishAt ${at.toISOString()} is in the past`);
    if (privacy !== "private") errors.push('publishAt needs "privacy": "private" (YouTube makes it public at that time)');
  }
  return { meta, errors, notify: yt.notifySubscribers ?? true };
}

// ---------- resumable upload ----------
async function startSession(token, meta, size, notify) {
  const r = await api(token, `${UPLOAD}/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${notify}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": String(size), "X-Upload-Content-Type": "video/mp4" },
    body: JSON.stringify(meta),
  });
  return r.headers.get("location");
}

// Where the server is: { done: video } | { offset } | { expired: true }
async function uploadStatus(token, session, size) {
  try {
    const r = await api(token, session, { method: "PUT", headers: { "Content-Range": `bytes */${size}` } });
    if (r.status === 308) {
      const range = r.headers.get("range");
      return { offset: range ? Number(range.split("-")[1]) + 1 : 0 };
    }
    return { done: await r.json() };
  } catch (e) {
    if (e.status === 404 || e.status === 410) return { expired: true };
    throw e;
  }
}

async function sendFrom(token, session, file, offset, size) {
  let sent = offset, shown = -1;
  async function* body() {
    for await (const chunk of fs.createReadStream(file, { start: offset })) {
      sent += chunk.length;
      const pct = Math.floor((sent / size) * 20) * 5;
      if (pct !== shown) {
        shown = pct;
        process.stdout.write(`\r\x1b[36m[youtube]\x1b[0m uploading ${pct}% (${(sent / 1e6).toFixed(0)} / ${(size / 1e6).toFixed(0)} MB)`);
      }
      yield chunk;
    }
  }
  try {
    const r = await api(token, session, {
      method: "PUT", duplex: "half", body: body(),
      headers: { "Content-Type": "video/mp4", "Content-Length": String(size - offset), "Content-Range": `bytes ${offset}-${size - 1}/${size}` },
    });
    return r.status === 308 ? null : await r.json();
  } finally {
    process.stdout.write("\n");
  }
}

async function upload(token, file, meta, notify) {
  const stat = fs.statSync(file);
  const size = stat.size;
  const id = `${path.resolve(file)}:${size}:${stat.mtimeMs}`;
  let state = readJson(stateFile, {});
  // An interrupted upload of this exact file resumes (sessions live about a week).
  let session = state.session?.id === id && Date.now() - state.session.started < 6 * 864e5 ? state.session.url : null;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      let offset = 0;
      if (session) {
        const st = await uploadStatus(token, session, size);
        if (st.done) return st.done;
        if (st.expired) session = null;
        else offset = st.offset;
        if (offset) log("youtube", `resuming at ${((offset / size) * 100).toFixed(0)}%`);
      }
      if (!session) {
        session = await startSession(token, meta, size, notify);
        state = { ...state, session: { id, url: session, started: Date.now() } };
        writeJson(stateFile, state);
      }
      const video = await sendFrom(token, session, file, offset, size);
      if (video) return video;
    } catch (e) {
      // Access tokens last an hour; a long upload outlives one.
      if (e.status === 401) {
        token = await accessToken();
        continue;
      }
      // Other 4xx are real errors: retrying won't help.
      if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) throw e;
      const wait = Math.min(60, 2 ** attempt) * 1000;
      log("youtube", `${e.message || e} - retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error("upload kept failing; run the same command again to resume");
}

// ---------- main ----------
if (flag("auth")) {
  const token = flag("device") ? await signInDevice() : await signIn();
  const name = await channelName(token).catch(() => null);
  log("youtube", name ? `channel: ${name}` : "this account has no YouTube channel yet - create one before uploading");
  process.exit(0);
}

const video = path.resolve(ROOT, opt("video") ?? "out/final.mp4");
const thumb = path.join(ROOT, "out", "thumbnail.jpg");
const useThumb = !flag("no-thumbnail") && fs.existsSync(thumb);
const { meta, errors, notify } = buildMetadata();

if (flag("dry-run")) {
  console.log(JSON.stringify(meta, null, 2));
  log("youtube", `video: ${fs.existsSync(video) ? `${path.relative(ROOT, video)} (${(fs.statSync(video).size / 1e6).toFixed(1)} MB)` : `${path.relative(ROOT, video)} MISSING`}`);
  log("youtube", `thumbnail: ${useThumb ? "out/thumbnail.jpg" : "none (YouTube picks a frame)"}`);
  log("youtube", `account: ${account}${fs.existsSync(tokenFile) ? "" : " (not signed in yet: --auth)"}`);
  for (const e of errors) console.error(`\x1b[31m[error]\x1b[0m ${e}`);
  process.exit(errors.length ? 1 : 0);
}

if (errors.length) fail(errors.join("\n        "));
if (!fs.existsSync(video)) fail(`${path.relative(ROOT, video)} not found - render first (npm run auto).`);
const done = readJson(stateFile, {});
if (done.videoId && !flag("force")) fail(`already uploaded: ${done.url} (${done.uploadedAt}). Use --force to upload again.`);

const token = await accessToken();
const name = await channelName(token).catch(() => null);
log("youtube", `uploading "${meta.snippet.title}" to ${name ?? "your channel"} as ${meta.status.privacyStatus}${meta.status.publishAt ? `, goes public ${meta.status.publishAt}` : ""}`);

let result;
try {
  result = await upload(token, video, meta, notify);
} catch (e) {
  fail(e.message);
}
const url = `https://youtu.be/${result.id}`;
writeJson(stateFile, { videoId: result.id, url, title: meta.snippet.title, privacy: meta.status.privacyStatus,
  publishAt: meta.status.publishAt ?? null, uploadedAt: new Date().toISOString(), account });
log("youtube", `uploaded: ${url}  (YouTube is processing it now)`);

if (useThumb) {
  try {
    await api(token, `${UPLOAD}/thumbnails/set?videoId=${result.id}&uploadType=media`, {
      method: "POST", headers: { "Content-Type": "image/jpeg" }, body: fs.readFileSync(thumb),
    });
    log("youtube", "thumbnail set");
  } catch (e) {
    log("youtube", e.status === 403
      ? "thumbnail not set: custom thumbnails need a verified channel (youtube.com/verify), then upload out/thumbnail.jpg in Studio"
      : `thumbnail not set: ${e.message}`);
  }
}
if (meta.status.privacyStatus !== "private" || meta.status.publishAt) {
  log("youtube", 'if Studio shows the video as "Locked (private)", the Google Cloud project still needs YouTube\'s API audit - see references/youtube-upload.md');
}
