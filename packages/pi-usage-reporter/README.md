# `@vilosource/pi-usage-reporter`

Per-developer pi-mono token usage and cost telemetry over OpenTelemetry GenAI.

**Status:** spike (phase 0.1). The hook surface and OTel emission are wired end-to-end and verified against Jaeger; identity / workspace / config are resolved as designed; mapping logic is unit-tested. Not yet published; do not depend on this version.

## What this is

A pi extension that hooks `message_end` and `session_shutdown`, builds an OTel GenAI span per assistant turn, and emits to a configurable OTLP endpoint. Schema follows [the design doc](../../docs/design/pi-usage-reporter-DESIGN.md) §3.9 — standard `gen_ai.*` attributes plus the harness-agnostic `agent.*` namespace.

## What this is not

- Not a dashboard. The dashboard lives in [`vilosource/agent-spend-dashboard`](https://github.com/vilosource/agent-spend-dashboard).
- Not a reporting CLI. Use [`@ccusage/pi`](https://www.npmjs.com/package/@ccusage/pi) for local offline analysis. They coexist.
- Not pi-specific in the schema. The `agent.*` namespace is harness-agnostic; future Claude Code, Cursor, or Aider extensions emit the same attributes to the same dashboard.

## Configuration

| Env var | Purpose |
|---|---|
| `PI_USAGE_ENDPOINT` | OTLP/HTTP endpoint URL (e.g. `http://localhost:7018` for the local lab; the API absorbs OTLP at `http://localhost:7080/v1/traces` after phase 0.3.7). If unset, the extension warns once and disables itself. |
| `PI_USAGE_TOKEN` | Bearer token sent as `Authorization: Bearer ...`. |
| `PI_USAGE_USER_ID` | Override identity. Default: `git config --global user.email`, then `${USER}@${hostname}`. |
| `PI_USAGE_ENVIRONMENT` | Environment tag in OTel `deployment.environment` resource attribute. Default: `prod`. |
| `PI_USAGE_VERBOSE` | Set to `1` for debug logging on stderr. Default: silent. |
| `PI_USAGE_BATCH_INTERVAL_MS` | OTel batch export interval. Default: `10000`. |

## Architecture

```
src/
├── index.ts                      public API surface (re-exports)
├── shared/                       pure modules (no IO)
│   ├── types.ts                  Usage, AssistantMessageSlice, TurnEvent, Identity, Workspace
│   └── mapping.ts                Usage + Identity + Workspace → OTel attributes
└── extension/                    IO-performing modules
    ├── index.ts                  pi entry point — default export
    ├── config.ts                 env-driven configuration
    ├── identity.ts               git config / fallback resolution + machine UUID
    ├── workspace.ts              cwd / git remote / branch / CI detection
    └── otel.ts                   OTel SDK adapter (the only file that imports @opentelemetry/*)
```

The dependency-cruiser rule `shared-is-pure` enforces that `src/shared/` performs no IO. The `_template`-compatible layered structure keeps OTel concerns isolated.

## Testing the spike

```bash
# 1. Start a Jaeger receiver
docker run -d --rm --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest

# 2. Build the extension
cd packages/pi-usage-reporter && npm run build

# 3. Run pi with the extension loaded and PI_USAGE_ENDPOINT pointing at Jaeger
PI_USAGE_ENDPOINT=http://localhost:7018 \
PI_USAGE_TOKEN=spike-token \
PI_USAGE_VERBOSE=1 \
pi
# Type a prompt, get a response.

# 4. Open Jaeger UI and verify the span landed
xdg-open http://localhost:16686
# Service: pi-usage-reporter; span: chat <model>
```

## Limitations of this spike

- No WAL yet. If the OTLP endpoint is unreachable, the OTel SDK buffers in memory until shutdown; on hard crash, those events are lost.
- No `session_compact` event handling.
- No `model_select` event handling.
- Harness version is hardcoded `"unknown"`; should read from pi-mono's package.json at runtime.
- No CLI (`pi-usage doctor`, `pi-usage status`, etc.) yet.
- Tests cover pure mapping + workspace URL normalization; the OTel adapter and the extension entry are validated by manual end-to-end Jaeger spike, not unit tests.

These are by design — the spike's purpose is to prove the design holds end-to-end, not to ship a finished extension. Phases 0.2-1.0 will close them.
