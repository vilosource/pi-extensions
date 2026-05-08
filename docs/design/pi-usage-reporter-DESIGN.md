# `@vilosource/pi-usage-reporter` — Design Document

**Document type:** Design
**Status:** Draft for review
**Date:** 2026-05-08
**Owner:** Platform / DevEx
**Repo home:** [`vilosource/pi-extensions`](https://github.com/vilosource/pi-extensions), package `packages/pi-usage-reporter/`
**Companion documents:**
- Research: [`docs/research/usage-tracking-dashboard-RESEARCH.md`](../research/usage-tracking-dashboard-RESEARCH.md)
- Strategy: [`docs/strategy/pi-extensions-monorepo-STRATEGY.md`](../strategy/pi-extensions-monorepo-STRATEGY.md)
- Strategy: [`docs/strategy/dashboard-backend-STRATEGY.md`](../strategy/dashboard-backend-STRATEGY.md)

---

## 1. Problem statement

### 1.1 Context

Our company has standardised on **pi-mono** ([github.com/badlogic/pi-mono](https://github.com/badlogic/pi-mono)) as the coding-agent harness for all developers. Every engineer runs `pi` locally, against a mix of model providers (Anthropic, OpenAI, Google, Bedrock, GitHub Copilot, OpenRouter, internal vLLM pods served by `pi-pods`, etc.). The provider mix and the model mix change constantly — both because pi-mono adds providers and because individual developers swap models for different tasks.

Pi-mono already attaches a complete `Usage` object — input / output / cacheRead / cacheWrite tokens, plus per-bucket and total cost in USD — to every `AssistantMessage` and persists it to a per-session JSONL file at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. The repo even ships a reference parser at `scripts/cost.ts` that walks those files and prints a per-day-per-provider breakdown for a single machine.

That is the floor. The ceiling is what we do not have.

### 1.2 What we do not have

We have **no organisation-level visibility** into who is spending what on which models on which projects. Specifically:

1. **No cross-machine aggregation.** A developer running pi on a laptop, a desktop, a remote dev VM, and inside CI containers has four disconnected piles of JSONL files. Nobody — including the developer — has a unified picture of their own spend, let alone the team or the company.
2. **No per-user attribution at the org level.** Provider invoices arrive monthly as a single line item per provider. We cannot tell whether a $4,200 Anthropic bill came from one developer who ran an autonomous overnight agent or from forty developers using normal interactive coding.
3. **No per-project attribution.** We cannot answer "how much did we spend on the *karkkainen* migration this quarter?" without manually grepping every developer's laptop.
4. **No per-team attribution.** Engineering managers cannot see their team's spend, set budgets, or compare cost-per-developer across teams.
5. **No model-mix visibility.** We do not know how much of our spend is Opus vs. Sonnet vs. Haiku vs. GPT-5 vs. local models. We cannot make data-driven decisions about which model defaults to recommend, or where to invest in prompt engineering to drive cache hit rates.
6. **No anomaly detection.** A developer who accidentally leaves an autonomous agent looping overnight against Opus 4.6 produces a $400 bill that nobody notices until the monthly invoice arrives. There is no real-time signal.
7. **No budget enforcement.** Even if we knew, we have no mechanism to alert (let alone cap) per-user or per-team spend.
8. **No cost-vs-billed reconciliation.** Local cost estimates from `pi-mono` (computed from the static `models.generated.ts` price table) drift from actual provider invoices because of plan discounts, free-tier credits, tier metadata (Bedrock service tiers, Vertex PayGo vs priority), routing through OpenRouter, and pricing changes. We have no way to quantify the drift, so we cannot trust either number for capacity planning.
9. **No data residency or audit story.** If a customer or auditor asks "where do you keep records of which AI models touched this project's codebase?", we have no answer.

### 1.3 Concrete user stories

The system we build must support, at minimum, these five primary user stories. They drive every design decision below.

| # | As a... | I want to... | So that... |
|---|---|---|---|
| **U1** | developer | see my own daily / weekly / monthly cost across all my machines, broken down by provider, model, and project | I can self-regulate without having to ssh between hosts and run `cost.ts` four times |
| **U2** | engineering manager | see my team's cost broken down by developer, project, and model, with weekly totals and trend lines | I can identify outliers, justify the AI tooling budget, and have informed conversations with reports |
| **U3** | platform / finance | see org-wide cost per provider, per team, per project, with cost-per-active-developer and month-over-month trend | we can plan capacity, negotiate enterprise contracts with providers, and reconcile against invoices |
| **U4** | platform on-call | get a Slack alert within 15 minutes when a single user crosses 2× their 30-day p95 hourly spend | we can intervene before a runaway agent burns four figures overnight |
| **U5** | security / compliance | export an audit trail of "model X was used on project Y on date Z by developer D" for any range | we can answer customer questionnaires and respect data-residency commitments |

These map onto explicit non-goals (§1.5) — we are deliberately *not* trying to be a full LLM-observability platform.

### 1.4 Constraints

The solution lives inside our specific environment and must respect:

- **C1 — Pi as the only client.** Every developer uses pi-mono; the extension target is the pi extension API. No need to support Claude Code / Cursor / Codex ourselves.
- **C2 — pi-mom on the same stack.** Our Slack bot uses `pi-mom`, which shares the `pi-ai`/`pi-agent-core` core. The same extension must work there with no changes (only the identity becomes "the bot account").
- **C3 — Self-hosted.** Telemetry data leaves developer machines, but it stays inside our infrastructure. No third-party SaaS observability vendor for the data plane. (We can use SaaS for incidental things like Slack webhooks.)
- **C4 — Privacy floor.** Prompt content, tool arguments, tool outputs, file contents, and shell command output **MUST NOT leave the developer machine**, ever, by default. Configurable opt-in for individual developers who want fuller traces in their personal view, but never as a default.
- **C5 — Offline tolerant.** Developers work on planes, in cafés, on broken VPNs. Telemetry must not block pi, must not lose data when the collector is unreachable, and must catch up on next online run.
- **C6 — Zero added latency on the hot path.** Pi is interactive. Adding even 50 ms to each turn would be felt. Our hook handlers must be non-blocking (fire-and-forget into a buffer; flush on a timer or on session end).
- **C7 — One-line install.** Developers should adopt this with `pi install <something>` and a single env var (the dashboard URL). If installation requires more than two manual steps, adoption will be uneven and we will lose the cross-org-visibility benefit.
- **C8 — Compatible with the existing local CLI ecosystem.** [`@ccusage/pi`](https://www.npmjs.com/package/@ccusage/pi) already exists and developers already use it locally. Our extension must coexist; we do not break or replace local tools.
- **C9 — No fork of pi-mono.** Distribute as a separate npm package, in the `vilosource/pi-extensions` monorepo (per the [monorepo strategy](../strategy/pi-extensions-monorepo-STRATEGY.md)). pi-mono is updated weekly and merge cost would dominate.
- **C10 — Use the existing company Grafana for the ops view.** Per the [dashboard backend strategy](../strategy/dashboard-backend-STRATEGY.md) — no new platform to operate for ops dashboards and alerting.

### 1.5 Non-goals

We are deliberately not solving:

- **NG1** — Full LLM observability (prompt traces, tool-call traces, eval workflows). Tools like Langfuse, Phoenix, Helicone exist for that. We are tracking *spend and adoption*, not debugging individual LLM calls.
- **NG2** — Provider routing or fallback. That is a gateway concern (LiteLLM, Helicone Gateway). Pi-mono already does multi-provider; we are not inserting ourselves in the request path.
- **NG3** — Hard budget enforcement (i.e. blocking calls when a budget is exceeded). Out of scope for v1; v1 is observability + alerts only. v2 may add soft caps.
- **NG4** — Cross-org / multi-tenant SaaS. We are building this for one company. The schema permits a `tenant_id` for future use, but we are not selling it.
- **NG5** — Reconciliation against provider invoices as a closed loop. v1 surfaces local cost estimates; finance can manually compare to invoices. v2 may add an admin reconciliation view.
- **NG6** — Replacing `@ccusage/pi`. Local CLI tools remain; the extension is additive.
- **NG7** — Tracking non-pi LLM usage (e.g. ChatGPT web, GitHub Copilot inside VS Code, ad-hoc curl scripts). Out of scope; this system only sees what flows through pi-mono.

### 1.6 Success criteria

We will know v1 has succeeded when:

- **S1** — 90% of active pi developers have the extension installed and reporting within four weeks of GA.
- **S2** — A new developer can install the extension, point it at the dashboard, see their own usage, in under five minutes.
- **S3** — The extension adds < 5 ms per turn measured at p95 to pi's perceived latency (specifically: time between LLM stream end and pi returning control to the user).
- **S4** — Telemetry survives a 24-hour collector outage with zero data loss measured against the local pi session JSONL files.
- **S5** — Engineering managers (target: 100% of EMs) can answer "what did my team spend on AI last month, broken down by developer and project?" without filing a ticket.
- **S6** — At least one anomaly alert fires correctly per month on average and is acknowledged as useful by on-call.


## 2. High-level architecture

The system has three concentric layers: every developer machine, our infrastructure, and the consumers of the data. Per the [dashboard backend strategy](../strategy/dashboard-backend-STRATEGY.md), the Collector fans out to two backends — Grafana for ops, Postgres for per-user/finance/audit.

```mermaid
flowchart LR
  subgraph dev["Developer machine"]
    pi["pi / pi-mom / CI runner"]
    ext["pi-usage-reporter\nextension"]
    wal[("~/.cache/pi-usage/\nwal.jsonl")]
    pi -->|hooks| ext
    ext -->|append| wal
  end

  ext -->|"OTLP/HTTP\nbatched, TLS, bearer"| col

  subgraph infra["Our infrastructure"]
    direction TB
    col["OTel Collector\n(HA pair behind LB)"]
    pg[("Postgres\npi_spend_logs\n24mo hot")]
    mimir[("Mimir / Prometheus\n90d rolling")]
    tempo[("Tempo\n14d traces")]
    api["Pi Usage API\nSSO + REST + SSE"]
    spa["Pi Usage Dashboard SPA"]
    graf["Grafana\n(existing company instance)"]
    api --> spa
    col --> pg
    col --> mimir
    col --> tempo
    pg --> api
    mimir --> graf
    tempo --> graf
  end

  graf -.->|alerts| slack["Slack / on-call"]
  api  -.->|alerts| slack
```

### 2.1 The pieces, by responsibility

| Piece | Location | Responsibility | Tech |
|---|---|---|---|
| **pi-usage-reporter extension** | every developer machine, inside pi process | hook into pi events; convert `Usage` to OTel attributes; emit OTLP; persist WAL | TypeScript, npm package, `@opentelemetry/sdk-node` |
| **WAL** | `~/.cache/pi-usage/wal.jsonl` | hold unsent events through outages | append-only JSONL |
| **OTel Collector** | k8s in our infra (HA pair behind LB) | terminate TLS, validate auth, sample, route, batch, fan out | `otel/opentelemetry-collector-contrib` |
| **Postgres** | k8s in our infra | durable spend log; team / user / budget tables | Postgres 16 |
| **Mimir / Prometheus** | k8s, **existing company stack** | rolling 90-day metric store for Grafana / alerts | Mimir or Prometheus + remote-write from Collector |
| **Tempo** | k8s, **existing company stack** | per-turn span store for "show me this session" | Tempo or any OTLP-compatible trace store |
| **Pi Usage API** | k8s in our infra | REST + SSE; SSO + RBAC; renders aggregations | Node + Express + `pg` |
| **Pi Usage Dashboard SPA** | served by API | the human UI for per-user/team/finance | Svelte + Tailwind |
| **Grafana** | **existing company instance** | ops + power-user view; pre-built JSON dashboards we ship | Grafana OSS |

### 2.2 Key data-flow rules

- **Pi events → extension is in-process and synchronous.** The extension's hook handler does its work in microseconds: format an event, append to WAL, hand to OTel SDK batch processor. It does not block on network.
- **Extension → Collector is asynchronous, batched, retried.** OTel SDK handles this. Default batch interval 10 s, max 512 spans per batch.
- **Collector → backends are independent.** Each exporter (Postgres, Prometheus remote-write, OTLP-to-Tempo) succeeds or fails independently. The Collector queues to its own disk WAL if any backend is down.
- **API reads only from Postgres.** Mimir is for Grafana and Grafana Alerting; the SPA does not query it directly. This keeps the SPA simple and its query patterns predictable.
- **Real-time alerts go through Grafana Alerting** for v1, routed through existing Slack / on-call. Custom alert rules in the API are deferred until we have a need Grafana can't meet.

### 2.3 Hook lifecycle — what happens on each pi assistant turn

This shows the per-turn hot path. The synchronous portion (steps 1-5) completes in well under 1 ms; the asynchronous portion (steps 6-9) runs in the background and never blocks the user.

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant Pi as pi (agent loop)
  participant Ext as pi-usage-reporter
  participant WAL as Local WAL
  participant SDK as OTel SDK (in-process)
  participant Col as OTel Collector
  participant DB as Postgres + Mimir + Tempo

  U->>Pi: input
  Pi->>Pi: stream LLM response
  Pi-->>Ext: message_end (AssistantMessage with usage)
  Ext->>WAL: append event (sync, < 1 ms)
  Ext->>SDK: recordTurn (sync, hand to batch processor)
  Note over Pi: Pi returns control to user immediately
  rect rgb(240, 248, 255)
    Note right of SDK: Asynchronous, batched
    SDK->>Col: OTLP batch (every 10 s, or 512 events)
    Col->>DB: insert row + record metric + write span
    Col-->>SDK: ACK
    SDK->>WAL: write ack/<span-id>
  end
```

### 2.4 WAL state transitions

Each event in the WAL goes through this state machine. The point is that **no event is considered durable in the system until the Collector has acknowledged it** — and until then, the local WAL holds the source of truth.

```mermaid
stateDiagram-v2
  [*] --> Buffered: append on hook
  Buffered --> InFlight: OTel batch flush
  InFlight --> Acked: collector ACK
  InFlight --> Buffered: timeout / retry
  InFlight --> Buffered: collector down (queued by SDK)
  Acked --> Pruned: WAL rotation / backfill checkpoint
  Pruned --> [*]
```


## 3. The extension — `@vilosource/pi-usage-reporter`

### 3.1 Package layout

The extension lives inside the `vilosource/pi-extensions` monorepo at `packages/pi-usage-reporter/`. Layout per the [monorepo strategy](../strategy/pi-extensions-monorepo-STRATEGY.md):

```
packages/pi-usage-reporter/
├── package.json
├── README.md
├── CHANGELOG.md                 (Release Please managed)
├── tsconfig.json
├── src/
│   ├── extension/
│   │   ├── index.ts             # default export — pi entry point
│   │   ├── hooks.ts             # hook handlers
│   │   ├── otel.ts              # OTel SDK init + GenAI emit helpers
│   │   ├── buffer.ts            # WAL + replay
│   │   ├── identity.ts          # who am I + machine id
│   │   ├── workspace.ts         # cwd / repo / branch resolution
│   │   ├── config.ts            # env + ~/.config/pi-usage/config.json
│   │   └── mapping.ts           # pi Usage → OTel GenAI attribute mapping
│   ├── cli/
│   │   ├── reporter.ts          # `pi-usage` bin entry
│   │   └── commands/
│   │       ├── doctor.ts        # health check
│   │       ├── backfill.ts      # replay historical sessions
│   │       ├── status.ts        # local stats; works fully offline
│   │       ├── login.ts         # OAuth device-code → config.json
│   │       ├── logout.ts
│   │       ├── flush.ts
│   │       └── version.ts
│   └── shared/
│       ├── schema.ts            # zod schemas for our pi.* attributes
│       └── version.ts
├── grafana/
│   └── dashboards/
│       ├── pi-usage-overview.json
│       ├── pi-usage-by-team.json
│       └── pi-usage-burn-rate.json
├── test/
│   ├── extension.test.ts        # hook → OTel emit (in-memory exporter)
│   ├── buffer.test.ts           # WAL durability
│   ├── identity.test.ts
│   ├── mapping.test.ts
│   └── workspace.test.ts
└── README.md
```

The `grafana/dashboards/` directory is shipped in the npm package so anyone running Grafana can `grafana-cli dashboard import` them without cloning the repo.

### 3.2 `package.json`

```json
{
  "name": "@vilosource/pi-usage-reporter",
  "version": "0.1.0",
  "type": "module",
  "description": "Per-developer pi-mono token usage and cost telemetry over OpenTelemetry",
  "keywords": ["pi-package", "pi-extension", "opentelemetry", "telemetry", "usage"],
  "license": "MIT",
  "publishConfig": { "access": "public" },
  "files": ["dist", "grafana", "README.md", "CHANGELOG.md"],
  "bin": { "pi-usage": "./dist/cli/reporter.js" },
  "pi": { "extensions": ["./dist/extension"] },
  "scripts": {
    "build": "tsc -b",
    "test":  "vitest run",
    "check": "biome check --write . && tsc --noEmit && vitest run"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.x",
    "@opentelemetry/sdk-node": "^0.x",
    "@opentelemetry/exporter-trace-otlp-http": "^0.x",
    "@opentelemetry/exporter-metrics-otlp-http": "^0.x",
    "@opentelemetry/resources": "^1.x",
    "@opentelemetry/semantic-conventions": "^1.x",
    "zod": "^3.x"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.30.0"
  }
}
```

No native dependencies, no compiled binaries. Per constraint **C7** — easy install.

### 3.3 Internal module relationships

```mermaid
flowchart TB
  index["index.ts<br/>(pi entry point)"]
  cfg["config.ts"]
  ident["identity.ts"]
  hooks["hooks.ts"]
  otel["otel.ts"]
  buffer["buffer.ts"]
  workspace["workspace.ts"]
  mapping["mapping.ts"]

  index --> cfg
  index --> ident
  index --> buffer
  index --> otel
  index --> hooks

  hooks --> buffer
  hooks --> otel
  hooks --> workspace
  hooks --> ident

  otel --> mapping
  otel --> ident
```

### 3.4 Extension entry point

```ts
// src/extension/index.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { resolveIdentity } from "./identity.js";
import { initOtel } from "./otel.js";
import { EventBuffer } from "./buffer.js";
import { wireHooks } from "./hooks.js";

export default function (pi: ExtensionAPI): void {
  const cfg = loadConfig();
  if (!cfg.enabled) return;

  const ident  = resolveIdentity(cfg);
  const buffer = new EventBuffer(cfg.walPath);
  const otel   = initOtel(cfg, ident);

  wireHooks(pi, otel, buffer, ident, cfg);

  // Drain anything the WAL had from previous runs.
  void buffer.replay(otel);
}
```

### 3.5 Hook wiring (the contract with pi)

The full hook surface we use, with the rationale for each:

| Pi event | Why we hook it | Sync work | Async work |
|---|---|---|---|
| `session_start` | open a session-level span; resolve workspace metadata once | resolve workspace, append session-open event to WAL | start session span |
| `message_end` | the only place per-turn `usage` is final | append turn event to WAL | record OTel span + metrics |
| `session_compact` | compactions double-charge input tokens; track separately | append compaction event to WAL | record OTel span |
| `model_select` | dev switched model mid-session — record the boundary | append model-change event | none |
| `session_shutdown` | last-chance flush; close session span | nothing | flush OTel batch processor (5 s timeout); checkpoint WAL |

Sketch:

```ts
// src/extension/hooks.ts
export function wireHooks(pi, otel, buffer, ident, cfg) {

  pi.on("session_start", () => {
    const meta = {
      sessionId: pi.session.id,
      startedAt: Date.now(),
      cwd:       process.cwd(),
      ...resolveWorkspace(),
      ...ident,
    };
    buffer.openSession(meta);
    otel.startSessionSpan(meta);
  });

  pi.on("message_end", (e) => {
    if (e.message.role !== "assistant") return;
    const m = e.message;
    if (!m.usage) return;
    const event = {
      kind: "turn",
      sessionId: pi.session.id,
      provider:  m.provider, api: m.api, model: m.model,
      usage: m.usage, stopReason: m.stopReason, timestamp: m.timestamp,
      ...ident,
    };
    buffer.append(event);              // sync, < 1 ms
    otel.recordTurn(event);            // hands to batch processor
  });

  pi.on("session_compact", (e) => {
    const event = {
      kind: "compaction",
      sessionId: pi.session.id,
      beforeTokens: e.before?.totalTokens,
      afterTokens:  e.after?.totalTokens,
      timestamp: Date.now(),
      ...ident,
    };
    buffer.append(event);
    otel.recordCompaction(event);
  });

  pi.on("session_shutdown", async () => {
    otel.endSessionSpan(pi.session.id);
    await otel.flush();                // 5 s timeout
    await buffer.checkpoint();         // mark drained as ackable
  });
}
```

**Latency budget** (per constraint **C6**, **S3**): the synchronous portion of `message_end` must complete in < 1 ms p95. WAL append is a `fs.appendFileSync` of ~400 bytes; OTel `recordTurn` is a function call that places the span into the batch processor's in-memory queue. Both well under 1 ms on every machine we care about.


### 3.6 Identity resolution

Resolution happens once at extension init, in this priority order:

```mermaid
flowchart TB
  start([extension init]) --> env{"PI_USAGE_USER_ID<br/>set?"}
  env -->|yes| use_env["use env value"]
  env -->|no| git{"git config<br/>user.email set?"}
  git -->|yes| use_git["use git email"]
  git -->|no| fallback["use ${USER}@${hostname}<br/>(flagged 'unverified')"]
  use_env --> machine
  use_git --> machine
  fallback --> machine
  machine{"~/.config/pi-usage/<br/>machine-id exists?"}
  machine -->|yes| read["read existing UUID"]
  machine -->|no| create["crypto.randomUUID()<br/>persist"]
  read --> done([identity ready])
  create --> done
```

`pi.user.team` is **not** resolved on the developer machine. The Collector or API side maps `user.id → team` from a server-managed table (see §6.4). This avoids leaking org structure to dotfiles and avoids stale team mappings on every laptop.

`pi.machine.id` is intentionally a random UUID — **not** based on any hardware identifier. We do not want the appearance of fingerprinting, and we want machines to be re-pairable with new physical hosts (`rm machine-id` and let it regenerate).

### 3.7 Workspace resolution

Per session we resolve four attributes, then cache them for the rest of the session.

| Attribute | How |
|---|---|
| `pi.workspace.cwd` | `process.cwd()` |
| `pi.workspace.repo` | `git -C $cwd config --get remote.origin.url`, normalised to `host/owner/name` |
| `pi.workspace.branch` | `git -C $cwd rev-parse --abbrev-ref HEAD` |
| `pi.workspace.is_ci` | inferred from `CI` / `GITHUB_ACTIONS` / `GITLAB_CI` env vars |

If `PI_USAGE_REDACT_PATHS=1`, `cwd` is hashed (BLAKE3 truncated to 16 hex chars) and `repo`/`branch` are dropped. Server side keeps a per-user reverse map only if the user opts in via the dashboard; otherwise the hash is opaque even to admins.

### 3.8 OTel emission

```ts
// src/extension/otel.ts (sketch)
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter }  from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { trace, metrics } from "@opentelemetry/api";

export function initOtel(cfg, ident) {
  const resource = new Resource({
    "service.name":           "pi-usage-reporter",
    "service.version":        VERSION,
    "deployment.environment": cfg.environment,
    "pi.user.id":             ident.userId,
    "pi.machine.id":          ident.machineId,
  });

  const exporters = cfg.endpoints.map((endpoint, i) => ({
    traces:  new OTLPTraceExporter({  url: `${endpoint}/v1/traces`,  headers: cfg.headersFor(i) }),
    metrics: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers: cfg.headersFor(i) }),
  }));

  // Multi-endpoint: register one exporter per endpoint via a multi-span-processor.
  // For most installs there is exactly one endpoint.

  const sdk = new NodeSDK({ resource, /* ... */ });
  sdk.start();

  const tracer = trace.getTracer("pi-usage-reporter");
  const meter  = metrics.getMeter("pi-usage-reporter");

  const tokensHist = meter.createHistogram("gen_ai.client.token.usage", { unit: "{token}" });
  const costHist   = meter.createHistogram("pi.cost.usd",                 { unit: "USD"   });

  function recordTurn(e) {
    const attrs = turnAttributes(e);
    const span = tracer.startSpan(`chat ${e.model}`, { attributes: attrs, startTime: e.timestamp });
    span.end();
    tokensHist.record(e.usage.input,  { ...attrs, "gen_ai.token.type": "input" });
    tokensHist.record(e.usage.output, { ...attrs, "gen_ai.token.type": "output" });
    if (e.usage.cacheRead)  tokensHist.record(e.usage.cacheRead,  { ...attrs, "gen_ai.token.type": "cache_read" });
    if (e.usage.cacheWrite) tokensHist.record(e.usage.cacheWrite, { ...attrs, "gen_ai.token.type": "cache_creation" });
    costHist.record(e.usage.cost.total, attrs);
  }
  return { recordTurn, recordCompaction, startSessionSpan, endSessionSpan, flush: () => sdk.shutdown() };
}
```

### 3.9 The full attribute schema

Standard OTel GenAI attributes (see [OTel GenAI spec](https://opentelemetry.io/docs/specs/semconv/gen-ai/) and the [Anthropic-specific extension](https://opentelemetry.io/docs/specs/semconv/gen-ai/anthropic/)):

| Attribute | Type | Source |
|---|---|---|
| `gen_ai.operation.name` | string, required | always `"chat"` for pi assistant turns |
| `gen_ai.provider.name` | string, required | from `AssistantMessage.provider`, mapped via §3.10 |
| `gen_ai.request.model` | string | `AssistantMessage.model` |
| `gen_ai.response.model` | string | same |
| `gen_ai.usage.input_tokens` | int | `Usage.input` |
| `gen_ai.usage.output_tokens` | int | `Usage.output` |
| `gen_ai.usage.cache_read.input_tokens` | int | `Usage.cacheRead` |
| `gen_ai.usage.cache_creation.input_tokens` | int | `Usage.cacheWrite` |
| `gen_ai.response.finish_reasons` | string[] | `[stopReason]` |
| `gen_ai.conversation.id` | string | pi session UUID |
| `gen_ai.token.type` | string, on metric only | `"input"` / `"output"` / `"cache_read"` / `"cache_creation"` |

Pi-extension attributes (our namespace):

| Attribute | Type | Source |
|---|---|---|
| `pi.user.id` | string | identity (§3.6) |
| `pi.machine.id` | string | identity |
| `pi.session.id` | string | pi session UUID |
| `pi.workspace.cwd` | string | workspace (§3.7) |
| `pi.workspace.repo` | string | workspace |
| `pi.workspace.branch` | string | workspace |
| `pi.workspace.is_ci` | boolean | workspace |
| `pi.api` | string | `AssistantMessage.api` |
| `pi.cost.input.usd` | double | `Usage.cost.input` |
| `pi.cost.output.usd` | double | `Usage.cost.output` |
| `pi.cost.cache_read.usd` | double | `Usage.cost.cacheRead` |
| `pi.cost.cache_write.usd` | double | `Usage.cost.cacheWrite` |
| `pi.cost.total.usd` | double | `Usage.cost.total` |
| `pi.stop_reason` | string | `AssistantMessage.stopReason` |
| `pi.event.kind` | string | `"turn"` / `"compaction"` / `"session"` |
| `pi.parent.session_id` | string | reserved for future sub-agent attribution |
| `pi.tenant_id` | string | reserved for multi-tenant future |

### 3.10 Provider name mapping

Pi-mono uses its own provider names; OTel GenAI defines canonical ones. Mapping table:

| pi-mono `provider` | OTel `gen_ai.provider.name` |
|---|---|
| `anthropic` | `anthropic` |
| `openai` | `openai` |
| `google` | `gcp.gen_ai` |
| `bedrock` | `aws.bedrock` |
| `azure` | `az.ai.inference` |
| `openrouter` | `openrouter` (extension; not yet canonical — emit as-is) |
| `copilot` | `github.copilot` (extension) |
| `vllm` / `pi-pods` | `vllm` (extension) |
| anything else | passed through as-is, lowercased |


### 3.11 The local WAL

```
~/.cache/pi-usage/
├── wal.jsonl            # active append log
├── wal.jsonl.1          # rotated on size > 10 MB or session_shutdown
├── ack/
│   └── <span-id>        # touch-file when batch ACKed by collector
├── machine-id           # stable UUID
└── config.json          # rare operator overrides
```

Format per line:

```json
{"v":1,"id":"<span-id>","ts":1714000000000,"kind":"turn","session":"<uuid>","payload":{...full event...}}
```

WAL rotation: when `wal.jsonl` > 10 MB, rotate to `wal.jsonl.1` (keep last 5). 10 MB ≈ 25,000 turns ≈ months of normal use; the cap exists only to bound disk for pathological cases (a runaway autonomous agent producing thousands of turns offline).

### 3.12 Configuration

Order of precedence (highest wins):

1. Environment variables (`PI_USAGE_*`).
2. `~/.config/pi-usage/config.json`.
3. Built-in defaults.

The bare-minimum `config.json` for a developer:

```json
{
  "endpoint": "https://otel.internal.viloforge.com",
  "token":    "eyJhbGciOiJIUzI1...",
  "enabled":  true
}
```

Operator-tunable knobs (env vars, all optional):

| Env var | Default | Purpose |
|---|---|---|
| `PI_USAGE_ENABLED` | `true` | master kill switch |
| `PI_USAGE_ENDPOINT` | (required) | OTLP endpoint URL; comma-separated for multi-endpoint emit |
| `PI_USAGE_TOKEN` | (required) | bearer token (single endpoint) |
| `PI_USAGE_HEADERS` | (none) | raw headers `Key=Value;Key2=Value2`; multi-endpoint uses `PI_USAGE_HEADERS_<n>` |
| `PI_USAGE_USER_ID` | git email | identity override |
| `PI_USAGE_REDACT_PATHS` | `0` | hash workspace cwd / drop repo / drop branch |
| `PI_USAGE_BATCH_INTERVAL_MS` | `10000` | OTel batch interval |
| `PI_USAGE_WAL_DIR` | `~/.cache/pi-usage` | WAL location |
| `PI_USAGE_ENVIRONMENT` | `prod` | tag for the dashboard (`prod` / `dev`) |
| `PI_USAGE_VERBOSE` | `0` | log every emission to stderr |

The single-endpoint case (>99% of developers):

```bash
PI_USAGE_ENDPOINT=https://otel.internal.viloforge.com
PI_USAGE_TOKEN=<from `pi-usage login`>
```

The multi-endpoint case (rare; allowed for personal tinkering per [dashboard backend strategy §4](../strategy/dashboard-backend-STRATEGY.md)):

```bash
PI_USAGE_ENDPOINT=https://otel.internal.viloforge.com,https://otlp-gateway-prod-eu-west-2.grafana.net/otlp
PI_USAGE_HEADERS_1='Authorization=Bearer <company token>'
PI_USAGE_HEADERS_2='Authorization=Basic <grafana cloud token>'
```

### 3.13 The `pi-usage` CLI

Bundled in the same package, runnable standalone:

```
pi-usage doctor                # 8-point health check (config, identity, OTel reachability, WAL, git, etc.)
pi-usage status [--days N]     # local stats; works fully offline (reads pi sessions + WAL)
pi-usage backfill [--from D]   # walk pi sessions, re-emit any not in our ack store
pi-usage login                 # OAuth device-code flow against the dashboard; writes config.json
pi-usage logout
pi-usage flush                 # force WAL drain
pi-usage version
```

`doctor` is the primary support tool — when a developer says "I'm not appearing on the dashboard," step one is paste the output of `pi-usage doctor`.


## 4. The OTel Collector

### 4.1 Topology

Two collector pods behind a TCP load balancer (k8s `Service` of type `LoadBalancer`). HA via redundancy, not state — each collector is independent.

```mermaid
flowchart LR
  ext1["Developer 1"] --> lb
  ext2["Developer 2"] --> lb
  ext3["Developer ..."] --> lb
  ciext["CI runners"] --> lb
  lb["k8s LoadBalancer"]
  lb --> col1["Collector pod A"]
  lb --> col2["Collector pod B"]
  col1 --> pg[("Postgres")]
  col2 --> pg
  col1 --> mimir[("Mimir")]
  col2 --> mimir
  col1 --> tempo[("Tempo")]
  col2 --> tempo
```

### 4.2 Pipeline

The Collector has one OTLP receiver and three exporters. Each is enabled or disabled independently — see [dashboard backend strategy §8](../strategy/dashboard-backend-STRATEGY.md).

```mermaid
flowchart TB
  recv["OTLP/HTTP receiver<br/>:4318, TLS, bearer auth"]
  recv --> proc_filter["filter/sanity<br/>drop spans missing pi.user.id"]
  proc_filter --> proc_redact["attributes/redact<br/>strip any prompt/completion/tool args"]
  proc_redact --> proc_team["transform/team_lookup<br/>map pi.user.id → pi.user.team"]
  proc_team --> proc_batch["batch<br/>5 s, 512 spans"]
  proc_batch --> exp_pg["Postgres exporter<br/>→ pi_spend_logs"]
  proc_batch --> exp_prom["prometheusremotewrite<br/>→ company Mimir"]
  proc_batch --> exp_tempo["OTLP exporter<br/>→ company Tempo"]
```

### 4.3 Pipeline config (sketch)

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
        tls: { cert_file: /tls/tls.crt, key_file: /tls/tls.key }
        auth: { authenticator: bearertokenauth }

extensions:
  bearertokenauth:
    scheme: Bearer
    tokens:
      - "${env:PI_USAGE_TOKEN_DEV_TEAM_PLATFORM}"
      - "${env:PI_USAGE_TOKEN_DEV_TEAM_DATA}"

processors:
  filter/sanity:
    error_mode: ignore
    spans:
      span:
        - 'attributes["pi.user.id"] == nil'

  attributes/redact:
    actions:
      - { key: gen_ai.prompt,         action: delete }
      - { key: gen_ai.completion,     action: delete }
      - { key: gen_ai.tool_arguments, action: delete }

  transform/team_lookup:
    # ConfigMap mounted from the API; rebuilt nightly from the users table.

  batch:
    timeout: 5s
    send_batch_size: 512

exporters:
  postgres:
    dsn: "postgres://otel:...@pg-spend:5432/pi_usage?sslmode=require"
    insert: |
      INSERT INTO pi_spend_logs (
        ts, user_id, team, machine_id, session_id,
        workspace_cwd, workspace_repo, workspace_branch, workspace_is_ci,
        provider, api, model,
        input_tokens, output_tokens, cache_read, cache_write,
        cost_input_usd, cost_output_usd, cost_cache_read_usd, cost_cache_write_usd, cost_total_usd,
        stop_reason, event_kind, environment
      ) VALUES (
        $start_time_unix_nano, $pi.user.id, $pi.user.team, $pi.machine.id, $pi.session.id,
        $pi.workspace.cwd, $pi.workspace.repo, $pi.workspace.branch, $pi.workspace.is_ci,
        $gen_ai.provider.name, $pi.api, $gen_ai.request.model,
        $gen_ai.usage.input_tokens, $gen_ai.usage.output_tokens,
          $gen_ai.usage.cache_read.input_tokens, $gen_ai.usage.cache_creation.input_tokens,
        $pi.cost.input.usd, $pi.cost.output.usd, $pi.cost.cache_read.usd, $pi.cost.cache_write.usd, $pi.cost.total.usd,
        $pi.stop_reason, $pi.event.kind, $deployment.environment
      )

  prometheusremotewrite:
    endpoint: ${env:MIMIR_REMOTE_WRITE_URL}
    headers: { Authorization: "Bearer ${env:MIMIR_TOKEN}" }
    resource_to_telemetry_conversion: { enabled: true }

  otlp/tempo:
    endpoint: ${env:TEMPO_OTLP_ENDPOINT}
    headers: { Authorization: "Bearer ${env:TEMPO_TOKEN}" }
    tls: { insecure: false }

service:
  pipelines:
    traces:
      receivers:  [otlp]
      processors: [filter/sanity, attributes/redact, transform/team_lookup, batch]
      exporters:  [postgres, otlp/tempo]
    metrics:
      receivers:  [otlp]
      processors: [filter/sanity, transform/team_lookup, batch]
      exporters:  [prometheusremotewrite]
```

### 4.4 Sampling policy

We do **not** sample. The whole point is per-user attribution; dropping a span drops a developer's spend record. Volume is small (~400 bytes per turn × ~100 turns/day/dev × 200 devs ≈ 8 MB/day uncompressed). Sampling would save us less than the operational complexity costs.

### 4.5 Grafana dashboards shipped in the package

We ship dashboard JSON in `packages/pi-usage-reporter/grafana/dashboards/`. Three to start:

| Dashboard | Purpose | Audience |
|---|---|---|
| `pi-usage-overview.json` | org-wide totals: cost-per-day, model mix, top 10 users, top 10 projects | platform / finance |
| `pi-usage-by-team.json` | per-team rollup with developer drill-down | engineering managers |
| `pi-usage-burn-rate.json` | real-time burn rate per user with anomaly bands; drives Grafana Alerting | on-call |

Import command (once company Grafana has the Mimir + Tempo data sources):

```bash
for f in packages/pi-usage-reporter/grafana/dashboards/*.json; do
  curl -X POST -H "Authorization: Bearer $GRAFANA_TOKEN" \
       -H "Content-Type: application/json" \
       -d @"$f" \
       https://grafana.internal.viloforge.com/api/dashboards/db
done
```

The dashboards are versioned alongside the extension; every release that changes the metric schema bumps the dashboard JSON in lockstep.


## 5. Storage — Postgres schema

### 5.1 Schema overview

```mermaid
erDiagram
  users ||--o{ machine_registry : owns
  users ||--o{ api_tokens : has
  users }o--|| teams : belongs_to
  teams ||--o{ teams : parent
  users ||--o{ pi_spend_logs : authored
  teams ||--o{ pi_spend_logs : "rolled up to"
  pi_spend_logs ||--o{ alert_log : "may trigger"
  budgets ||--o{ alert_log : evaluated_against

  users {
    text user_id PK "email"
    text display_name
    text team FK
    text role "developer|team_lead|admin"
    timestamptz created_at
    timestamptz last_seen_at
    boolean is_disabled
  }
  teams {
    text team_id PK
    text display_name
    text parent_team FK
    text cost_center
    timestamptz created_at
  }
  machine_registry {
    uuid machine_id PK
    text user_id FK
    text hostname_hint
    timestamptz first_seen_at
    timestamptz last_seen_at
  }
  api_tokens {
    uuid token_id PK
    text user_id FK
    text token_hash
    text token_prefix "visible in UI"
    timestamptz created_at
    timestamptz expires_at
    timestamptz revoked_at
  }
  pi_spend_logs {
    bigserial id PK
    timestamptz ts
    text user_id FK
    text team
    uuid machine_id FK
    uuid session_id
    text workspace_repo
    text provider
    text model
    int input_tokens
    int output_tokens
    int cache_read
    int cache_write
    numeric cost_total_usd
    text event_kind
  }
  budgets {
    uuid budget_id PK
    text scope "user|team|org"
    text scope_id
    text period "daily|weekly|monthly"
    numeric limit_usd
    int alert_at_pct
    jsonb notify_via
  }
  alert_log {
    uuid alert_id PK
    timestamptz ts
    text rule
    text scope
    text scope_id
    jsonb payload
    boolean delivered
  }
```

### 5.2 The spend log (DDL)

```sql
CREATE TABLE pi_spend_logs (
  id                   BIGSERIAL    PRIMARY KEY,
  ts                   TIMESTAMPTZ  NOT NULL,
  ingest_ts            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  user_id              TEXT         NOT NULL,
  team                 TEXT,
  machine_id           UUID         NOT NULL,
  session_id           UUID         NOT NULL,
  workspace_cwd        TEXT,
  workspace_repo       TEXT,
  workspace_branch     TEXT,
  workspace_is_ci      BOOLEAN      NOT NULL DEFAULT false,
  provider             TEXT         NOT NULL,
  api                  TEXT         NOT NULL,
  model                TEXT         NOT NULL,
  input_tokens         INT          NOT NULL,
  output_tokens        INT          NOT NULL,
  cache_read           INT          NOT NULL DEFAULT 0,
  cache_write          INT          NOT NULL DEFAULT 0,
  cost_input_usd       NUMERIC(12,6) NOT NULL,
  cost_output_usd      NUMERIC(12,6) NOT NULL,
  cost_cache_read_usd  NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_cache_write_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_total_usd       NUMERIC(12,6) NOT NULL,
  stop_reason          TEXT,
  event_kind           TEXT         NOT NULL DEFAULT 'turn',
  environment          TEXT         NOT NULL DEFAULT 'prod',
  tenant_id            TEXT         NOT NULL DEFAULT 'default'
);

CREATE INDEX pi_spend_logs_user_ts        ON pi_spend_logs (user_id, ts DESC);
CREATE INDEX pi_spend_logs_team_ts        ON pi_spend_logs (team, ts DESC) WHERE team IS NOT NULL;
CREATE INDEX pi_spend_logs_repo_ts        ON pi_spend_logs (workspace_repo, ts DESC) WHERE workspace_repo IS NOT NULL;
CREATE INDEX pi_spend_logs_model_ts       ON pi_spend_logs (model, ts DESC);
CREATE INDEX pi_spend_logs_provider_ts    ON pi_spend_logs (provider, ts DESC);
CREATE INDEX pi_spend_logs_session        ON pi_spend_logs (session_id);
CREATE INDEX pi_spend_logs_ts             ON pi_spend_logs (ts DESC);
```

Row size ≈ 220 bytes uncompressed. At 200 devs × 100 turns/day, **expect ~6 GB/year**. Trivial for Postgres.

### 5.3 Retention and partitioning

- `pi_spend_logs` partitioned monthly via `pg_partman`. Retention: **24 months hot** in Postgres, then archive partitions to S3 as Parquet via `pg_dump` / `COPY`. After 7 years, delete entirely (matches our general business-records retention).
- `alert_log` retained 12 months.
- `users`, `teams`, `machine_registry`, `api_tokens`, `budgets` retained indefinitely; deleted only on explicit operator action.

### 5.4 Materialised views for hot queries

For the dashboard's "today" and "this week" views — by far the hottest queries — a materialised view refreshed every 60 s:

```sql
CREATE MATERIALIZED VIEW mv_recent_spend AS
SELECT
  date_trunc('day', ts) AS day,
  user_id, team, workspace_repo, provider, model,
  SUM(input_tokens)  AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(cache_read)    AS cache_read,
  SUM(cache_write)   AS cache_write,
  SUM(cost_total_usd) AS cost_usd,
  COUNT(*) AS turns
FROM pi_spend_logs
WHERE ts >= now() - INTERVAL '14 days'
GROUP BY 1,2,3,4,5,6;

CREATE INDEX ON mv_recent_spend (day, user_id);
CREATE INDEX ON mv_recent_spend (day, team);
CREATE INDEX ON mv_recent_spend (day, workspace_repo);
```

Refreshed by `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_recent_spend` on a 60 s cron. Similar materialised views at 5 min and 15 min refresh for "month-to-date" and "year-to-date."


## 6. The API and SPA

The API and SPA are scoped to per-user, per-team, per-project, finance, and audit views — i.e. the things Grafana cannot do well (per-row RBAC, finance-grade exports, joins to org tables). Per [dashboard backend strategy §7](../strategy/dashboard-backend-STRATEGY.md), real-time ops dashboards live in Grafana, not the SPA.

### 6.1 Pages

| Page | Audience | Source |
|---|---|---|
| **My usage** | every developer | own rows from `pi_spend_logs` filtered by `user_id` |
| **Team usage** | team_lead+ | team's rows, with developer drill-down |
| **Org usage** | admin | full table, per-team / per-provider rollups |
| **Project drill-in** | team_lead+ | rows filtered by `workspace_repo` |
| **Session detail** | the session's owner + admin | turn-by-turn for one session_id; deep-link from Grafana traces |
| **Budgets & alerts** | admin | CRUD on `budgets`; preview alert log |
| **Audit export** | admin | CSV/Parquet export with date range, scope, optional redaction |
| **Settings** | every developer | manage own machines, tokens, redaction preferences |

### 6.2 RBAC

```mermaid
flowchart TB
  developer["developer<br/>own data only"]
  team_lead["team_lead<br/>own + own team"]
  admin["admin<br/>everything"]

  developer --> myusage["My usage"]
  developer --> mysessions["My sessions"]
  developer --> mysettings["Settings"]

  team_lead --> developer_pages["all developer pages"]
  team_lead --> teamview["Team view"]
  team_lead --> teamsessions["Team sessions"]

  admin --> teamlead_pages["all team_lead pages"]
  admin --> orgview["Org view"]
  admin --> alladmin["Budgets / Audit / Users / Teams"]
```

Enforced server-side by SQL `WHERE` clauses derived from the JWT. No row-level permissions in Postgres — the API is the only writer of WHERE clauses.

### 6.3 Auth flow

```mermaid
sequenceDiagram
  autonumber
  participant Dev as Developer
  participant CLI as pi-usage CLI
  participant API as Pi Usage API
  participant IdP as Company IdP (Entra/Google)

  Dev->>CLI: pi-usage login
  CLI->>API: POST /auth/device/start
  API-->>CLI: device_code, user_code, verification_uri
  CLI-->>Dev: "open <uri>, enter code XXXX-YYYY"
  Dev->>IdP: opens uri, signs in with SSO
  IdP-->>API: OIDC callback (user identity)
  API->>API: lookup or create user; assign team
  loop poll
    CLI->>API: POST /auth/device/poll
  end
  API-->>CLI: long-lived JWT (90 days)
  CLI->>CLI: write ~/.config/pi-usage/config.json
```

Tokens are 90-day JWTs scoped to a user. Revocable from the API admin page. Stored hashed in `api_tokens`; never in plaintext.

### 6.4 Team mapping (resolved server-side, not client-side)

```mermaid
flowchart LR
  ext["extension<br/>(emits pi.user.id only)"]
  col["Collector<br/>transform/team_lookup"]
  cm["ConfigMap<br/>user → team map"]
  api["API<br/>writes ConfigMap nightly<br/>from users table"]
  pg[("Postgres users table")]

  ext --> col
  cm -.->|mounted| col
  pg --> api
  api -->|kubectl apply| cm
```

The Collector reads the user → team map from a Kubernetes ConfigMap. The API regenerates the ConfigMap nightly from the `users` table. This keeps team mapping out of developer dotfiles, avoids stale mappings, and lets us reorganise teams without touching any developer machine.

### 6.5 Tech stack

- **API:** Node 22 + Express + `pg` + `jose` (JWT) + `passport-openidconnect` (SSO).
- **SPA:** Svelte 5 + TailwindCSS 4 + Chart.js (for line and donut charts). No build step heavier than `vite build`.
- **Hosting:** k8s in our infra. Two API pods behind a Service; SPA served as static assets from the API itself (no separate ingress).
- **Database:** the same Postgres cluster the Collector writes to. Read-only role for the API user.


## 7. Privacy and security

### 7.1 What never leaves the developer machine

By default and forever:

- Prompt content
- Tool call arguments
- Tool call results
- File contents
- Shell command output
- Any other free-form text

The extension does not read these fields. They are not in `Usage`. There is no opt-in flag in v1 to ship them, and adding one would require an explicit decision documented in the changelog.

### 7.2 What does leave the developer machine

| Category | Fields | Why |
|---|---|---|
| Identity | `pi.user.id`, `pi.machine.id` | per-user attribution |
| Workspace | `pi.workspace.cwd`, `pi.workspace.repo`, `pi.workspace.branch`, `pi.workspace.is_ci` | per-project attribution; redactable via `PI_USAGE_REDACT_PATHS=1` |
| Model meta | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.response.model`, `pi.api` | model-mix analysis |
| Usage | `gen_ai.usage.*_tokens` | spend analysis |
| Cost | `pi.cost.*.usd` | the whole point |
| Operational | `gen_ai.response.finish_reasons`, `pi.stop_reason`, timestamps | debugging stuck/failed sessions |
| Session | `gen_ai.conversation.id`, `pi.session.id` | join key for per-session detail |

### 7.3 Defence in depth

```mermaid
flowchart LR
  subgraph dev["Developer machine"]
    ext["extension<br/>only emits whitelisted fields"]
    redact["optional path redaction"]
    ext --> redact
  end

  redact -->|TLS, bearer auth| col["Collector"]

  subgraph col_proc["Collector processors"]
    fil["filter/sanity<br/>require pi.user.id"]
    redact2["attributes/redact<br/>delete prompt/completion/args"]
    fil --> redact2
  end

  col --> col_proc

  col_proc --> store[("Postgres + Mimir + Tempo")]
```

Two layers — the extension enforces the schema by construction, and the Collector enforces it again with explicit `attributes/redact` rules. If a future bug or unintended attribute slips through the extension, the Collector strips it before it reaches storage.

### 7.4 Threat model

| Threat | Mitigation |
|---|---|
| **Compromised developer machine emits forged data for another user** | Bearer tokens are per-user, tied to the SSO identity. A token can only emit data tagged with its issuing identity (Collector validates `pi.user.id` matches the token's claim). |
| **Compromised collector token leaks** | Tokens are revocable from the admin page; rotation is a one-line config change for the developer. Tokens have a 90-day TTL. |
| **MITM on the OTLP wire** | TLS only. Cert pinning optional in v1.5. |
| **Postgres credentials leak** | API uses a read-only role. The Collector's writer role can only `INSERT INTO pi_spend_logs`. No `DELETE`/`UPDATE` grant on the spend log. |
| **Insider (admin) reads another user's session detail** | All admin reads of session-level detail are logged to `audit_log` (a separate table). Admin pages display "you are viewing data on behalf of \<user\>" banner. |
| **Aggregated data inference (deanonymisation in redacted mode)** | Workspace cwd hashing is per-user keyed; same project across two developers gets two different hashes. Reverse map is per-user opt-in. |

### 7.5 OWASP MCP/agent security mapping

This system is not an MCP server, but the OWASP MCP Top 10 (and the broader Agentic Applications Top 10) gives us a useful checklist. Mapping:

| OWASP risk | This system |
|---|---|
| Token mismanagement | TLS only, hashed at rest, 90-day TTL, revocable, never logged |
| Privilege escalation | Postgres roles least-privilege; SQL WHERE clauses derived from JWT, never from user input |
| Tool poisoning | n/a — we register no LLM-callable tools |
| Supply chain | Per the [monorepo strategy](../strategy/pi-extensions-monorepo-STRATEGY.md): npm audit in CI, Trusted Publishing (OIDC) — no long-lived `NPM_TOKEN` |
| Command injection | No shell-out from the extension to user-controlled data; `git` invocations use fixed argv arrays |
| Memory poisoning | We don't have agent memory; closest analogue is the Collector's team-lookup ConfigMap, which is rebuilt from Postgres nightly |
| Audit / telemetry | This system **is** the audit / telemetry; admin operations on it are themselves logged to `audit_log` |
| Context over-sharing | The Collector strips any free-form attributes; the extension never emits them. Workspace path redaction is opt-in per developer. |


## 8. Phased delivery

Per the [dashboard backend strategy §6](../strategy/dashboard-backend-STRATEGY.md), order matters: Grafana first (so we get real numbers in existing dashboards within ~10 working days), then Postgres + SPA.

```mermaid
gantt
  title pi-usage-reporter — phased delivery
  dateFormat YYYY-MM-DD
  axisFormat %b %d
  section Spike
  0.1 Extension → local Jaeger          :p01, 2026-05-12, 5d
  section MVP — Grafana first
  0.2 Collector + Mimir + Tempo wired   :p02, after p01, 5d
  0.2 Pre-built Grafana dashboard JSON  :p02b, after p01, 5d
  Milestone first panels live           :milestone, after p02, 0d
  section Postgres + API + SPA
  0.3 Postgres exporter + schema        :p03, after p02, 4d
  0.3 API + SSO + per-user view         :p04, after p03, 8d
  0.4 Team and admin views              :p05, after p04, 6d
  0.4 Grafana Alerting rules            :p06, after p04, 3d
  section Hardening
  0.5 WAL + backfill + redaction        :p07, after p05, 5d
  1.0 GA, retention, audit export       :p08, after p07, 5d
```

Per-phase exit criteria:

| Phase | Exit when... | Estimated LOC |
|---|---|---|
| **0.1 Spike** | extension emits a known-good OTel GenAI span to local Jaeger; manual verification of every attribute | ~300 |
| **0.2 MVP** | one panel in existing company Grafana shows real per-developer cost for one team | ~300 (Grafana JSON, mostly) |
| **0.3 Postgres + per-user** | 10 developers can self-onboard, log in, see their own data | ~1200 |
| **0.4 Team + admin** | every EM in the pilot team can see their team's view; Grafana Alerting fires once on a synthetic anomaly | ~600 |
| **0.5 Hardening** | survives a 24h collector outage in a chaos test; backfill replays missing data | ~400 |
| **1.0 GA** | rollout to 100% of pi developers (per success criterion S1: 90% within four weeks); retention policies enforced; audit export works | ~400 |

## 9. Open questions

These are explicitly deferred until the spike (phase 0.1) gives us empirical data.

1. **Where does the OTel Collector run?** On-prem k8s in our infra, or managed (Grafana Cloud free tier supports OTLP)? Both work; affects ops burden but not design.
2. **Single-tenant vs multi-tenant ingest?** Per-team collectors (clean blast radius, more ops) or one big collector with tenant routing (cheaper, must enforce auth strictly). Default: one collector with per-team bearer tokens.
3. **What about pi-mom?** mom uses the same `pi-ai`/`pi-agent-core` stack. Same extension *should* work because the hook contract is identical — to be verified as part of phase 0.2.
4. **Per-provider quirks.** Bedrock cost reporting can include "service tier" metadata; OpenRouter routes through other providers and re-attributes. Need to validate that pi-mono's `Usage.cost.total` actually reflects upstream-billed cost in those cases. The mykb area for pi-mono already lists a related fix (commit `45354153`: "capture usage from `choice.usage` for non-standard OpenAI-compatible providers"), suggesting this surface still has rough edges.
5. **Compaction events.** A `session_compact` doubles input cost briefly. v1 reports it as a separate event with `pi.event.kind=compaction`. Whether dashboards show it inline or separately is a UX call.
6. **Sub-agent attribution.** When (if) sub-agents land in pi, do we want to attribute their usage to the parent session or surface it separately? Plan for a `pi.parent.session_id` attribute now (already in the schema).
7. **Cost-vs-billed-cost reconciliation.** Provider invoices arrive monthly and rarely match local estimates exactly. Out of scope for v1 (NG5); v2 may add an admin reconciliation view.
8. **CI runner emission.** Do we want CI runs included in personal/team rollups, or filtered to a separate "automation" view? `pi.workspace.is_ci` is in the schema; the dashboards' default filters need a decision.

## 10. Decisions this document commits to

1. **Wire format:** OpenTelemetry GenAI semantic conventions over OTLP/HTTP. No custom protocol. ([dashboard backend strategy §9.1](../strategy/dashboard-backend-STRATEGY.md))
2. **Compatible with `@ccusage/pi`.** The extension does not replace local CLI tools; both can run.
3. **Per-turn emit on `message_end`**, with a session-level span on `session_start` / `session_shutdown`.
4. **Three storage tiers:** OTel Collector (transport) → Mimir + Tempo (existing company Grafana) + Postgres (durable spend log, custom schema).
5. **Custom SPA** for per-user / per-team / finance / audit views. **Existing company Grafana** for ops / alerts / team rollups. Three roles (developer / team_lead / admin), SSO via the company IdP.
6. **Privacy default:** prompt content, tool args, tool outputs, file contents, shell output **never leave the developer machine**. Only tokens, cost, model, provider, stop reason, timestamps, identity, workspace metadata.
7. **Defence in depth:** extension enforces the schema by construction; Collector enforces it again with `attributes/redact`.
8. **Offline robustness via local WAL + backfill CLI.** No usage data lost short of disk failure.
9. **Identity from `git config user.email`** by default, overridable via `PI_USAGE_USER_ID`. Per-machine UUID stored at `~/.config/pi-usage/machine-id`.
10. **Live in `vilosource/pi-extensions` monorepo** at `packages/pi-usage-reporter/`. Published as `@vilosource/pi-usage-reporter` to public npm. ([monorepo strategy](../strategy/pi-extensions-monorepo-STRATEGY.md))
11. **Should also work in pi-mom** out of the box (same hook contract); to be verified in phase 0.2.
12. **Grafana Alerting handles real-time alerts for v1** via existing Slack / on-call routing. Custom alert evaluator deferred until needed.
13. **Multi-endpoint emit allowed but unadvertised.** Default is one endpoint (the company Collector).
14. **Backend choice is a Collector config change, never an extension change.** Documented exporters: Postgres, Prometheus remote_write, OTLP (Tempo, Honeycomb, Datadog, etc.).

---

**Document status:** design ready for review. Next step is phase 0.1 spike — implement the extension, emit to a local Jaeger, verify every attribute by hand against the schema in §3.9. Spike code goes on a short-lived branch `spike/0.1-jaeger`; if results are positive, the package skeleton lands on `main` as the first commit to `packages/pi-usage-reporter/`.
