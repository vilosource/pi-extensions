> **Re-homed 2026-05-08:** This research brief was originally drafted in the pi-mono fork at
> [`vilosource/pi-mono#research/usage-tracking-dashboard`](https://github.com/vilosource/pi-mono/tree/research/usage-tracking-dashboard/docs/research)
> while the `vilosource/pi-extensions` repo did not yet exist. This is now the canonical location.
> The original branch on the pi-mono fork is left in place as historical record.
>
> Subsequent strategy decisions (mono-repo layout, Grafana + Postgres dual backend) live in
> [`docs/strategy/`](../strategy/). The implementation design is in
> [`docs/design/pi-usage-reporter-DESIGN.md`](../design/pi-usage-reporter-DESIGN.md).

# Usage Tracking & Multi-User Dashboard for pi-mono — Research Brief

**Date:** 2026-05-08
**Status:** Research — informs design of a pi extension that ships per-developer usage telemetry to a centralized company dashboard
**Workspace:** `pi-dev`
**Goal:** Build a pi extension that tracks token usage, cost, and model attribution per developer and posts it to a remote multi-user dashboard for our company. All developers use pi-mono as the harness.

## TL;DR

pi-mono already produces, on every assistant turn, a complete `Usage` object (input / output / cacheRead / cacheWrite tokens + per-bucket and total cost) attached to each `AssistantMessage` and persisted to `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. The repo ships a [`scripts/cost.ts`](../../scripts/cost.ts) reference parser. **The data is already there; the work is in shipping it off-machine in real time and aggregating it across developers.**

The field has converged on a clear pattern for this exact problem (Claude Code did it first, ccusage built the de-facto tooling, and the **OpenTelemetry GenAI semantic conventions** are now the standard wire format). For our extension we recommend:

1. **Hook into `message_end` and `session_shutdown`** to emit a structured event per assistant turn.
2. **Use OTel GenAI semantic conventions** for the wire format — specifically `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens`, with `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`. This is exactly what Claude Code emits and what every observability backend speaks.
3. **OTLP/HTTP** as the transport (works everywhere, no extra deps in the extension).
4. **Server side: don't rebuild ccusage** — adopt the architecture pattern of `RyanTech00/claude-telemetry` (lightweight agent → central DB → web dashboard) but wire it for pi sessions rather than `~/.claude/`. There is also `@ccusage/pi` — a community pi-agent analyzer we should treat as a reference.
5. **Dashboard backend** is a small fast-API/Express service writing to Postgres (LiteLLM's `LiteLLM_SpendLogs` schema is a good crib) plus a thin React/Svelte UI. Or, if we want zero custom UI, point the OTel collector at Grafana + Prometheus and ship pre-built panels (Sealos has open-source Grafana JSON for the CC-equivalent).

This brief documents what pi-mono already records, what the field is doing, and a concrete extension shape we can implement.

## How this research was conducted

All claims below are taken from pages fetched on 2026-05-08 plus direct inspection of the pi-mono source tree at `~/pi-mono`. Sources are cited inline. Raw extracts saved to `/tmp/research-usage/*.txt` for the duration of the producing session.


## 1. What pi-mono already tracks (and where)

### 1.1 The `Usage` type

In [`packages/ai/src/types.ts`](../../packages/ai/src/types.ts):

```ts
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}
```

### 1.2 Per-message attribution

Every `AssistantMessage` in pi-mono carries the full provenance needed to attribute spend:

```ts
export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;          // e.g. "anthropic-messages", "openai-completions", ...
  provider: Provider; // e.g. "anthropic", "openai", "openrouter", ...
  model: string;     // e.g. "claude-opus-4-6-20250911"
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}
```

So **per-turn we already have**: provider, model, api, all four token buckets, all four cost buckets, total cost, stop reason, timestamp. Nothing to compute on the client beyond what pi-mono already does.

### 1.3 Cost calculation

In [`packages/ai/src/models.ts`](../../packages/ai/src/models.ts):

```ts
export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
  usage.cost.input      = (model.cost.input      / 1_000_000) * usage.input;
  usage.cost.output     = (model.cost.output     / 1_000_000) * usage.output;
  usage.cost.cacheRead  = (model.cost.cacheRead  / 1_000_000) * usage.cacheRead;
  usage.cost.cacheWrite = (model.cost.cacheWrite / 1_000_000) * usage.cacheWrite;
  usage.cost.total      = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  return usage.cost;
}
```

Per-million-token rates live on the `Model` definitions in `models.generated.ts`. **No extra pricing service is needed for any provider pi-mono already supports.**

### 1.4 On-disk session format

Sessions live at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`, where `<encoded-cwd>` replaces `/` with `-` and brackets with `--`. Example:

```
~/.pi/agent/sessions/--home-jasonvi-pi-mono--/2026-03-13T13-34-38-629Z_52913a8b-...jsonl
```

Each line is a structured event. Per `scripts/cost.ts` line 88-104 the relevant entries look like:

```json
{
  "type": "message",
  "timestamp": "<iso>",
  "message": {
    "role": "assistant",
    "provider": "anthropic",
    "model": "...",
    "usage": { "input": 123, "output": 45, "cacheRead": 12, "cacheWrite": 0,
               "totalTokens": 180,
               "cost": { "input": 0.0042, "output": 0.0067, "cacheRead": 0.0001, "cacheWrite": 0, "total": 0.011 } }
  }
}
```

### 1.5 Pi extension events relevant to usage tracking

From [`packages/coding-agent/src/core/extensions/types.ts`](../../packages/coding-agent/src/core/extensions/types.ts):

| Event | When | Useful for |
|---|---|---|
| `session_start` | session begins | open a session record on the dashboard |
| `agent_start` | agent loop starts | mark a turn group |
| `turn_start` / `turn_end` | each turn | atomic unit for usage attribution |
| `message_end` | a message (user / assistant / toolResult) ends | **this is where `usage` becomes final** — primary emit point |
| `agent_end` | loop ends | flush any buffered events |
| `session_shutdown` | pi exits | last-chance flush |
| `model_select` | model changes mid-session | record provider/model switches |
| `session_compact` / `session_before_compact` | conversation compacted | record compaction cost separately |
| `tool_execution_end` | each tool result | optional: per-tool latency/cost attribution |

The `message_end` event hands you the full `AgentMessage` object including the `usage` field, so the extension can simply forward that.

### 1.6 The reference parser

[`scripts/cost.ts`](../../scripts/cost.ts) is the in-repo reference for offline aggregation: walks `~/.pi/agent/sessions/<cwd>/*.jsonl`, filters `type=="message" && role=="assistant" && usage.cost`, groups by day × provider, prints a per-day-per-provider breakdown plus grand total. Useful as a sanity check against whatever we build, and as the basis for a "backfill historical sessions" command.


## 2. The state of the art — what other harnesses do (mid-2026)

### 2.1 ccusage — the de-facto local analyzer

[github.com/ryoppippi/ccusage](https://github.com/ryoppippi/ccusage), 13.9k stars, MIT. Originally built for Claude Code's `~/.claude/projects/*.jsonl`. Now a family of analyzers:

| Package | Target | Notes |
|---|---|---|
| `ccusage` | Claude Code | the original |
| `@ccusage/codex` | OpenAI Codex CLI | GPT-5, 1M context |
| `@ccusage/opencode` | OpenCode | |
| **`@ccusage/pi`** | **pi-agent (us)** | **already exists** — community pi session analyzer |
| `@ccusage/amp` | Amp CLI | tracks credits as well as $ |
| `@ccusage/mcp` | MCP server | exposes ccusage data to Claude Desktop / MCP-compatible tools |

Capabilities (all packages share most of these):

- `daily` / `monthly` / `session` / `blocks` (5-hour billing windows) reports
- `--since` / `--until` filtering, `--breakdown` per-model, `--instances` per-project, `--project <name>`
- `--json` output for piping into other systems
- `statusline` mode — compact one-liner suitable for terminal status bars (Beta)
- `compact` mode for screenshots
- Smart responsive tables (auto-compact under 100 cols)

**Why this matters for us:**

- `@ccusage/pi` already parses pi sessions. Whatever we build should be **compatible with its output schema** so engineers can keep using their favorite local CLI alongside the company dashboard.
- ccusage is purely local. It does not solve cross-machine aggregation. That is exactly the gap our extension fills.

### 2.2 `RyanTech00/claude-telemetry` — the architecture pattern to copy

[github.com/RyanTech00/claude-telemetry](https://github.com/RyanTech00/claude-telemetry). Quote from the README:

> "CLI tools like ccusage and ccost are single-machine. If you use Claude Code across multiple PCs, you have no unified view of your total spending. claude-telemetry solves this with an Elastic/Wazuh-style architecture: a lightweight Python agent on each PC auto-syncs usage data to a central Supabase database, and a React dashboard shows everything aggregated with filters by machine, project, model, and time period."
>
> **"The agent does no custom JSONL parsing — it calls ccusage as the parsing/pricing layer and focuses only on multi-PC aggregation and centralized sync."**

That last sentence is the load-bearing design decision. They reuse the proven parser and add only the sync + dashboard layer.

Their feature set (worth cherry-picking):

- Multi-PC aggregation with per-machine tracking
- Auto-sync daemon (Elastic/Wazuh style)
- Dashboard with charts (Recharts), dark mode, responsive
- 5-hour block tracking with active block card, burn rate, multi-PC timeline
- Plan vs API cost comparison (Pro/Max 5x/Max 20x/Custom)
- Rate limit progress bars (5-hour + weekly windows)
- Project budget tracker with alerts at 90%/100%
- Model mix analysis (Opus/Sonnet/Haiku breakdown)
- Auth via Supabase (magic link login) with email whitelist
- Cloudflare Workers proxy (zero exposed keys in frontend)
- One-line agent install via `cc-telemetry setup`
- Real-time hooks (instant sync on Claude Code SessionEnd + Stop hooks)
- MCP server with 12 tools — query usage data from inside Claude Code
- Insights engine (trend analysis, anomaly detection, cost forecasting)
- Webhook notifications (Discord/Slack alerts)

Stack: Supabase (Postgres + Auth) + Cloudflare Pages + Cloudflare Workers + Python agent.

### 2.3 `m-shirt/claude-code-tracker` — the self-hosted multi-user pattern

[github.com/m-shirt/claude-code-tracker](https://github.com/m-shirt/claude-code-tracker). Self-hosted, multi-user, role-based.

Highlights:

- Backend: Node.js + Express + SQLite (better-sqlite3) + zlib compression
- Auth: JWT + bcrypt; **role-based (admin / user)**
- Frontend: zero build step, vanilla HTML/CSS/JS
- Deployment: Docker
- Per-user JWT token; sync via a single-line `curl ... | node -` command from each developer machine
- Admin can impersonate users ("View Data") and manage data lifecycle
- Backup download / restore / VACUUM all in admin UI
- "First user to register becomes admin" bootstrap pattern

This is closer to what we want: **self-hosted, per-user, no external SaaS dependency**. Stack is overkill for our needs (vanilla HTML is fine but we'd probably want a small SPA), but the auth + sync model is solid.


### 2.4 Anthropic Claude Code's official path: OpenTelemetry GenAI

From [Claude Code Analytics docs](https://code.claude.com/docs/en/analytics):

> "For per-user token counts and cost estimates, **configure OpenTelemetry export.**"

Anthropic ships first-party telemetry export through the **OpenTelemetry GenAI semantic conventions** ([opentelemetry.io/docs/specs/semconv/gen-ai/](https://opentelemetry.io/docs/specs/semconv/gen-ai/)). Enable on the developer machine with:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_TRACES_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://collector.internal:4317
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_METRIC_EXPORT_INTERVAL=10000
```

Then run an OTel Collector + Prometheus + Grafana stack centrally. The Sealos team publishes a one-click template ([sealos.io/products/app-store/grafana-otel](https://sealos.io/products/app-store/grafana-otel)) and a writeup ([sealos.io/blog/claude-code-metrics](https://sealos.io/blog/claude-code-metrics/), Mar 9 2026) with pre-built Grafana panels for the eight CC metrics + five event types.

**Default safety posture:** prompt text is NOT exported by default. `OTEL_LOG_USER_PROMPTS=1` opts in to including prompt content; without it you get just metrics + event metadata (commands, file paths, token counts, costs).

This is the pattern we should follow. **OTel GenAI is the wire format.** It is what every observability backend (Grafana/Prometheus, Datadog, Honeycomb, New Relic, Langfuse, Phoenix, Helicone, signoz) understands without bespoke integration.

### 2.5 LiteLLM — the proxy/gateway model

[LiteLLM](https://docs.litellm.ai/docs/proxy/cost_tracking) takes a fundamentally different approach: developers do not call providers directly, they call a **central proxy** that owns all the API keys and tracks every request in `LiteLLM_SpendLogs` (Postgres). Schema worth borrowing:

```json
{
  "api_key": "fe6b0cab4ff5a5...",      // hashed
  "user": "default_user",                // assigned per request
  "team_id": "e8d1460f-846c-...",        // owns the api_key
  "request_tags": ["jobID:214590", "taskName:run_page_classification"],
  "spend": 0.000002,                     // computed centrally
  "model": "gpt-4o",
  "input_tokens": 1234,
  "output_tokens": 56
  // ...
}
```

LiteLLM also exposes:

- Per-user / per-team / per-tag spend dashboards out of the box at `/ui`
- Budget alerts and hard limits
- Provider fallback / routing
- Virtual keys (per-user key issuance from a single master key)

**Why we should not adopt LiteLLM as our solution but should steal its schema:**

- Inserting a proxy in the request path is invasive — every developer has to repoint pi-mono at it, and it becomes a critical path service we have to operate at zero downtime.
- Pi already supports many providers natively (Anthropic, OpenAI, Google, Bedrock, Copilot, etc.) — re-routing through LiteLLM removes that.
- But the **spend log row shape** is exactly what we want at our backend: `(user, team, key_hash, model, provider, tokens_in/out/cache, cost, tags, timestamp)`. Borrow it.


### 2.6 Langfuse / Phoenix / Helicone — full LLM-observability platforms

From [Langfuse vs Phoenix vs Helicone (2026)](https://open-techstack.com/blog/langfuse-vs-phoenix-vs-helicone-llm-observability-2026/) (Apr 2 2026):

| Tool | Architecture | Best when |
|---|---|---|
| **Phoenix (Arize)** | OTel collector + UI, OpenInference instrumentors | "We already run OpenTelemetry and want zero lock-in." Easiest to host: collector + UI, OTLP/HTTP. |
| **Langfuse** | Tracing + prompt management + eval workflows; Postgres + ClickHouse + Redis + S3 | "We need prompt versioning + eval workflows + tracing in one product." Heavier stack. MIT core; some enterprise modules require commercial license for self-host. |
| **Helicone** | OpenAI-compatible gateway + observability; routing/fallbacks | "We want one OpenAI-compatible API for many providers + routing." Adds critical-path service. AI Gateway is in beta. |

The key insight from the comparison guide:

> "Almost all 'which tool should we use?' debates collapse to one choice: **Instrumentation-first (OpenTelemetry)** vs **Gateway-first (proxy everything).**"

**For our case the answer is OpenTelemetry-first**, because (a) we are not trying to standardize multi-provider access (pi already does that), (b) we do not want a critical-path service, and (c) OTel GenAI is now an open standard and Anthropic has already validated the pattern.

Adopting OTel as the wire format means **we can ship to Phoenix (or our own collector + Postgres) on day one, and switch to Langfuse / Datadog / signoz / Honeycomb later for free.** No vendor lock-in.

## 3. The OpenTelemetry GenAI semantic conventions

This is the contract our extension should emit. From [opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/) and [the Anthropic-specific extension](https://opentelemetry.io/docs/specs/semconv/gen-ai/anthropic/), as of 2026-05-08 (still labeled "Development" status, but used in production by Anthropic):

### 3.1 Required metrics

| Metric name | Type | Unit | What it measures |
|---|---|---|---|
| `gen_ai.client.token.usage` | Histogram | `{token}` | input and output tokens used per operation |
| `gen_ai.client.operation.duration` | Histogram | `s` | wall-clock duration of each GenAI op |
| `gen_ai.client.operation.time_to_first_chunk` | Histogram | `s` | streaming latency to first chunk |
| `gen_ai.client.operation.time_per_output_chunk` | Histogram | `s` | inter-chunk latency |

### 3.2 Required attributes (every metric and span)

| Attribute | Type | Required? | Example values |
|---|---|---|---|
| `gen_ai.operation.name` | string | Required | `chat`, `generate_content`, `text_completion` |
| `gen_ai.provider.name` | string | Required | `anthropic`, `openai`, `gcp.gen_ai`, `gcp.vertex_ai`, `aws.bedrock` |
| `gen_ai.token.type` | string | Required (on token usage) | `input`, `output` |
| `gen_ai.request.model` | string | Conditionally required | `claude-opus-4-6-20250911` |
| `gen_ai.response.model` | string | Recommended | the model that actually answered |

### 3.3 Anthropic / pi-mono mapping (Recommended attributes)

| OTel attribute | pi-mono `Usage` field |
|---|---|
| `gen_ai.usage.input_tokens` | `usage.input` |
| `gen_ai.usage.output_tokens` | `usage.output` |
| `gen_ai.usage.cache_read.input_tokens` | `usage.cacheRead` |
| `gen_ai.usage.cache_creation.input_tokens` | `usage.cacheWrite` |
| `gen_ai.usage.reasoning.output_tokens` | (not yet on `Usage`; some providers expose it) |

**One-line takeaway:** pi-mono's `Usage` interface is already a 1:1 superset of the OTel GenAI Anthropic-extension spec. Mapping is trivial; the cost fields are a pi-mono extension on top.

### 3.4 Span structure (per assistant turn)

```
gen_ai.chat <model>           ← span.name = "{operation.name} {model}"
├── attributes:
│   ├── gen_ai.operation.name      = "chat"
│   ├── gen_ai.provider.name       = "anthropic"
│   ├── gen_ai.request.model       = "claude-opus-4-6-..."
│   ├── gen_ai.response.model      = "claude-opus-4-6-..."
│   ├── gen_ai.usage.input_tokens  = 1234
│   ├── gen_ai.usage.output_tokens = 567
│   ├── gen_ai.usage.cache_read.input_tokens     = 100
│   ├── gen_ai.usage.cache_creation.input_tokens = 0
│   ├── gen_ai.response.finish_reasons = ["stop"]
│   ├── gen_ai.response.id         = <message id>
│   └── gen_ai.conversation.id     = <pi session id>
```

Plus our own `pi.*` extension attributes (see §4.4).


## 4. Proposed extension shape

### 4.1 Package layout

A new pi extension, e.g. `@vilosource/pi-usage-reporter`:

```
pi-usage-reporter/
├── package.json              # bin: usage-reporter; pi.extensions: ["./dist/extension"]
├── src/
│   ├── extension/
│   │   ├── index.ts          # default export (pi: ExtensionAPI) => void
│   │   ├── otel.ts           # OTel SDK init + GenAI span/metric emitter
│   │   ├── buffer.ts         # in-memory queue + on-disk WAL for offline robustness
│   │   ├── identity.ts       # who am I? (env, git config, machine id)
│   │   └── config.ts         # endpoint, headers, opt-in flags
│   ├── cli/
│   │   └── reporter.ts       # `usage-reporter backfill ...` for historical sessions
│   └── shared/
│       └── mapping.ts        # pi Usage → OTel GenAI attribute mapping
└── README.md
```

### 4.2 Hook wiring

```ts
export default function (pi: ExtensionAPI): void {
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  const ident = resolveIdentity();          // {userId, machineId, team}
  const otel = initOtel(cfg.endpoint, cfg.headers);
  const buffer = new EventBuffer(cfg.walPath);

  pi.on("session_start", (e) => {
    buffer.openSession({ sessionId: pi.session.id, cwd: process.cwd(), ...ident, startedAt: Date.now() });
  });

  pi.on("message_end", (e) => {
    if (e.message.role !== "assistant") return;
    const m = e.message;
    if (!m.usage) return;
    otel.recordTurn({
      sessionId: pi.session.id,
      provider: m.provider,
      model: m.model,
      api: m.api,
      input: m.usage.input,
      output: m.usage.output,
      cacheRead: m.usage.cacheRead,
      cacheWrite: m.usage.cacheWrite,
      cost: m.usage.cost,
      stopReason: m.stopReason,
      timestamp: m.timestamp,
      ...ident,
    });
  });

  pi.on("session_compact", (e) => {
    // separate event — compactions can be expensive, worth tracking
    otel.recordCompaction({ sessionId: pi.session.id, beforeTokens: e.before, afterTokens: e.after, ...ident });
  });

  pi.on("session_shutdown", async () => {
    await buffer.flush(otel);  // last-chance drain
  });
}
```

### 4.3 Wire format — OTel GenAI spans + metrics over OTLP/HTTP

Two parallel streams to the same collector endpoint:

1. **Metrics** (aggregated, low-bandwidth). Exporter: OTLP/HTTP, interval 10-30 s.
   - `gen_ai.client.token.usage` histogram (with attributes per §3.3)
   - `pi.cost.usd` histogram (our extension — see §4.4)
2. **Spans** (per-turn detail). Exporter: OTLP/HTTP, batched.
   - One span per assistant turn (§3.4)
   - One span per session (lifetime), with the turn spans nested by `gen_ai.conversation.id`

Use the standard `@opentelemetry/sdk-node` package. Zero custom transport.

### 4.4 pi-specific extension attributes

The OTel GenAI spec is intentionally cost-agnostic (cost belongs to the operator, not the provider). For our company dashboard we add a small `pi.*` namespace:

| Attribute | Type | Why |
|---|---|---|
| `pi.user.id` | string | who incurred the spend (email or LDAP id) |
| `pi.user.team` | string | for team-level budgeting |
| `pi.machine.id` | string | host fingerprint for multi-machine attribution |
| `pi.session.id` | string | pi session UUID — joins to local JSONL on disk |
| `pi.workspace.cwd` | string | the working directory pi was launched from (= "project" for us) |
| `pi.workspace.repo` | string | git remote URL if available |
| `pi.workspace.branch` | string | git branch if available |
| `pi.cost.input.usd` | double | per-turn input cost |
| `pi.cost.output.usd` | double | per-turn output cost |
| `pi.cost.cache_read.usd` | double | per-turn cache-read cost |
| `pi.cost.cache_write.usd` | double | per-turn cache-write cost |
| `pi.cost.total.usd` | double | per-turn total — what gets summed for the dashboard |
| `pi.stop_reason` | string | `stop` / `length` / `toolUse` / `error` / `aborted` |
| `pi.api` | string | the api dialect used (`anthropic-messages`, `openai-completions`, ...) |

(All `pi.*` are extension-level; they do not collide with any planned `gen_ai.*` field.)

### 4.5 Identity resolution — who is this developer?

Order of precedence for `pi.user.id`:

1. `PI_USAGE_USER_ID` env var (explicit override; for CI/shared accounts).
2. `git config user.email` (most developers have this set).
3. `$USER@$(hostname)` (last-resort fallback).

`pi.user.team` is mapped via a small static lookup: `~/.config/pi-usage/team-map.json` (operator-managed) or, better, returned by the dashboard server based on the user id at the first sync. Avoids hard-coding org structure into developer machines.

`pi.machine.id` is a stable per-machine UUID stored at `~/.config/pi-usage/machine-id` (created once on first run). Allows identifying laptops separately from CI runners under the same user id.

### 4.6 Offline robustness — the WAL

A central dashboard means a network dependency. Developers work on planes, in cafés, on broken VPNs.

Pattern (lifted from OTel collectors and from `claude-telemetry`'s "real-time hooks"):

1. Every event is appended to `~/.cache/pi-usage/wal.jsonl` synchronously **before** OTel emit.
2. OTel SDK's batch span processor handles in-memory buffering with retries.
3. A small reconciler runs at `session_shutdown` and at next `session_start`: replay any WAL entries the collector did not ack.
4. Operator can run `usage-reporter backfill --from <date>` to re-emit any range manually.

Failure mode: collector down → events accumulate in WAL → next successful run drains them. **No usage data lost short of disk failure.**


## 5. Server side — the dashboard

Two viable shapes; we should pick one based on whether we want to own a UI.

### 5.1 Shape A — OTel Collector + Postgres + custom dashboard

```
Developers (pi extension)
        │  OTLP/HTTP
        ▼
┌──────────────────┐    ┌─────────────────┐
│  OTel Collector  │───▶│  Postgres       │   (long-term store; spend-log table)
│  (HA, behind LB) │    └─────────────────┘
│  tail-based      │            ▲
│  sampling, etc.  │            │
└──────────────────┘    ┌───────┴─────────┐
        │              │  API service     │  (Express / FastAPI)
        │  Prometheus  │  + auth (JWT/SSO)│
        ▼  remote-write└──────────────────┘
┌──────────────────┐            ▲
│  Prometheus      │            │
│  (real-time)     │     ┌──────┴──────┐
└──────────────────┘     │  Web UI     │  (React / Svelte SPA)
        │                └─────────────┘
        ▼
┌──────────────────┐
│  Grafana         │  (ops, raw query layer)
└──────────────────┘
```

**Storage rows** (Postgres, schema lifted from LiteLLM `LiteLLM_SpendLogs`):

```sql
CREATE TABLE pi_spend_logs (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL,
  user_id         TEXT NOT NULL,
  team            TEXT,
  machine_id      TEXT NOT NULL,
  session_id      UUID NOT NULL,
  workspace_cwd   TEXT,
  workspace_repo  TEXT,
  workspace_branch TEXT,
  provider        TEXT NOT NULL,
  api             TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INT  NOT NULL,
  output_tokens   INT  NOT NULL,
  cache_read      INT  NOT NULL DEFAULT 0,
  cache_write     INT  NOT NULL DEFAULT 0,
  cost_input_usd     NUMERIC(12,6) NOT NULL,
  cost_output_usd    NUMERIC(12,6) NOT NULL,
  cost_cache_read_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_cache_write_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_total_usd  NUMERIC(12,6) NOT NULL,
  stop_reason     TEXT,
  duration_ms     INT,
  request_tags    TEXT[]
);
CREATE INDEX ON pi_spend_logs (user_id, ts DESC);
CREATE INDEX ON pi_spend_logs (team, ts DESC);
CREATE INDEX ON pi_spend_logs (model, ts DESC);
CREATE INDEX ON pi_spend_logs (workspace_repo, ts DESC);
```

**Dashboard pages (MVP):**

1. **My usage** — your own daily/weekly/monthly $ + tokens, model mix donut, top projects.
2. **Team usage** — same, scoped to your team; leaderboard.
3. **Org usage** (admin) — totals, per-team breakdown, per-model breakdown, anomaly highlights.
4. **Project drill-in** — pick a `workspace_repo`, see who is using it and what it costs.
5. **Session detail** — pick a session, see turn-by-turn cost; useful for "why did this session cost $40".
6. **Budgets & alerts** — set per-user / per-team caps; webhook on threshold.

### 5.2 Shape B — OTel Collector + Grafana (no custom UI)

If we accept Grafana as the UI:

- Collector → Prometheus (metrics) and Loki (events) — both Grafana-native.
- Pre-built Grafana dashboards via JSON, modeled on Sealos' published Claude Code panels.
- Ship a small CLI (`usage-reporter dashboard install`) that POSTs the dashboard JSON to a Grafana instance.
- **Time to MVP: roughly one week.** No frontend code.

Trade-off: Grafana is great for ops but not great for "engineering managers viewing leaderboards." We can always add Shape A later — the collector + Postgres remain the durable substrate.

**Recommendation: build A from the start, with B as the immediate-internal-ops view.** They share the collector, Postgres, and OTel attribute schema; the only thing duplicated is the rendering.

### 5.3 Auth and access model

Three roles:

| Role | Sees |
|---|---|
| `developer` | own usage only |
| `team_lead` | own + team |
| `admin` | everything; can edit team mappings, set budgets |

Auth: SSO via the company IdP (Google Workspace / Okta / Entra). Issue a per-developer agent token (long-lived JWT) at first login; that token goes in `OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>` on the developer machine.

### 5.4 Privacy and safety

Mirroring Anthropic's stance from §2.4:

- **Prompt content never leaves the machine.** Default behavior. Period.
- **Tool arguments and tool outputs never leave the machine.** Default behavior.
- We export only: tokens, costs, model id, provider, stop reason, timestamps, session ID, workspace metadata (cwd / repo / branch), and identity.
- Workspace `cwd` paths can be sensitive (project codenames). Provide `PI_USAGE_REDACT_PATHS=1` to hash the cwd to an opaque project id at the developer machine; reverse mapping is per-user, server side, opt-in.
- All transport is TLS. Tokens at rest are bcrypt-hashed (LiteLLM pattern: store only the hash, show prefix in UI).


## 6. Build vs. adopt — what we should and should not write

| Component | Build / Adopt | Why |
|---|---|---|
| Per-turn data extraction | **adopt pi events** | `message_end` already gives us the full `Usage` object |
| Pricing / cost calc | **adopt pi-mono** | already done in `calculateCost()` from `models.generated.ts` |
| Local on-disk format | **adopt pi-mono** | sessions live at `~/.pi/agent/sessions/...`, already JSONL |
| Local CLI analyzer | **adopt `@ccusage/pi`** | community-maintained, already shipped, npm-installable |
| Wire format | **adopt OTel GenAI** | open standard; everyone speaks it |
| OTel SDK | **adopt `@opentelemetry/sdk-node`** | reference implementation, batched, robust |
| Backfill from JSONL | **build small** | tiny script that walks `~/.pi/agent/sessions/` and re-emits events |
| Server: ingest | **adopt OTel Collector** | battle-tested, supports tail-sampling, auth, rate limits |
| Server: store | **adopt Postgres** | spend-log table is small (rows are ~200 bytes); years of data fit |
| Server: API | **build small** | Express or FastAPI; ~500 LOC for the dashboard endpoints |
| Server: UI | **build SPA** | the differentiator vs ccusage; per-team / per-org views |
| Ops dashboard | **adopt Grafana** | pre-built panels modeled on Sealos' open-source CC dashboards |

**Estimated total to a usable v1:**

- Extension: ~600 LOC TypeScript
- Backfill CLI: ~150 LOC TypeScript
- Server (ingest + API): ~800 LOC
- SPA dashboard: ~1500 LOC
- Grafana JSON: copy from existing CC dashboards, swap metric names

## 7. Open questions to resolve before implementation

1. **Where does the OTel Collector run?** On-prem (k8s in our infra) or managed (Grafana Cloud free tier supports OTLP)? Both work; affects ops burden.
2. **Single-tenant vs multi-tenant ingest?** Per-team collectors (clean blast radius, more ops) or one big collector with tenant routing (cheaper, must enforce auth strictly).
3. **Real-time push vs batched pull?** OTel default is push (developer machine → collector). Alternative: developer machine writes only to local WAL, a central scraper pulls from each developer machine periodically. **Push is simpler and matches the field; default to push.**
4. **What about pi-mom?** mom (the Slack bot harness) uses the same `pi-ai`/`pi-agent-core` stack. Same extension *should* work in mom because the hook contract is identical — should be tested as part of v1.
5. **Multi-tenant identity for the dashboard.** SSO is mandatory; pick one IdP integration first (Google or Entra) and ship.
6. **Per-provider quirks.** Bedrock cost reporting can include "service tier" metadata; OpenRouter routes through other providers and re-attributes. Need to validate that our pi-mono `Usage` field actually reflects upstream-billed cost in those cases. (The pi-mono knowledge area in mykb already lists a related fix: "capture usage from `choice.usage` for non-standard OpenAI-compatible providers", commit `45354153`.)
7. **Compaction events.** A `session_compact` doubles input cost briefly. Should this be reported as a regular turn or as its own line item? Recommend separate event with `pi.event.kind=compaction`.
8. **Sub-agent attribution.** When (if) sub-agents land in pi, do we want to attribute their usage to the parent session or surface it separately? Plan for a `pi.parent.session_id` attribute now.
9. **Cost-vs-billed-cost reconciliation.** Provider invoices arrive monthly and rarely match local estimates exactly (rounding, plan discounts, free-tier credits). Provide an admin reconciliation view that shows local-estimated vs invoiced delta per provider.

## 8. Phased delivery

| Phase | Deliverable | LOC est. |
|---|---|---|
| **0.1 Spike** | Extension that emits OTel GenAI spans to a local Jaeger; manual Postgres + Grafana | ~300 |
| **0.2 MVP backend** | Collector → Postgres ingest service; "My usage" SPA page with SSO | ~1500 |
| **0.3 Multi-user** | Roles (developer/team_lead/admin); team mapping; team & org views | ~600 |
| **0.4 Robustness** | WAL + replay; backfill CLI; per-machine identity; offline tests | ~400 |
| **0.5 Budgets & alerts** | Per-user/team budgets; webhook (Slack) notifications at threshold | ~300 |
| **0.6 Plugin parity** | Grafana JSON dashboards; statusline component for pi (compact in-terminal hint) | ~200 |
| **1.0 Hardening** | Reconciliation view; data export; retention policy; redaction options | ~400 |

## 9. Reading list

In recommended order for whoever picks up implementation:

1. [pi-mono `scripts/cost.ts`](../../scripts/cost.ts) — the in-repo reference parser; everything we need to know about the data shape
2. [pi-mono `packages/ai/src/types.ts` Usage / AssistantMessage](../../packages/ai/src/types.ts) — the source schema
3. [pi-mono `packages/ai/src/models.ts` calculateCost()](../../packages/ai/src/models.ts) — the cost formula
4. [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) — the wire format
5. [OpenTelemetry GenAI Anthropic-specific extension](https://opentelemetry.io/docs/specs/semconv/gen-ai/anthropic/) — the recommended attributes incl. cache fields
6. [Anthropic Claude Code Analytics docs](https://code.claude.com/docs/en/analytics) — confirms OTel as the official path
7. [Sealos: Claude Code Metrics Dashboard (Grafana)](https://sealos.io/blog/claude-code-metrics/) — pre-built Grafana panels and stack
8. [`ryoppippi/ccusage`](https://github.com/ryoppippi/ccusage) — the de-facto local analyzer family; **read `@ccusage/pi` source for our case**
9. [`RyanTech00/claude-telemetry`](https://github.com/RyanTech00/claude-telemetry) — multi-PC architecture pattern; reuse parser, add sync layer
10. [`m-shirt/claude-code-tracker`](https://github.com/m-shirt/claude-code-tracker) — self-hosted multi-user pattern; auth + role model
11. [LiteLLM Spend Tracking docs](https://docs.litellm.ai/docs/proxy/cost_tracking) — borrow the `LiteLLM_SpendLogs` schema for our Postgres rows
12. [Langfuse vs Phoenix vs Helicone (2026)](https://open-techstack.com/blog/langfuse-vs-phoenix-vs-helicone-llm-observability-2026/) — decide whether to plug in any of these as an alternative UI
13. [pi-mono extension type definitions](../../packages/coding-agent/src/core/extensions/types.ts) — the full hook surface

## 10. Decisions this document commits to (subject to review)

1. **Wire format: OpenTelemetry GenAI semantic conventions over OTLP/HTTP.** No custom protocol.
2. **Compatible with `@ccusage/pi`.** Our extension does not replace local CLI tools; both can run.
3. **Per-turn emit on `message_end`**, with a session-level span on `session_start` / `session_shutdown`.
4. **Three storage tiers:** OTel Collector (transport) → Postgres (durable spend log, LiteLLM-style schema) → Prometheus + Grafana (real-time ops view).
5. **Custom SPA for the dashboard**, with three roles (developer / team_lead / admin), SSO via the company IdP.
6. **Privacy default:** prompt content, tool args, and tool outputs **never leave the developer machine**. Only tokens, cost, model, provider, stop reason, timestamps, identity, workspace metadata.
7. **Offline robustness via local WAL + backfill CLI.** No usage data lost short of disk failure.
8. **Identity from `git config user.email` by default**, overridable via `PI_USAGE_USER_ID`. Per-machine UUID stored at `~/.config/pi-usage/machine-id`.
9. **Build the extension as a stand-alone npm package** (`@vilosource/pi-usage-reporter`) installable via `pi install`; do not fork pi-mono.
10. **Should also work in pi-mom** out of the box (same hook contract).

---

**Document status:** research brief, not yet a design doc. Next step is to spike phase 0.1 (extension → local Jaeger) to validate the hook payloads end-to-end, then write a focused DESIGN.md per phase.

