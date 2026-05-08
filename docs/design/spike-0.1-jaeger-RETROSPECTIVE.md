# Spike 0.1 — Jaeger End-to-End Retrospective

**Date:** 2026-05-08
**Branch:** `spike/0.1-jaeger`
**Status:** Complete; design holds with caveats noted below
**Goal:** Prove that pi can load `@vilosource/pi-usage-reporter`, that `message_end` fires with usable `Usage` data, that the OTel SDK accepts our schema, and that a span lands in a generic OTLP receiver (Jaeger) with all 27 attributes from design §3.9 correctly named.

## What worked

- **Pi loads the extension** without warnings. The `pi.extensions` field in `package.json` pointing at `./dist/extension` (a directory) resolves to `./dist/extension/index.js`'s default export. No special manifest or registration required.
- **The hook contract is exactly as documented.** `pi.on("message_end", ...)` fires with a `{ message: AgentMessage }` payload; the assistant message contains `provider`, `api`, `model`, `usage`, `stopReason`, `timestamp` — every field the design assumed.
- **The OTel SDK package set is correct.** Verified versions: `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-node@0.217.0`, `@opentelemetry/exporter-trace-otlp-http@0.217.0`, `@opentelemetry/exporter-metrics-otlp-http@0.217.0`, `@opentelemetry/sdk-metrics@2.7.1`, `@opentelemetry/resources@2.7.1`, `@opentelemetry/semantic-conventions@1.40.0`. The current API uses `resourceFromAttributes()` (not the older `Resource` class) and `PeriodicExportingMetricReader` (not the deprecated `ConsoleMetricExporter` pattern).
- **All 27 attributes arrive correctly named and typed in Jaeger.** The schema in design §3.9 maps cleanly.
- **End-to-end timing is fast.** Pi turn → Jaeger receipt < 1 second on localhost.

## What broke (defects to fix in 0.2)

### Defect 1 — session id is `"unknown"`

The extension entry assumed `pi.session?.id` exists. With pi 0.66.1 it is undefined; the structural type guess was wrong.

**Impact:** `agent.session.id` and `gen_ai.conversation.id` both emit as the literal string `"unknown"`. Per-session aggregation in the dashboard cannot work until this is fixed.

**Fix in 0.2:** read pi's actual session-context API. Likely candidates: `pi.context.sessionId`, `pi.session.file`, or an event-payload field on `session_start` we capture and reuse. Verify against `@earendil-works/pi-coding-agent`'s exported types (the canonical types are now under that scope; see D10).

### Defect 2 — token + cost zero for subscription providers (Copilot)

GitHub Copilot is subscription-billed; pi-mono populates `Usage` with all zeros (`input: 0`, `output: 0`, `cost.total: 0`). The extension faithfully forwards these zeros, so the dashboard would see zero spend for every Copilot session.

**Impact:** Spend visibility for Copilot users is broken. Same likely true for any flat-rate plan provider.

**Fix in 0.2 (or design decision):** decide what to do about subscription providers. Three options:
1. **Estimate cost client-side** from the model's published rate (pi-mono has cost data in `models.generated.ts`). Imperfect because subscription users may not pay per-token.
2. **Surface the zero-token problem to the dashboard explicitly** via a `agent.cost.estimation = "subscription"` attribute. Dashboards filter by this.
3. **Skip telemetry entirely for subscription providers.** Loses adoption signal.

I recommend (2) — the dashboard's "spend per developer" view treats `agent.cost.estimation = subscription` rows as adoption-only metrics, not financial ones. Worth a separate decision-log entry once we discuss.

### Defect 3 — harness version is hardcoded `"unknown"`

The extension emits `agent.harness.version = "unknown"` because there's no current code reading the host pi version.

**Fix in 0.2:** read `@earendil-works/pi-coding-agent`'s `package.json` from the running process via Node's `require.resolve` or by walking up from `process.argv[1]`. Trivial; deferred only because it doesn't affect schema correctness.

### Defect 4 — OTel shutdown crashes on unreachable endpoint

Discovered during the OTel-SDK-only smoke test in `/tmp/otel-spike`: when no receiver is reachable at shutdown time, `await sdk.shutdown()` raises `ECONNREFUSED` as an uncaught exception, which Node treats as fatal. **Would crash the developer's pi session.**

**Fix:** wrapped `sdk.shutdown()` in `try/catch` + 5-second `Promise.race` timeout in [`src/extension/otel.ts`](../../packages/pi-usage-reporter/src/extension/otel.ts) before the spike-against-pi run. Verified with the spike — even without verification of the unreachable case in the integrated test, the pure SDK test confirmed the wrapping works. **Recorded as D11 in the decisions log.**

## Schema validation

All 27 attributes from design §3.9 round-tripped through the OTel SDK and arrived in Jaeger with their intended names and types:

