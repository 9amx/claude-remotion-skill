// Remote Agent for Faceless Studio Cloud
// Connects this local video project to your remote Faceless Studio website via an
// outgoing WebSocket, acting as a secure reverse proxy to editor.mjs (port 3100).
// Usage:
//   node scripts/remote-agent.mjs [--check] [--url=wss://studio.domain.com] [--token=...]
//   npm run remote

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// Determine ROOT: prefer current working directory if it contains project.json or package.json
const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwdRoot = process.cwd();
const ROOT = (fs.existsSync(path.join(cwdRoot, "project.json")) || fs.existsSync(path.join(cwdRoot, "package.json")))
  ? cwdRoot
  : scriptRoot;

const args = process.argv.slice(2);

// Load ws module: try standard import, then fallback to project's node_modules via createRequire
let WebSocket = null;
try {
  const wsMod = await import("ws");
  WebSocket = wsMod.default || wsMod;
} catch (e) {
  try {
    const req = createRequire(path.join(ROOT, "package.json"));
    WebSocket = req("ws");
  } catch (e2) {
    try {
      const req = createRequire(path.join(cwdRoot, "package.json"));
      WebSocket = req("ws");
    } catch (e3) {
      // ws not found, handled in check/start
    }
  }
}

// Command line arguments / environment variables
const remoteUrlArg = args.find((a) => a.startsWith("--url="))?.slice(6);
const tokenArg = args.find((a) => a.startsWith("--token="))?.slice(8);
const portArg = Number(args.find((a) => a.startsWith("--port="))?.slice(7));
const projectArg = args.find((a) => a.startsWith("--project="))?.slice(10);
const isCheckMode = args.includes("--check");

const REMOTE_URL = remoteUrlArg || process.env.REMOTE_URL || process.env.REMOTE_AGENT_URL;
const AGENT_TOKEN = tokenArg || process.env.REMOTE_AGENT_TOKEN;
const LOCAL_PORT = portArg || Number(process.env.EDITOR_PORT) || 3100;

function readProjectInfo() {
  try {
    const file = process.env.PROJECT || path.join(ROOT, "project.json");
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return {
        title: data.title || path.basename(ROOT),
        id: slugify(data.title || path.basename(ROOT)),
      };
    }
  } catch {}
  const base = path.basename(ROOT);
  return { title: base, id: slugify(base) };
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project";
}

const projectInfo = readProjectInfo();
const PROJECT_ID = projectArg || process.env.PROJECT_ID || projectInfo.id;
const PROJECT_TITLE = projectInfo.title;

