// Portal tool — UI logic. Uses window.Portal from engine.js.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
let BUILT = null, CURRENT = null;

// sample data mirrored from the server so mock mode completes the loop with no API key
const CATALOG = [
  { id: "bk_neuromancer", title: "Neuromancer", author: "William Gibson", genre: "sci-fi", price: 12.5 },
  { id: "bk_dispossessed", title: "The Dispossessed", author: "Ursula K. Le Guin", genre: "sci-fi", price: 14.0 },
  { id: "bk_blindsight", title: "Blindsight", author: "Peter Watts", genre: "sci-fi", price: 9.99 },
  { id: "bk_deer_park", title: "The Deer Park", author: "Norman Mailer", genre: "literary", price: 16.0 }
];
const rid = (p) => p + Math.random().toString(36).slice(2, 8);
function mockExecute(name, input) {
  input = input || {};
  const n = String(name).toLowerCase();
  // bookshop
  if (n.includes("search")) {
    let r = CATALOG.slice();
    if (input.genre) r = r.filter((b) => b.genre.toLowerCase() === String(input.genre).toLowerCase());
    if (input.maxPrice != null) r = r.filter((b) => b.price <= Number(input.maxPrice));
    if (input.q) { const q = String(input.q).toLowerCase(); const h = r.filter((b) => (b.title + b.author + b.genre).toLowerCase().includes(q)); if (h.length) r = h; }
    return r.slice(0, 3);
  }
  if (n.includes("order")) { const b = CATALOG.find((x) => x.id === input.bookId); return { orderId: rid("ord_"), status: "confirmed", book: b ? b.title : (input.bookId || CATALOG[0].title), quantity: input.quantity || 1, eta: "2 business days" }; }
  if (n.includes("book")) return CATALOG.find((b) => b.id === input.id) || CATALOG[0];
  // payments
  if (n.includes("charge") && n.includes("get")) return { id: input.id || rid("ch_"), amount: 4000, currency: "usd", status: "succeeded", captured: true };
  if (n.includes("charge")) return { id: rid("ch_"), amount: input.amount || 4000, currency: "usd", status: "succeeded", customer: input.customer || "cus_9x2" };
  if (n.includes("refund")) return { id: rid("re_"), charge: input.charge || input.chargeId || "ch_prev", amount: input.amount || 4000, status: "succeeded" };
  // weather
  if (n.includes("forecast") || n.includes("weather")) return { location: input.city || input.location || "San Francisco", tempF: 64, conditions: "Partly cloudy", highF: 68, lowF: 55, updated: "just now" };
  // generic
  return { ok: true, received: input };
}

// prompts tuned to each sample so the composer always fits the selected API
const PROMPTS = {
  bookshop: "Find me a sci-fi book under $13 and order one copy.",
  payments: "Charge a customer $40, then refund it.",
  weather: "What’s the forecast in San Francisco?"
};

// ---------- samples + input ----------
function buildChips() {
  const box = $("chips");
  for (const [key, s] of Object.entries(Portal.SAMPLES)) {
    const b = document.createElement("button");
    b.className = "chip" + (key === "bookshop" ? " active" : "");
    b.textContent = s.label;
    b.onclick = () => {
      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      b.classList.add("active");
      $("spec").value = JSON.stringify(s.spec, null, 2);
      if (PROMPTS[key]) $("prompt").value = PROMPTS[key];
      generate();
    };
    box.appendChild(b);
  }
}

$("file").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { $("spec").value = rd.result; document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active")); };
  rd.readAsText(f);
});

// ---------- generate + render ----------
function generate() {
  const errEl = $("specErr");
  try {
    const spec = JSON.parse($("spec").value);
    const full = Portal.tools(spec);
    BUILT = {
      spec, title: (spec.info && spec.info.title) || "API", name: Portal.serverName(spec),
      toolsMcp: full.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      anthropicTools: Portal.anthropicTools(spec),
      audit: Portal.audit(spec), llms: Portal.llms(spec), mcp: Portal.mcpServer(spec), config: Portal.claudeConfig(spec)
    };
    errEl.style.display = "none";
    render(document.querySelector(".tab.active").dataset.tab);
    $("run").disabled = false; $("pg").classList.add("ready");
    const fe = $("feedEmpty"); if (fe) fe.textContent = "Send a task below. The agent will pick tools, call your API, and report back.";
  } catch (e) {
    errEl.textContent = "Couldn't parse that — it needs to be valid OpenAPI JSON. Check your brackets and commas.";
    errEl.style.display = "block"; BUILT = null; $("run").disabled = true;
  }
}

