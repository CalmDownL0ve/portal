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
function mockExecute(name, input) {
  const n = String(name).toLowerCase();
  if (n.includes("search")) {
    let r = CATALOG.slice();
    if (input.genre) r = r.filter((b) => b.genre.toLowerCase() === String(input.genre).toLowerCase());
    if (input.maxPrice != null) r = r.filter((b) => b.price <= Number(input.maxPrice));
    if (input.q) { const q = String(input.q).toLowerCase(); const h = r.filter((b) => (b.title + b.author + b.genre).toLowerCase().includes(q)); if (h.length) r = h; }
    return r.slice(0, 3);
  }
  if (n.includes("book")) return CATALOG.find((b) => b.id === input.id) || { error: "not_found" };
  if (n.includes("order")) { const b = CATALOG.find((x) => x.id === input.bookId); return { orderId: "ord_" + Math.random().toString(36).slice(2, 8), status: "confirmed", book: b ? b.title : input.bookId, quantity: input.quantity || 1, eta: "2 business days" }; }
  return { ok: true, received: input };
}

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

async function mockAgent(prompt, tools) {
  const search = tools.find((t) => t.name.toLowerCase().includes("search"));
  const order = tools.find((t) => t.name.toLowerCase().includes("order"));
  const p = prompt.toLowerCase();
  const price = (p.match(/\$?\s?(\d+(\.\d+)?)/) || [])[1];
  const genre = /sci-?fi|science fiction/.test(p) ? "sci-fi" : /literary/.test(p) ? "literary" : null;
  const wantOrder = /order|buy|purchase|get me|grab/.test(p);
  let picked = null;
  if (search) {
    const input = {}; if (genre) input.genre = genre; if (price) input.maxPrice = Number(price);
    await wait(450); thinkOff(); addSay("Searching the catalog for something that fits.");
    const res = mockExecute(search.name, input); addCall({ name: search.name, input, output: res }); picked = res[0]; thinkOn(); await wait(450);
  }
  if (wantOrder && order && picked) {
    thinkOff(); const input = { bookId: picked.id, quantity: 1 };
    addCall({ name: order.name, input, output: mockExecute(order.name, input) }); thinkOn(); await wait(400); thinkOff();
    addSay("Done — ordered “" + picked.title + "” by " + picked.author + " for $" + picked.price + ". It’ll arrive in about 2 business days.");
  } else if (picked) { thinkOff(); addSay("Top match: “" + picked.title + "” by " + picked.author + " ($" + picked.price + ")."); }
  else { thinkOff(); addSay("I couldn't find a matching tool for that request in this spec."); }
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
    if (d.keyPresent) { b.textContent = "live · " + d.model; b.className = "live"; $("foot").textContent = "Live · the agent runs on " + d.model + " using the tools generated from your spec (API responses are mocked)."; }
    else { b.textContent = "mock mode · add API key"; b.className = "mock"; }
  } catch { b.textContent = "static · mock mode"; b.className = "mock"; }
}

// ---------- init ----------
buildChips();
$("spec").value = JSON.stringify(Portal.SAMPLES.bookshop.spec, null, 2);
$("gen").onclick = generate;
$("run").onclick = run;
$("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => { document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active")); t.classList.add("active"); render(t.dataset.tab); }));
health();
