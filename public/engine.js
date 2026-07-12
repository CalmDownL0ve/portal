// Portal engine — the generation core. Runs in the browser (window.Portal)
// and in Node (require), so the app UI and the test suite share one source of truth.
(function (root) {
  "use strict";
  const METHODS = ["get", "post", "put", "patch", "delete"];

  // ---------- sample specs ----------
  const SAMPLES = {
    bookshop: {
      label: "Bookshop",
      spec: {
        openapi: "3.0.0",
        info: { title: "Paper & Pixel Bookshop", version: "1.0.0", description: "An independent bookstore's catalog and ordering API." },
        servers: [{ url: "https://api.paperandpixel.dev" }],
        paths: {
          "/books": { get: { operationId: "searchBooks", summary: "Search the catalog", description: "Full-text search across titles, authors, and keywords.",
            parameters: [
              { name: "q", in: "query", schema: { type: "string" }, description: "Search text — title, author, or keyword" },
              { name: "genre", in: "query", schema: { type: "string" } },
              { name: "maxPrice", in: "query", schema: { type: "number" }, description: "Only return books at or below this price (USD)" }] } },
          "/books/{id}": { get: { operationId: "getBook", summary: "Get one book", description: "Fetch full detail for a single book by id.",
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "The book id" }] } },
          "/orders": { post: { operationId: "createOrder",
            requestBody: { required: true, content: { "application/json": { schema: {
              type: "object", required: ["bookId", "quantity"],
              properties: { bookId: { type: "string", description: "Id of the book to order" }, quantity: { type: "integer" } } } } } } } }
        }
      }
    }
  };

  SAMPLES.payments = {
    label: "Payments",
    spec: {
      openapi: "3.0.0",
      info: { title: "Ledgerline Payments", version: "2.1.0", description: "Create and manage payments and refunds." },
      servers: [{ url: "https://api.ledgerline.com/v2" }],
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
      security: [{ bearerAuth: [] }],
      paths: {
        "/charges": { post: { operationId: "createCharge", summary: "Create a charge", description: "Charge a customer a fixed amount in a given currency.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["amount", "currency", "source"], properties: {
            amount: { type: "integer", description: "Amount in the smallest currency unit (e.g. cents)" },
            currency: { type: "string", description: "ISO 4217 currency code, e.g. usd" },
            source: { type: "string", description: "Payment source or token to charge" },
            description: { type: "string", description: "Optional note shown on the statement" } } } } } } } },
        "/charges/{id}": { get: { operationId: "getCharge", summary: "Retrieve a charge", description: "Fetch a single charge by its id.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "The charge id" }] } },
        "/refunds": { post: { operationId: "createRefund", summary: "Refund a charge", description: "Refund all or part of a charge.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["chargeId"], properties: {
            chargeId: { type: "string", description: "The charge to refund" },
            amount: { type: "integer", description: "Amount to refund in the smallest unit; omit to refund in full" } } } } } } } }
      }
    }
  };

  SAMPLES.weather = {
    label: "Weather",
    spec: {
      openapi: "3.0.0",
      info: { title: "Skycast", version: "1.0.0", description: "Simple weather forecasts by coordinates." },
      servers: [{ url: "https://api.skycast.dev" }],
      paths: {
        "/forecast": { get: { operationId: "getForecast", summary: "Get a forecast",
          description: "Return the daily forecast for a location.",
          parameters: [
            { name: "lat", in: "query", required: true, schema: { type: "number" }, description: "Latitude" },
            { name: "lon", in: "query", required: true, schema: { type: "number" }, description: "Longitude" },
            { name: "days", in: "query", schema: { type: "integer" }, description: "Number of days, 1–14" }] } }
      }
    }
  };

  // ---------- normalization: resolve local $ref, hoist path-level params, expand server vars ----------
  // Real-world specs (Stripe, GitHub, ...) lean heavily on $ref and shared path-level parameters.
  // We resolve those to plain objects up front so the rest of the engine only ever sees flat shapes.
  function deref(root) {
    let clone; try { clone = JSON.parse(JSON.stringify(root)); } catch (e) { return root; }
    const get = (ref) => {
      if (typeof ref !== "string" || ref[0] !== "#") return undefined;
      let node = clone;
      for (const raw of ref.slice(1).split("/").filter(Boolean)) {
        const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
        if (node == null) return undefined; node = node[key];
      }
      return node;
    };
    const walk = (node, depth, seen) => {
      if (depth > 16 || node == null || typeof node !== "object") return node;
      if (typeof node.$ref === "string") {
        if (seen.has(node.$ref)) return {};                 // cycle -> break
        const target = get(node.$ref);
        if (target === undefined) return node;               // external/unresolvable -> leave as-is
        const next = new Set(seen); next.add(node.$ref);
        return walk(target, depth + 1, next);
      }
      if (Array.isArray(node)) return node.map((x) => walk(x, depth + 1, seen));
      const out = {}; for (const k of Object.keys(node)) out[k] = walk(node[k], depth + 1, seen);
      return out;
    };
    return walk(clone, 0, new Set());
  }

  function normalize(spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) return { paths: {} };
    const s = deref(spec);
    if (!s.paths || typeof s.paths !== "object") s.paths = {};
    for (const item of Object.values(s.paths)) {
      if (!item || typeof item !== "object") continue;
      const shared = Array.isArray(item.parameters) ? item.parameters : null;
      if (!shared) continue;
      for (const [method, op] of Object.entries(item)) {
        if (!METHODS.includes(method) || !op || typeof op !== "object") continue;
        const own = Array.isArray(op.parameters) ? op.parameters : [];
        const seen = new Set(own.filter(Boolean).map((p) => p.name + "|" + p.in));   // op params win
        op.parameters = own.concat(shared.filter((p) => p && !seen.has(p.name + "|" + p.in)));
      }
    }
    return s;
  }

  function baseUrl(spec) {
    const srv = (spec.servers && spec.servers[0]) || null;
    if (!srv || !srv.url) return "";
    let u = String(srv.url);
    if (srv.variables) for (const [k, v] of Object.entries(srv.variables)) u = u.split("{" + k + "}").join((v && v.default) || "");
    return u;
  }

  // ---------- spec -> tools (MCP shape, with HTTP metadata for the generated server) ----------
  function tools(spec) {
    spec = normalize(spec);
    const arr = [];
    for (const [route, methods] of Object.entries((spec && spec.paths) || {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!METHODS.includes(method)) continue;
        const name = op.operationId || (method + "_" + route.replace(/[\/{}]/g, "_"));
        const desc = [op.summary, op.description].filter(Boolean).join(" — ") || "(no description provided)";
        const properties = {}, required = [], query = [], pathParams = [], body = [];
        for (const p of op.parameters || []) {
          if (!p || !p.name) continue;
          properties[p.name] = { type: (p.schema && p.schema.type) || "string", description: p.description || "" };
          if (p.required) required.push(p.name);
          if (p.in === "query") query.push(p.name);
          if (p.in === "path") pathParams.push(p.name);
        }
        const bschema = op.requestBody && op.requestBody.content && op.requestBody.content["application/json"] && op.requestBody.content["application/json"].schema;
        if (bschema && bschema.properties) {
          for (const [k, v] of Object.entries(bschema.properties)) { properties[k] = { type: v.type || "string", description: v.description || "" }; body.push(k); }
          (bschema.required || []).forEach((r) => required.push(r));
        }
        arr.push({ name, description: desc, inputSchema: { type: "object", properties, required: [...new Set(required)] }, method, path: route, query, pathParams, body });
      }
    }
    return arr;
  }

  // Anthropic Messages API tool shape (input_schema) for the live playground
  function anthropicTools(spec) {
    return tools(spec).map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  }

  // ---------- readiness audit ----------
  function gradeFor(score) { return score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F"; }

  function audit(spec) {
    spec = normalize(spec);
    const f = [];
    const base = baseUrl(spec);
    if (!base) f.push({ level: "warn", text: "No server URL declared", fix: "Agents need a base URL to route calls." });
    else f.push({ level: "pass", text: "Base URL set (" + base + ")" });
    const t = tools(spec);
    f.push({ level: t.length ? "pass" : "warn", text: t.length + " callable operation" + (t.length === 1 ? "" : "s") + " found", fix: t.length ? "" : "No operations with a method were found in paths." });
    for (const [route, methods] of Object.entries(spec.paths || {})) {
      for (const [method, op] of Object.entries(methods)) {
        if (!METHODS.includes(method)) continue;
        const label = op.operationId || (method.toUpperCase() + " " + route);
        if (!op.operationId) f.push({ level: "warn", text: method.toUpperCase() + " " + route + " has no operationId", fix: "Agents key tools by a stable name — add operationId." });
        if (!op.summary && !op.description) f.push({ level: "warn", text: "\u201c" + label + "\u201d has no description", fix: "Agents pick tools by description. Add one sentence on when to use it." });
        for (const p of op.parameters || []) {
          if (!p.description) f.push({ level: "info", text: "Param \u201c" + p.name + "\u201d on " + label + " is undocumented", fix: "Describe it so the agent knows what to pass." });
          if (/^[a-z]$/.test(p.name)) f.push({ level: "info", text: "Param \u201c" + p.name + "\u201d is a single letter", fix: "Rename to something explicit — agents infer intent from names." });
        }
      }
    }
    if (!(spec.components && spec.components.securitySchemes)) f.push({ level: "warn", text: "No auth scheme defined", fix: "Declare a securityScheme so agents can get keys without a human." });
    else f.push({ level: "pass", text: "Auth scheme defined — agents can authenticate" });
    const warns = f.filter((x) => x.level === "warn").length, infos = f.filter((x) => x.level === "info").length;
    const score = Math.max(0, 100 - warns * 12 - infos * 4);
    return { findings: f, score, grade: gradeFor(score) };
  }

  // ---------- llms.txt ----------
  function llms(spec) {
    spec = normalize(spec);
    const ts = tools(spec);
    const base = baseUrl(spec) || "(set your base URL)";
    let out = "# " + ((spec.info && spec.info.title) || "API") + "\n\n> " + ((spec.info && spec.info.description) || "") + "\n\nBase URL: " + base + "\n\n## Tools an agent can call\n\n";
    for (const t of ts) {
      out += "### " + t.name + "\n" + t.description + "\n";
      const props = Object.entries(t.inputSchema.properties || {});
      if (props.length) {
        out += "Inputs:\n";
        for (const [k, v] of props) out += "- `" + k + "` (" + v.type + ")" + ((t.inputSchema.required || []).includes(k) ? " (required)" : "") + (v.description ? " — " + v.description : "") + "\n";
      }
      out += "\n";
    }
    return out.trim();
  }

  // ---------- runnable MCP server generation ----------
  // Fixed runtime, written to avoid backtick/newline escaping in the generated file.
  const RUNTIME = [
    'const NL = String.fromCharCode(10);',
    'let buf = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", function (chunk) {',
    '  buf += chunk;',
    '  let i;',
    '  while ((i = buf.indexOf(NL)) >= 0) {',
    '    const line = buf.slice(0, i).trim();',
    '    buf = buf.slice(i + 1);',
    '    if (line) handleLine(line);',
    '  }',
    '});',
    '',
    'function send(msg) { process.stdout.write(JSON.stringify(msg) + NL); }',
    'function logmsg(x) { process.stderr.write("[mcp] " + x + NL); }',
    '',
    'async function handleLine(line) {',
    '  let req;',
    '  try { req = JSON.parse(line); } catch (e) { return; }',
    '  const id = req.id, method = req.method, params = req.params || {};',
    '  try {',
    '    if (method === "initialize") {',
    '      send({ jsonrpc: "2.0", id: id, result: {',
    '        protocolVersion: params.protocolVersion || "2024-11-05",',
    '        capabilities: { tools: {} },',
    '        serverInfo: SERVER_INFO } });',
    '    } else if (method === "notifications/initialized") {',
    '      return;',
    '    } else if (method === "tools/list") {',
    '      send({ jsonrpc: "2.0", id: id, result: { tools: TOOLS.map(function (t) {',
    '        return { name: t.name, description: t.description, inputSchema: t.inputSchema }; }) } });',
    '    } else if (method === "tools/call") {',
    '      const tool = TOOLS.find(function (t) { return t.name === params.name; });',
    '      if (!tool) { send({ jsonrpc: "2.0", id: id, error: { code: -32602, message: "Unknown tool" } }); return; }',
    '      const text = await callApi(tool, params.arguments || {});',
    '      send({ jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: text }] } });',
    '    } else if (method === "ping") {',
    '      send({ jsonrpc: "2.0", id: id, result: {} });',
    '    } else if (id !== undefined) {',
    '      send({ jsonrpc: "2.0", id: id, error: { code: -32601, message: "Method not found: " + method } });',
    '    }',
    '  } catch (e) {',
    '    if (id !== undefined) send({ jsonrpc: "2.0", id: id, result: { content: [{ type: "text", text: "Error: " + (e && e.message ? e.message : e) }], isError: true } });',
    '  }',
    '}',
    '',
    'async function callApi(tool, args) {',
    '  let p = tool.path;',
    '  for (const name of tool.pathParams) p = p.replace("{" + name + "}", encodeURIComponent(args[name] != null ? args[name] : ""));',
    '  const url = new URL(BASE + p);',
    '  for (const name of tool.query) if (args[name] != null) url.searchParams.set(name, args[name]);',
    '  const init = { method: tool.method.toUpperCase(), headers: {} };',
    '  const token = process.env.API_TOKEN;',
    '  if (token) init.headers["authorization"] = "Bearer " + token;',
    '  if (tool.body && tool.body.length) {',
    '    const b = {};',
    '    for (const name of tool.body) if (args[name] != null) b[name] = args[name];',
    '    init.headers["content-type"] = "application/json";',
    '    init.body = JSON.stringify(b);',
    '  }',
    '  const res = await fetch(url, init);',
    '  const t = await res.text();',
    '  if (!res.ok) return "HTTP " + res.status + ": " + t.slice(0, 500);',
    '  return t;',
    '}',
    '',
    'logmsg("ready: " + SERVER_INFO.name + " (" + TOOLS.length + " tools)");',
    ''
  ].join("\n");

  function serverName(spec) {
    const base = ((spec.info && spec.info.title) || "api").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return base + "-mcp";
  }

  function mcpServer(spec) {
    spec = normalize(spec);
    const ts = tools(spec);
    const base = baseUrl(spec) || "https://api.example.com";
    const info = { name: serverName(spec), version: (spec.info && spec.info.version) || "1.0.0" };
    const compact = ts.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, method: t.method, path: t.path, query: t.query, pathParams: t.pathParams, body: t.body }));
    const header = [
      "#!/usr/bin/env node",
      "// MCP server generated by Portal (zero dependencies, Node 18+).",
      "// Run:  node " + info.name + ".mjs",
      "// If the API needs auth, set API_TOKEN in the environment (sent as a Bearer token).",
      "// Speaks MCP over stdio: initialize, tools/list, tools/call.",
      ""
    ].join("\n");
    const consts = [
      "const BASE = " + JSON.stringify(base) + ";",
      "const SERVER_INFO = " + JSON.stringify(info) + ";",
      "const TOOLS = " + JSON.stringify(compact, null, 2) + ";",
      ""
    ].join("\n");
    return header + consts + RUNTIME;
  }

  function claudeConfig(spec) {
    const name = serverName(spec);
    const cfg = { mcpServers: {} };
    cfg.mcpServers[name] = { command: "node", args: ["/absolute/path/to/" + name + ".mjs"], env: { API_TOKEN: "your-token-here-if-needed" } };
    return JSON.stringify(cfg, null, 2);
  }

  // ---------- readiness gauge (shared SVG instrument, browser-only) ----------
  function gradeColor(score) {
    return score >= 90 ? "var(--good)" : score >= 75 ? "var(--signal)" : score >= 55 ? "var(--amber)" : "var(--bad)";
  }

  // Returns SVG markup for the gauge. Renders hidden; call animateGauge() to draw it in.
  function gauge(score, grade, color) {
    score = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    const R = 78, cx = 100, cy = 100, r1 = 63, r2 = 70;
    const rad = (d) => (d * Math.PI) / 180;
    const pt = (d, r) => [(cx + r * Math.cos(rad(d))).toFixed(2), (cy + r * Math.sin(rad(d))).toFixed(2)];
    const [sx, sy] = pt(135, R), [ex, ey] = pt(45, R);          // 270deg arc, gap at bottom
    const arc = "M " + sx + " " + sy + " A " + R + " " + R + " 0 1 1 " + ex + " " + ey;
    let ticks = "";
    for (let i = 0; i <= 6; i++) {
      const d = 135 + i * 45;
      const [x1, y1] = pt(d, r1), [x2, y2] = pt(d, r2);
      ticks += '<line class="g-tick" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>';
    }
    return '<svg viewBox="0 0 200 200" style="--gc:' + (color || gradeColor(score)) + '">' +
      '<path class="g-track" d="' + arc + '"/>' + ticks +
      '<path class="g-fill" d="' + arc + '" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" data-off="' + (100 - score) + '"/>' +
      '<text class="g-grade" x="100" y="97" text-anchor="middle">' + grade + '</text>' +
      '<text class="g-score" x="100" y="124" text-anchor="middle" data-score="' + score + '">0 / 100</text>' +
      '<text class="g-lbl" x="100" y="139" text-anchor="middle">agent-ready</text></svg>';
  }

  function animateGauge(root) {
    if (!root) return;
    const fill = root.querySelector(".g-fill"), sEl = root.querySelector(".g-score");
    const off = fill ? Number(fill.getAttribute("data-off")) : 0;
    const target = sEl ? Number(sEl.getAttribute("data-score")) : 0;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { if (fill) fill.style.strokeDashoffset = off; if (sEl) sEl.textContent = target + " / 100"; return; }
    requestAnimationFrame(() => { if (fill) fill.style.strokeDashoffset = off; });
    const dur = 1200, t0 = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      if (sEl) sEl.textContent = Math.round(e * target) + " / 100";
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  const Portal = { SAMPLES, METHODS, tools, anthropicTools, audit, llms, mcpServer, claudeConfig, serverName, normalize, baseUrl, gauge, animateGauge, gradeColor };
  if (typeof module !== "undefined" && module.exports) module.exports = Portal;
  else root.Portal = Portal;
})(typeof self !== "undefined" ? self : this);