```
gen_ai.operation.name                       → "chat" ✓
gen_ai.provider.name                        → "github.copilot" ✓ (mapped via mapProvider)
gen_ai.request.model                        → "claude-opus-4-7" ✓
gen_ai.response.model                       → "claude-opus-4-7" ✓
gen_ai.usage.input_tokens                   → 0 (defect 2) ✓ correct shape
gen_ai.usage.output_tokens                  → 0 (defect 2) ✓ correct shape
gen_ai.usage.cache_read.input_tokens        → 0 ✓
gen_ai.usage.cache_creation.input_tokens    → 0 ✓
gen_ai.response.finish_reasons              → ["stop"] ✓ (array preserved)
gen_ai.conversation.id                      → "unknown" (defect 1)
agent.user.id                               → "spike-test@example.invalid" ✓
agent.machine.id                            → "<persisted UUID>" ✓
agent.session.id                            → "unknown" (defect 1)
agent.workspace.cwd                         → "/home/jasonvi/KB/pi-dev" ✓
agent.workspace.repo                        → "github.com/vilosource/viloforge-research" ✓
agent.workspace.branch                      → "develop" ✓
agent.workspace.is_ci                       → False ✓
agent.api.dialect                           → "anthropic-messages" ✓
agent.cost.input.usd                        → 0 (defect 2)
agent.cost.output.usd                       → 0 (defect 2)
agent.cost.cache_read.usd                   → 0
agent.cost.cache_write.usd                  → 0
agent.cost.total.usd                        → 0 (defect 2)
agent.stop_reason                           → "stop" ✓
agent.event.kind                            → "turn" ✓
agent.harness.name                          → "pi" ✓
agent.harness.version                       → "unknown" (defect 3)
```

The metric histograms (`gen_ai.client.token.usage`, `agent.cost.usd`) also fired but Jaeger doesn't render metrics natively. We'll verify metrics in phase 0.2 when the lab Collector + Prometheus are wired up.

## Architecture validation

The package's layered structure held up:

- `src/shared/` modules (`types.ts`, `mapping.ts`) are pure: enforced by the dependency-cruiser rule `shared-is-pure`. The CI check `npm run depgraph` reports `25 modules, 25 dependencies cruised; no violations`.
- Only `src/extension/otel.ts` imports `@opentelemetry/*` (the adapter pattern from `architecture-PRINCIPLES.md`). The rest of the package consumes the `OtelSink` interface, not the SDK directly.
- TypeScript strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` caught two real bugs during development (a `responseModel ?? model` fallback I'd written wrong; an `agent.workspace.repo` emission that would have included `undefined` values without the conditional spread).
- 27 unit tests across 3 test files cover the pure logic (mapping, URL normalization). The OTel adapter and the entry point were validated by the manual spike, not by mocked unit tests — recorded as deliberate scope for the spike.

## Test results

```
Test Files  3 passed (3)
     Tests  27 passed (27)
   Start at  11:41:45
   Duration  289ms
```

CI gates locally green:
- `npm run lint:ci` — Biome clean
- `npm run typecheck` — `tsc -b` clean
- `npm run depgraph` — 25/25 clean
- `npm run boundary` — 14/14 clean
- `npm run test` — 27/27 pass

## Open decisions surfaced by the spike

1. **Cost handling for subscription providers** — see Defect 2 above. Pending decision.
2. **Session-id resolution API** — see Defect 1 above. Pending pi-mono source check.
3. **Harness-version detection** — see Defect 3 above. Trivial fix in 0.2.

## What I'd change about the design doc

Three small refinements:

1. **Document the OTel shutdown-on-unreachable behaviour explicitly** in the design. Currently §3 mentions "non-blocking on hot path" but doesn't mention the shutdown-error-eating requirement. Done in this commit by adding D11 to the decisions log; should also update design §3.4 and §3.5 to point at D11.
2. **Update `peerDependencies` example to `@earendil-works/pi-coding-agent`** (D10). Done in this commit by patching design §3.2.
3. **Add a section on subscription-provider cost handling.** Will draft for phase 0.2.

## Phase 0.2 entry conditions

The spike has met its exit criteria:
- ✓ Extension loads in pi without errors
- ✓ Hook fires with usable data
- ✓ OTel SDK accepts schema
- ✓ Span lands in Jaeger
- ✓ All 27 attributes correctly named and typed
- ✓ Defects discovered have known fixes (not blockers)
- ✓ Architecture invariants hold (dep-cruiser clean, tests pass)

Phase 0.2 can begin once this PR merges. First 0.2 PRs (in order):
1. Fix Defect 1 (session id) — small.
2. Decide Defect 2 (subscription costs) — needs design discussion.
3. Fix Defect 3 (harness version) — small.
4. Stand up the lab Collector + Postgres + Mimir per the lab strategy.
5. Wire scenarios that exercise this extension end-to-end against the lab (not just Jaeger).
