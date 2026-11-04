// Shared helpers for the daily-shorts scripts. Node 18+, no dependencies.
// The scripts run inside today's project folder (a faceless-video-editor project);
// history.json and music/ live one level up.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Behind an HTTPS proxy Node's fetch needs NODE_USE_ENV_PROXY at startup: re-run once with it.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --disable-warning=UNDICI-EHPA`.trim();
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_OPTIONS } });
  process.exit(r.status ?? 1);
}

export const ROOT = process.cwd();
export const BUILD = path.join(ROOT, "build");
export const DAILY_ROOT = process.env.DAILY_ROOT || path.dirname(ROOT);
export const HISTORY = path.join(DAILY_ROOT, "history.json");
export const args = process.argv.slice(2);
export const flag = (n) => args.includes(`--${n}`);
export const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

export const log = (step, msg) => console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
export const fail = (msg) => { console.error(`\x1b[31m[error]\x1b[0m ${msg}`); process.exit(1); };
export const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };
export const writeJson = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The project, with scenes flattened (Shorts have no chapters, but stay safe).
export function readProject() {
  const p = readJson(path.join(ROOT, "project.json"), null);
  if (!p) fail("No project.json in this folder.");
  p.scenes = p.scenes || (p.chapters || []).flatMap((c) => c.scenes || []);
  return p;
}

export const AUDIO_TAG = /\[[a-z][a-z' -]{0,38}\]\s*/gi;
export const cleanText = (t) => String(t ?? "").replace(AUDIO_TAG, "").replace(/\*/g, "").replace(/\s{2,}/g, " ").trim();

// Spoken words, for comparing what was said with what was written.
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export function words(text) {
  return cleanText(text).toLowerCase()
    .replace(/(\d),(\d{3})/g, "$1$2") // 2,000 -> 2000
    .replace(/[–—-]/g, " ")
    .replace(/[^\p{L}\p{N}\s.%:']/gu, " ")
    .split(/\s+/).map((w) => w.replace(/^[.']+|[.':]+$/g, "")).filter(Boolean)
    .map((w) => (ONES.includes(w) ? String(ONES.indexOf(w)) : TENS[w] != null ? String(TENS[w]) : w));
}

// ---------- web ----------
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36", "Accept-Language": "en-US,en;q=0.9" };
export async function fetchText(url, timeoutMs = 20000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, redirect: "follow", signal: ctl.signal });
    const type = r.headers.get("content-type") || "";
    const body = /pdf/i.test(type) ? "" : await r.text();
    return { status: r.status, ok: r.ok, type, text: body };
  } catch (e) {
    return { status: 0, ok: false, error: e.name === "AbortError" ? "timeout" : e.cause?.code || e.message, text: "" };
  } finally {
    clearTimeout(timer);
  }
}
export const htmlToText = (html) => html
  .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;|&#34;|&ldquo;|&rdquo;/g, '"').replace(/&#39;|&rsquo;|&lsquo;|&apos;/g, "'")
  .replace(/&mdash;|&ndash;/g, "-").replace(/&#\d+;|&\w+;/g, " ");
export const squash = (s) => String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Registrable domain, roughly: news.example.co.uk -> example.co.uk
export function siteOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const parts = host.split(".");
    const twoLevel = /^(co|com|gov|ac|org|net)\.[a-z]{2}$/.test(parts.slice(-2).join("."));
    return parts.slice(twoLevel ? -3 : -2).join(".");
  } catch { return null; }
}
// Official sources: government, military, investigators, intergovernmental agencies.
const OFFICIAL_SITES = ["ntsb.gov", "faa.gov", "noaa.gov", "weather.gov", "usgs.gov", "fema.gov", "nasa.gov", "bea.aero", "bfu-web.de",
  "easa.europa.eu", "europa.eu", "aaib.gov.uk", "tsb.gc.ca", "atsb.gov.au", "taic.org.nz", "icao.int", "who.int", "un.org", "reliefweb.int"];
export function isOfficial(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return /\.(gov|mil)$/.test(host) || /\.gov\.[a-z]{2}$/.test(host) || /\.gc\.ca$/.test(host) || /\.europa\.eu$/.test(host) || OFFICIAL_SITES.some((s) => host === s || host.endsWith(`.${s}`));
  } catch { return false; }
}

// ---------- YouTube (same sign-in as faceless-video-editor's scripts/youtube.mjs) ----------
const CONFIG = process.env.YOUTUBE_CONFIG_DIR
  || (process.platform === "win32" ? path.join(process.env.APPDATA || os.homedir(), "faceless-video") : path.join(os.homedir(), ".config", "faceless-video"));
function clientSecret() {
  if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) return { client_id: process.env.YOUTUBE_CLIENT_ID.trim(), client_secret: process.env.YOUTUBE_CLIENT_SECRET.trim() };
  for (const f of [process.env.YOUTUBE_CLIENT_SECRET_FILE, path.join(CONFIG, "client_secret.json")].filter(Boolean)) {
    const j = readJson(f, null);
    const c = j && (j.installed ?? Object.values(j).find((v) => v?.client_id));
    if (c?.client_id) return c;
  }
  return null;
}
let cachedToken = null;
// Returns { key } (YOUTUBE_API_KEY, read-only public data) or { bearer } (the channel sign-in), or null.
export async function youtubeAuth(account = process.env.YOUTUBE_ACCOUNT || "default") {
  if (cachedToken) return cachedToken;
  const tokenFile = path.join(CONFIG, `youtube-token-${account.replace(/[^\w.-]/g, "_")}.json`);
  const tok = readJson(tokenFile, null), client = clientSecret();
  if (tok?.refresh_token && client) {
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: tok.refresh_token, grant_type: "refresh_token" }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) return (cachedToken = { bearer: j.access_token });
  }
  if (process.env.YOUTUBE_API_KEY) return (cachedToken = { key: process.env.YOUTUBE_API_KEY.trim() });
  return null;
}
export async function ytGet(endpoint, params) {
  const auth = await youtubeAuth();
  if (!auth) throw new Error("no YouTube sign-in (node scripts/youtube.mjs --auth) and no YOUTUBE_API_KEY");
  const q = new URLSearchParams({ ...params, ...(auth.key ? { key: auth.key } : {}) });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${q}`, { headers: auth.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {} });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`YouTube ${endpoint}: ${j.error?.message || r.status}`);
  return j;
}
export const isoDurationSec = (d) => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d || ""); return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : 0; };
