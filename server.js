// Portal — local dev server (zero dependencies, Node 18+)
// Serves the UI and runs the agent loop server-side so the API key stays off the client.
const http = require("http");
const fs = require("fs");
const path = require("path");

// --- minimal .env loader (no dotenv dependency) ---
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
})();

const PORT = process.env.PORT || 4270;
const KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.PORTAL_MODEL || "claude-sonnet-5";
const PUBLIC = path.join(__dirname, "public");

// --- sample data used to fake tool responses so the loop completes offline ---
const CATALOG = [
  { id: "bk_neuromancer", title: "Neuromancer", author: "William Gibson", genre: "sci-fi", price: 12.5 },
  { id: "bk_dispossessed", title: "The Dispossessed", author: "Ursula K. Le Guin", genre: "sci-fi", price: 14.0 },
  { id: "bk_blindsight", title: "Blindsight", author: "Peter Watts", genre: "sci-fi", price: 9.99 },
  { id: "bk_deer_park", title: "The Deer Park", author: "Norman Mailer", genre: "literary", price: 16.0 },
];

function mockExecute(name, input) {
  const n = String(name).toLowerCase();
  if (n.includes("search")) {
    let r = CATALOG.slice();
    if (input.genre) r = r.filter((b) => b.genre.toLowerCase() === String(input.genre).toLowerCase());
    if (input.maxPrice != null) r = r.filter((b) => b.price <= Number(input.maxPrice));
    if (input.q) {
      const q = String(input.q).toLowerCase();
      const hit = r.filter((b) => (b.title + b.author + b.genre).toLowerCase().includes(q));
      if (hit.length) r = hit;
    }
    return r.slice(0, 3);
  }
  if (n.includes("book")) return CATALOG.find((b) => b.id === input.id) || { error: "not_found", id: input.id };
  if (n.includes("order")) {
    const book = CATALOG.find((b) => b.id === input.bookId);
    return { orderId: "ord_" + Math.random().toString(36).slice(2, 8), status: "confirmed", book: book ? book.title : input.bookId, quantity: input.quantity || 1, eta: "2 business days" };
  }
  return { ok: true, received: input };
}

// --- Anthropic call + agent loop (runs server-side) ---
async function callAnthropic(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error("Anthropic " + r.status + ": " + text.slice(0, 400));
  return JSON.parse(text);
}

async function runAgent(prompt, tools, apiTitle) {
  const events = [];
  const messages = [{ role: "user", content: prompt }];
  const system =
    "You are an autonomous agent operating the " + apiTitle +
    " through the provided tools. Use tools to actually fulfill the request, then give a short, friendly confirmation. Prefer taking action over asking questions.";
  for (let step = 0; step < 5; step++) {
    const data = await callAnthropic({ model: MODEL, max_tokens: 1024, system, messages, tools });
    const blocks = data.content || [];
    const texts = blocks.filter((b) => b.type === "text").map((b) => b.text).filter(Boolean);
    const toolUses = blocks.filter((b) => b.type === "tool_use");
    if (texts.length) events.push({ kind: "say", text: texts.join("\n") });
    if (data.stop_reason !== "tool_use" || !toolUses.length) break;
    messages.push({ role: "assistant", content: blocks });
    const results = [];
    for (const tu of toolUses) {
      const output = mockExecute(tu.name, tu.input || {});
      events.push({ kind: "call", name: tu.name, input: tu.input, output });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output) });
    }
    messages.push({ role: "user", content: results });
  }
  return events;
}

// --- tiny HTTP layer ---
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

function sendJSON(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(s);
}

function serveStatic(res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ""));
  if (!file.startsWith(PUBLIC)) return sendJSON(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) return sendJSON(res, 404, { error: "not found", path: rel });
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health")
    return sendJSON(res, 200, { ok: true, keyPresent: !!KEY, model: MODEL });

  if (req.method === "POST" && req.url === "/api/agent") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { prompt, tools, apiTitle } = JSON.parse(body || "{}");
        if (!KEY) return sendJSON(res, 200, { needKey: true });
        const events = await runAgent(prompt, tools || [], apiTitle || "API");
        sendJSON(res, 200, { events });
      } catch (e) {
        sendJSON(res, 200, { events: [{ kind: "error", text: String(e.message || e) }] });
      }
    });
    return;
  }

  if (req.method === "GET") return serveStatic(res, req.url);
  sendJSON(res, 405, { error: "method not allowed" });
});

server.listen(PORT, () => {
  console.log("Portal running  →  http://localhost:" + PORT);
  console.log("Model: " + MODEL + "   API key: " + (KEY ? "loaded" : "NOT set (mock mode)"));
});
