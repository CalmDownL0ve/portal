// Smoke test: generate an MCP server from a sample spec, boot it, and speak MCP to it.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Portal = require(path.join(__dirname, "..", "public", "engine.js"));

const spec = Portal.SAMPLES.bookshop.spec;
const code = Portal.mcpServer(spec);
const file = path.join(os.tmpdir(), "portal-gen-mcp.mjs");
fs.writeFileSync(file, code);
console.log("Generated " + code.split("\n").length + " lines -> " + file);

const child = spawn("node", [file], { stdio: ["pipe", "pipe", "pipe"] });
let out = "";
const byId = {};
child.stdout.on("data", (d) => {
  out += d.toString();
  let i;
  while ((i = out.indexOf("\n")) >= 0) {
    const line = out.slice(0, i).trim();
    out = out.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id != null) { byId[m.id] = m; if (m.id === 3) finish(); } } catch (e) {}
  }
});
child.stderr.on("data", (d) => process.stderr.write("  [server] " + d.toString()));

const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
setTimeout(() => send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } } }), 120);
setTimeout(() => send({ jsonrpc: "2.0", method: "notifications/initialized" }), 260);
setTimeout(() => send({ jsonrpc: "2.0", id: 2, method: "tools/list" }), 360);
setTimeout(() => send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "searchBooks", arguments: { genre: "sci-fi" } } }), 520);

let done = false;
function finish() {
  if (done) return; done = true;
  try { child.kill(); } catch (e) {}
  const init = byId[1], list = byId[2], call = byId[3];
  const checks = [
    ["initialize returns serverInfo.name", !!(init && init.result && init.result.serverInfo && init.result.serverInfo.name)],
    ["initialize echoes protocolVersion", !!(init && init.result && init.result.protocolVersion)],
    ["tools/list returns 3 tools", !!(list && list.result && list.result.tools && list.result.tools.length === 3)],
    ["each tool has an inputSchema object", !!(list && list.result.tools.every((t) => t.inputSchema && t.inputSchema.type === "object"))],
    ["tools/call returns a well-formed content array", !!(call && call.result && Array.isArray(call.result.content))],
  ];
  let pass = true;
  for (const [name, ok] of checks) { console.log((ok ? "PASS" : "FAIL") + "  " + name); if (!ok) pass = false; }
  console.log("\n" + (pass ? "ALL PASS \u2713" : "FAILURES \u2717"));
  process.exit(pass ? 0 : 1);
}
setTimeout(finish, 9000);
