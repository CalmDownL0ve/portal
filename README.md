# Portal

**Turn any API into an interface AI agents can use.**

Paste an OpenAPI spec → get a runnable MCP server, agent-readable docs (`llms.txt`), and an
agent-readiness score. Then run a live agent against the generated interface.

This is the **convert** layer — the free, self-serve top of the funnel for a larger product:
managed hosting with programmatic keys + usage metering, and an agent-facing discovery directory.

## Run locally

```bash
cd portal
node server.js        # → http://localhost:4270
```

Zero dependencies (Node 18+ built-ins only). No `npm install`.

- **Landing page:** `/`
- **The tool:** `/app.html`

## Modes

- **Mock mode (default):** works with no setup. The agent playground runs a scripted, deterministic loop.
- **Live mode:** the playground is driven by the real Anthropic API.
  ```bash
  cp .env.example .env      # then add: ANTHROPIC_API_KEY=sk-ant-...
  node server.js
  ```
  The key stays server-side; the browser only talks to `/api/agent`. The generated MCP server reads its
  own token from `API_TOKEN` in its environment. Portal never stores keys.

## Test

```bash
npm test        # generates an MCP server from a sample spec and speaks MCP to it
```

The test boots the generated server and verifies `initialize`, `tools/list`, and `tools/call` over
stdio — proof the generated output is a real, working MCP server.

## Layout

```
server.js            local dev server: static + /api/agent (agent loop) + /api/health
public/
  index.html         landing page
  app.html           the tool
  engine.js          generation core (browser + Node) — the single source of truth
  app.js             tool UI logic
  portal.css         design system
test/mcp-smoke.cjs   protocol test for the generated server
docs/                YC application draft, one-pager, demo scripts
```

## Deploy the free tool (static)

`public/` is fully static and works on GitHub Pages / any static host. The converter, `llms.txt`,
readiness score, and downloads all run client-side; only the live agent playground needs `server.js`
(it falls back to mock mode gracefully when served statically).

```bash
git init && git add -A && git commit -m "Portal v0"
gh repo create portal --public --source=. --push
# then enable Pages: Settings → Pages → deploy from branch (root of /public or use a docs/ setup)
```

## Roadmap

- **Host:** swap mocked tool responses for a real proxy to the spec's `servers[0].url`, add per-key
  metering + rate limits, issue keys programmatically.
- **Discover:** a directory where agents find agent-ready APIs.
- Broader inputs beyond OpenAPI JSON (YAML, GraphQL, "point at your docs").