function render(tab) {
  const out = $("out"), tb = $("toolbar");
  if (!BUILT) { out.innerHTML = '<div class="empty">Generate to see the readiness score, MCP server, agent docs, and Claude config.</div>'; tb.style.display = "none"; return; }
  if (tab === "report") {
    tb.style.display = "none";
    const a = BUILT.audit;
    let h = '<div class="report"><div class="gauge">' + Portal.gauge(a.score, a.grade, Portal.gradeColor(a.score)) + '</div><ul class="findings">';
    for (const f of a.findings) {
      const c = f.level === "pass" ? "var(--good)" : f.level === "warn" ? "var(--amber)" : "var(--info)";
      h += '<li class="finding"><span class="dot" style="background:' + c + ';color:' + c + '"></span><div><div class="f-txt">' + esc(f.text) + '</div>' + (f.fix ? '<div class="fix">' + esc(f.fix) + '</div>' : '') + '</div></li>';
    }
    h += '</ul></div>';
    out.innerHTML = h;
    const g = out.querySelector('.gauge'); if (g) Portal.animateGauge(g);
    return;
  }
  const map = {
    server: { text: BUILT.mcp, file: BUILT.name + ".mjs" },
    tools: { text: JSON.stringify(BUILT.toolsMcp, null, 2), file: "tools.json" },
    docs: { text: BUILT.llms, file: "llms.txt" },
    config: { text: BUILT.config, file: "claude_desktop_config.json" }
  };
  CURRENT = map[tab];
  tb.style.display = "flex";
  $("fn").textContent = CURRENT.file;
  out.innerHTML = "<pre>" + esc(CURRENT.text) + "</pre>";
}