function log(sub, msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`\x1b[90m${t}\x1b[0m [\x1b[35mremote-agent\x1b[0m] ${sub ? `\x1b[36m${sub}\x1b[0m: ` : ""}${msg}`);
}

// ---------- --check diagnostic mode ----------
async function runCheck() {
  console.log("\n--- Faceless Studio Cloud: Remote Agent Diagnostic ---\n");
  let ok = true;

  // 1. Check Node version (Node 20+)
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split(".")[0], 10);
  if (major >= 20) {
    console.log(`[PASS] Node.js version ${nodeVer} (>= 20 required)`);
  } else {
    console.log(`[FAIL] Node.js version ${nodeVer} (< 20). Please upgrade Node.`);
    ok = false;
  }

  // 1b. Check ws dependency
  if (WebSocket) {
    console.log(`[PASS] WebSocket package ('ws') is available`);
  } else {
    console.log(`[FAIL] WebSocket package ('ws') is not installed. Run: npm install ws`);
    ok = false;
  }

  // 2. Check project directory & files
  const projectFile = path.join(ROOT, "project.json");
  if (fs.existsSync(projectFile)) {
    console.log(`[PASS] Project directory: ${ROOT}`);
    console.log(`       Project title: "${PROJECT_TITLE}" (ID: ${PROJECT_ID})`);
  } else {
    console.log(`[WARN] No project.json found in ${ROOT}. Using folder name as project ID.`);
  }

  // 3. Check local editor.mjs on port 3100
  console.log(`[....] Testing local editor at http://127.0.0.1:${LOCAL_PORT}/api/state ...`);
  const editorOk = await new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${LOCAL_PORT}/api/state`, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const s = JSON.parse(data);
          resolve({ ok: true, state: s });
        } catch {
          resolve({ ok: false, error: "Invalid JSON response" });
        }
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(2500, () => {
      req.destroy();
      resolve({ ok: false, error: "Connection timed out" });
    });
  });

  if (editorOk.ok) {
    console.log(`[PASS] Local editor is running at http://127.0.0.1:${LOCAL_PORT}`);
    if (editorOk.state?.timeline) {
      console.log(`       Timeline loaded (${editorOk.state.timeline.totalFrames || 0} frames)`);
    }
  } else {
    console.log(`[WARN] Local editor is NOT responding: ${editorOk.error}`);
    console.log(`       Start it with: npm run editor (or node scripts/editor.mjs)`);
  }

  // 4. Check REMOTE_URL and AGENT_TOKEN configuration
  if (!REMOTE_URL) {
    console.log(`[FAIL] REMOTE_URL is not set.`);
    console.log(`       Set it via environment variable: setx REMOTE_URL "wss://studio.<your-domain>"`);
    console.log(`       Or pass --url=wss://studio.<your-domain>`);
    ok = false;
  } else {
    console.log(`[PASS] REMOTE_URL is configured: ${REMOTE_URL}`);
  }

  if (!AGENT_TOKEN) {
    console.log(`[FAIL] REMOTE_AGENT_TOKEN is not set.`);
    console.log(`       Set it via environment variable: setx REMOTE_AGENT_TOKEN "<token>"`);
    console.log(`       Or pass --token=<token>`);
    ok = false;
  } else {
    console.log(`[PASS] REMOTE_AGENT_TOKEN is configured (${AGENT_TOKEN.slice(0, 4)}...${AGENT_TOKEN.slice(-4)})`);
  }

  // 5. Test remote WebSocket connectivity if URL & Token are set
  if (REMOTE_URL && AGENT_TOKEN) {
    console.log(`[....] Testing WebSocket connection to ${REMOTE_URL}/agent ...`);
    const wsUrl = getWsUrl(REMOTE_URL);
    const connResult = await new Promise((resolve) => {
      try {
        const ws = new WebSocket(`${wsUrl}/agent`, {
          headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
          handshakeTimeout: 5000,
        });
        const timer = setTimeout(() => {
          ws.terminate();
          resolve({ ok: false, error: "Connection timed out after 5s" });
        }, 6000);

        ws.on("open", () => {
          ws.send(JSON.stringify({
            type: "register",
            token: AGENT_TOKEN,
            projectId: PROJECT_ID,
            projectTitle: PROJECT_TITLE,
            check: true,
          }));
        });

        ws.on("message", (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            clearTimeout(timer);
            ws.close();
            if (msg.type === "registered" || msg.ok) {
              resolve({ ok: true, msg });
            } else {
              resolve({ ok: false, error: msg.error || "Server rejected registration" });
            }
          } catch (e) {
            clearTimeout(timer);
            ws.close();
            resolve({ ok: false, error: "Unexpected message from server" });
          }
        });

        ws.on("error", (e) => {
          clearTimeout(timer);
          resolve({ ok: false, error: e.message });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });

    if (connResult.ok) {
      console.log(`[PASS] Successfully connected & authenticated with relay!`);
    } else {
      console.log(`[FAIL] Connection test failed: ${connResult.error}`);
      ok = false;
    }
  }

  console.log("\n-------------------------------------------------------");
  if (ok) {
    console.log("All essential checks PASSED. Ready to run: npm run remote\n");
    process.exit(0);
  } else {
    console.log("Some checks FAILED. See above for instructions.\n");
    process.exit(1);
  }
}

function getWsUrl(raw) {
  let u = raw.trim();
  if (u.startsWith("http://")) u = "ws://" + u.slice(7);
  else if (u.startsWith("https://")) u = "wss://" + u.slice(8);
  else if (!u.startsWith("ws://") && !u.startsWith("wss://")) u = "wss://" + u;
  return u.replace(/\/+$/, "");
}

// If invoked with --check, run diagnostics and exit
if (isCheckMode) {
  runCheck();
} else {
  startAgent();
}

// ---------- Main Remote Agent Implementation ----------
function startAgent() {
  if (!WebSocket) {
    console.error("\x1b[31m[remote-agent error]\x1b[0m 'ws' package is not installed.");
    console.error("  Run: npm install ws\n");
    process.exit(1);
  }

  if (!REMOTE_URL || !AGENT_TOKEN) {
    console.error("\x1b[31m[remote-agent error]\x1b[0m REMOTE_URL and REMOTE_AGENT_TOKEN must be set.");
    console.error("  Set them in your environment or run with --check for diagnosis.");
    console.error("  Example: node scripts/remote-agent.mjs --url=wss://studio.example.com --token=<token>\n");
    process.exit(1);
  }

  const wsUrl = getWsUrl(REMOTE_URL);
  log("info", `Project "${PROJECT_TITLE}" (ID: ${PROJECT_ID})`);
  log("info", `Target relay: ${wsUrl}/agent`);
  log("info", `Local editor: http://127.0.0.1:${LOCAL_PORT}`);

  let ws = null;
  let reconnectAttempts = 0;
  let heartbeatTimer = null;
  let isClosing = false;
  const activeRequests = new Map(); // id -> http.ClientRequest

  function connect() {
    if (isClosing) return;
    const endpoint = `${wsUrl}/agent`;
    log("connect", `Connecting to ${endpoint} ...`);

    try {
      ws = new WebSocket(endpoint, {
        headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
        handshakeTimeout: 10000,
      });
    } catch (err) {
      scheduleReconnect(err.message);
      return;
    }

    ws.on("open", () => {
      log("connected", `Connected to relay! Registering project "${PROJECT_ID}" ...`);
      reconnectAttempts = 0;

      // Register project
      ws.send(JSON.stringify({
        type: "register",
        token: AGENT_TOKEN,
        projectId: PROJECT_ID,
        projectTitle: PROJECT_TITLE,
      }));

      // Start 20s heartbeat
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping", time: Date.now() }));
        }
      }, 20000);
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        // Reserved for future binary uploads from server if needed
        return;
      }
      try {
        const text = data.toString("utf8");
        const msg = JSON.parse(text);
        handleServerMessage(msg);
      } catch (err) {
        log("error", `Failed to parse server message: ${err.message}`);
      }
    });

    ws.on("close", (code, reason) => {
      clearInterval(heartbeatTimer);
      abortAllActiveRequests();
      if (!isClosing) {
        log("disconnect", `Disconnected (code: ${code}, reason: ${reason.toString() || "none"})`);
        scheduleReconnect();
      }
    });

    ws.on("error", (err) => {
      log("error", `WebSocket error: ${err.message}`);
      // close event will trigger reconnect
    });
  }

  function scheduleReconnect(reason) {
    clearInterval(heartbeatTimer);
    if (isClosing) return;
    reconnectAttempts++;
    // Exponential backoff with jitter: 1s, 2s, 4s, 8s, up to max 30s
    const base = Math.min(30000, 1000 * Math.pow(1.8, Math.min(reconnectAttempts - 1, 6)));
    const jitter = Math.random() * 800;
    const delay = Math.round(base + jitter);
    log("reconnect", `Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts})${reason ? `: ${reason}` : ""}`);
    setTimeout(connect, delay);
  }

  function handleServerMessage(msg) {
    if (msg.type === "pong") {
      // Heartbeat acknowledged
      return;
    }
    if (msg.type === "registered") {
      log("ready", `Project "${PROJECT_ID}" is live on Faceless Studio Cloud!`);
      return;
    }
    if (msg.type === "error") {
      log("server-error", msg.error || "Relay error");
      return;
    }
    if (msg.type === "req_abort") {
      const active = activeRequests.get(msg.id);
      if (active) {
        active.destroy();
        activeRequests.delete(msg.id);
      }
      return;
    }
    if (msg.type === "req") {
      proxyRequest(msg);
      return;
    }
  }

  function abortAllActiveRequests() {
    for (const [id, req] of activeRequests.entries()) {
      req.destroy();
    }
    activeRequests.clear();
  }

  // Reverse proxy an incoming HTTP request to local editor.mjs (127.0.0.1:3100)
  function proxyRequest(reqMsg) {
    const { id, method, path: reqPath, headers = {}, body } = reqMsg;

    const outgoingHeaders = { ...headers };
    // Always route to localhost editor
    outgoingHeaders.host = `127.0.0.1:${LOCAL_PORT}`;
    delete outgoingHeaders["connection"];
    delete outgoingHeaders["upgrade"];

    const reqOptions = {
      hostname: "127.0.0.1",
      port: LOCAL_PORT,
      path: reqPath,
      method: method || "GET",
      headers: outgoingHeaders,
      timeout: 30000,
    };

    const localReq = http.request(reqOptions, (localRes) => {
      // Forward status and headers back to relay
      sendWsText({
        type: "res_start",
        id,
        status: localRes.statusCode || 200,
        statusText: localRes.statusMessage || "OK",
        headers: localRes.headers,
      });

      // Stream binary response data in chunks up to 1 MB
      localRes.on("data", (chunk) => {
        sendBinaryChunk(id, chunk);
      });

      localRes.on("end", () => {
        sendWsText({ type: "res_end", id });
        activeRequests.delete(id);
      });
    });

    localReq.on("error", (err) => {
      log("proxy-err", `${method} ${reqPath} failed: ${err.message}`);
      sendWsText({
        type: "res_error",
        id,
        status: err.code === "ECONNREFUSED" ? 502 : 500,
        error: err.code === "ECONNREFUSED"
          ? `Local editor is not running on port ${LOCAL_PORT}. Start it with npm run editor`
          : err.message,
      });
      activeRequests.delete(id);
    });

    localReq.on("timeout", () => {
      localReq.destroy(new Error("Local editor request timed out"));
    });

    activeRequests.set(id, localReq);

    // Write body if provided
    if (body) {
      if (typeof body === "string") {
        localReq.write(body);
      } else if (body.type === "Buffer" && Array.isArray(body.data)) {
        localReq.write(Buffer.from(body.data));
      } else {
        localReq.write(JSON.stringify(body));
      }
    }
    localReq.end();
  }

  // Sends a text JSON message to the relay
  function sendWsText(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  // Sends a binary chunk with 2-byte id length header
  // [uint16BE id_len][id_len bytes ASCII id][raw chunk bytes]
  function sendBinaryChunk(id, chunkBuffer) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const idBuf = Buffer.from(id, "utf8");
    const idLen = idBuf.length;
    const headerBuf = Buffer.allocUnsafe(2 + idLen);
    headerBuf.writeUInt16BE(idLen, 0);
    idBuf.copy(headerBuf, 2);

    const frame = Buffer.concat([headerBuf, chunkBuffer]);
    ws.send(frame, { binary: true });
  }

  // Graceful shutdown
  const shutdown = () => {
    isClosing = true;
    log("info", "Shutting down remote agent...");
    clearInterval(heartbeatTimer);
    abortAllActiveRequests();
    if (ws) {
      ws.close(1000, "Agent shutting down");
    }
    setTimeout(() => process.exit(0), 500);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  connect();
}