function download(name, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("copyBtn").onclick = () => { if (CURRENT) { navigator.clipboard.writeText(CURRENT.text); $("copyBtn").textContent = "Copied ✓"; setTimeout(() => ($("copyBtn").textContent = "Copy"), 1200); } };
$("dlBtn").onclick = () => { if (CURRENT) download(CURRENT.file, CURRENT.text); };

// ---------- playground ----------
const feed = () => $("feed");
function clearFeed() { feed().innerHTML = ""; }
function addUser(t) { const d = document.createElement("div"); d.className = "bubble you"; d.textContent = t; feed().appendChild(d); sc(); }
function addSay(t) { const d = document.createElement("div"); d.className = "bubble agent"; d.innerHTML = '<div class="who">AGENT</div>' + esc(t); feed().appendChild(d); sc(); }
function addErr(t) { const d = document.createElement("div"); d.className = "err"; d.textContent = t; feed().appendChild(d); sc(); }
function addCall(ev) {
  const args = Object.entries(ev.input || {}).map(([k, v]) => k + ": " + JSON.stringify(v)).join(", ");
  const d = document.createElement("div"); d.className = "toolcall";
  d.innerHTML = '<div class="head"><span>▸</span> <span class="tk">' + esc(ev.name) + '</span> <span class="args">(' + esc(args) + ')</span></div><pre style="display:none">' + esc(JSON.stringify(ev.output, null, 2)) + "</pre>";
  d.querySelector(".head").onclick = () => { const p = d.querySelector("pre"); p.style.display = p.style.display === "none" ? "block" : "none"; };
  feed().appendChild(d); sc();
}
function sc() { feed().scrollTop = feed().scrollHeight; }
function thinkOn() { const d = document.createElement("div"); d.className = "thinking"; d.id = "think"; d.innerHTML = '<div class="spin"></div> thinking…'; feed().appendChild(d); sc(); }
function thinkOff() { const t = $("think"); if (t) t.remove(); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function synthArgs(tool) {
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const req = (tool.inputSchema && tool.inputSchema.required) || [];
  const keys = req.length ? req : Object.keys(props).slice(0, 2);
  const out = {};
  for (const k of keys) {
    const t = ((props[k] || {}).type) || "string";
    out[k] = (t === "integer" || t === "number") ? 1 : t === "boolean" ? true : /id$/i.test(k) ? "id_123" : "sample";
  }
  return out;
}

async function mockAgent(prompt, tools) {
  const p = prompt.toLowerCase();
  const has = (re) => tools.find((t) => re.test(t.name.toLowerCase()));
  const num = (p.match(/\$?\s?(\d+(\.\d+)?)/) || [])[1];
  await wait(430); thinkOff();

  // ----- bookshop -----
  const searchT = has(/search/), orderT = has(/order/);
  if (searchT) {
    const input = {}; if (/sci-?fi|science fiction/.test(p)) input.genre = "sci-fi"; else if (/literary/.test(p)) input.genre = "literary"; if (num) input.maxPrice = Number(num);
    addSay("Searching the catalog for something that fits.");
    const res = mockExecute(searchT.name, input); addCall({ name: searchT.name, input, output: res });
    const picked = res[0]; thinkOn(); await wait(450); thinkOff();
    if (orderT && picked && /order|buy|purchase|get me|grab|copy/.test(p)) {
      const oi = { bookId: picked.id, quantity: 1 }; addCall({ name: orderT.name, input: oi, output: mockExecute(orderT.name, oi) });
      thinkOn(); await wait(400); thinkOff();
      addSay("Done — ordered “" + picked.title + "” by " + picked.author + " for $" + picked.price + ". It’ll arrive in about 2 business days.");
    } else if (picked) addSay("Top match: “" + picked.title + "” by " + picked.author + " ($" + picked.price + ").");
    else addSay("No catalog match for that — try another genre or price.");
    return;
  }

  // ----- payments -----
  const chargeT = has(/charge/), refundT = has(/refund/), getChargeT = has(/get.*charge|charge.*get/);
  if (chargeT || refundT) {
    const amt = num ? Math.round(Number(num) * 100) : 4000;
    addSay("Creating the charge, then confirming it settled.");
    const cIn = { amount: amt, currency: "usd", customer: "cus_9x2" };
    const charge = mockExecute((chargeT || {}).name || "createCharge", cIn); addCall({ name: (chargeT || {}).name || "createCharge", input: cIn, output: charge });
    thinkOn(); await wait(430); thinkOff();
    if (refundT && /refund/.test(p)) {
      const rIn = { charge: charge.id, amount: amt }; addCall({ name: refundT.name, input: rIn, output: mockExecute(refundT.name, rIn) });
      thinkOn(); await wait(380); thinkOff();
      addSay("Charged $" + (amt / 100).toFixed(2) + " and refunded it — both succeeded (" + charge.id + ").");
    } else if (getChargeT) {
      const gIn = { id: charge.id }; addCall({ name: getChargeT.name, input: gIn, output: mockExecute(getChargeT.name, gIn) });
      thinkOn(); await wait(360); thinkOff();
      addSay("Charged $" + (amt / 100).toFixed(2) + " to cus_9x2 and confirmed it — status succeeded (" + charge.id + ").");
    } else addSay("Charged $" + (amt / 100).toFixed(2) + " to cus_9x2 — status succeeded (" + charge.id + ").");
    return;
  }

  // ----- weather -----
  const fcT = has(/forecast|weather/);
  if (fcT) {
    const m = prompt.match(/in ([A-Za-z .'\-]+?)(\?|$|\.|,| today| tomorrow| now| this)/i);
    const input = m ? { city: m[1].trim() } : { lat: 37.77, lon: -122.42 };
    addSay("Pulling the latest forecast.");
    const out = mockExecute(fcT.name, input); addCall({ name: fcT.name, input, output: out });
    thinkOn(); await wait(420); thinkOff();
    addSay("It’s " + out.tempF + "°F and " + String(out.conditions).toLowerCase() + " in " + out.location + " — high " + out.highF + "°, low " + out.lowF + "°.");
    return;
  }

  // ----- generic (any pasted spec) -----
  const read = has(/get|list|search|fetch|find|read|query|lookup|show/) || tools[0];
  const write = has(/create|add|post|update|delete|send|make|submit|put/);
  if (!read && !write) { addSay("I couldn't find a callable tool in this spec for that."); return; }
  if (read) { const input = synthArgs(read); addSay("Calling " + read.name + " to handle that."); addCall({ name: read.name, input, output: mockExecute(read.name, input) }); thinkOn(); await wait(420); thinkOff(); }
  if (write && write.name !== (read && read.name) && /(create|add|make|order|buy|send|update|delete|submit|charge|pay|book|reserve|new)/.test(p)) {
    const input = synthArgs(write); addCall({ name: write.name, input, output: mockExecute(write.name, input) }); thinkOn(); await wait(380); thinkOff();
    addSay("Done — " + write.name + " returned successfully.");
  } else addSay("Called " + (read ? read.name : write.name) + " successfully — see the result above.");
}

let running = false;
async function run() {
  if (!BUILT || running) return;
  running = true; $("run").disabled = true; clearFeed(); addUser($("prompt").value); thinkOn();
  const payload = { prompt: $("prompt").value, tools: BUILT.anthropicTools, apiTitle: BUILT.title };
  try {
    const r = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await r.json();
    if (data.needKey) { await mockAgent(payload.prompt, BUILT.anthropicTools); }
    else { thinkOff(); for (const ev of data.events) { if (ev.kind === "say") addSay(ev.text); else if (ev.kind === "call") addCall(ev); else if (ev.kind === "error") addErr(ev.text); } }
  } catch (e) { await mockAgent(payload.prompt, BUILT.anthropicTools); }
  running = false; $("run").disabled = false;
}

async function health() {
  const b = $("mode");
  try {
    const d = await (await fetch("/api/health")).json();
    if (d.keyPresent) { b.textContent = "live · " + d.model; b.className = "live"; $("foot").textContent = "Live — the agent runs on " + d.model + " with the tools generated from your spec (API responses are simulated)."; }
    else { b.textContent = "demo mode · add key for live"; b.className = "mock"; $("foot").textContent = "Demo mode — the agent runs a scripted pass over your generated tools on sample data. Add an ANTHROPIC_API_KEY to run it live."; }
  } catch { b.textContent = "demo mode"; b.className = "mock"; $("foot").textContent = "Demo mode — the agent executes your generated tools against sample data, so the whole loop runs with zero setup."; }
}

// ---------- init ----------
buildChips();
$("spec").value = JSON.stringify(Portal.SAMPLES.bookshop.spec, null, 2);
$("prompt").value = PROMPTS.bookshop;
$("gen").onclick = generate;
$("run").onclick = run;
$("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active")); t.classList.add("active"); render(t.dataset.tab); }));
health();
generate(); // open pre-populated so the payoff is visible on arrival
