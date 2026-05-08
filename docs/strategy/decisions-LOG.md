# Decisions Log

**Document type:** Decisions Log (append-only)
**Status:** Living document
**Owner:** Platform / DevEx
**Workspace:** `pi-dev`

This log records small, settled decisions that don't warrant their own strategy doc but should be captured so we don't relitigate them. Append-only. New decisions go at the bottom; old ones are never edited (corrections go in a new entry that supersedes the old).

---

## 2026-05-08 · D1 · Where Optiscan deploys (production)

**Decision:** Optiscan's production deployment of the reference dashboard server runs on **Docker Swarm**, with **Azure Managed Postgres** for the spend log, and connects to the **existing Optiscan Grafana / Prometheus / Alertmanager / OpenObserve** stack.

**Scope:** Optiscan-specific. Lives in a private Optiscan deployment repo (not yet created). Does **not** affect the design of the extension or the reference server.

**Rationale:** Per the [scope and deployment strategy](scope-and-deployment-STRATEGY.md), the public reference server is organization-agnostic. Optiscan's specific deployment is one of many possible deployments and is captured separately. Concrete URLs, IdP details, and infrastructure details are resolved at deployment time.

---

## 2026-05-08 · D2-D4 · Optiscan-specific deployment details deferred

**Decision:** Concrete values for Optiscan's deployment (Grafana / Prometheus / Tempo URLs, IdP issuer URL, pilot developer count, alert routing) are **deferred to deployment time**. They are not inputs to the public design.

**Scope:** Optiscan-specific. To be recorded in the private Optiscan deployment repo when it is created.

**Rationale:** The public reference server defines a contract; deploying organizations adapt their infrastructure to meet that contract. Hardcoding Optiscan's choices into the public design would couple it to one organization. See [`scope-and-deployment-STRATEGY.md`](scope-and-deployment-STRATEGY.md) §6 and the [dependency-direction note](../design/pi-usage-reporter-DESIGN.md) in the design doc §1.4.

---

## 2026-05-08 · D5 · npm publishing — public

**Decision:** `@vilosource/pi-usage-reporter` and all future organization-agnostic packages in this repo are **published to public npm**. Published with `"publishConfig": { "access": "public" }`. Internal-only packages (per the [monorepo strategy](pi-extensions-monorepo-STRATEGY.md)) use the `@vilosource-internal` scope on a private GitHub Packages registry.

**Scope:** All public packages in `vilosource/pi-extensions`.

**Rationale:**
- The package contains zero secrets or organization-specific values (enforced by [`public-boundary-STRATEGY.md`](public-boundary-STRATEGY.md)).
- Public npm is the standard pi-ecosystem distribution channel; private packages would force every developer machine to authenticate against GitHub Packages just to install.
- Public listings on [pi.dev/packages](https://pi.dev/packages) are valuable for adoption.
- Other organizations (ViloForge included) can use the same package against their own deployments.
- Reputation builds on the `@vilosource` scope.

The `0.x` version stripe signals "experimental" until v1.0; that's the standard mechanism for "use at your own risk."

---

## 2026-05-08 · D6 · pi-mono peerDependency lower bound

**Decision:** `@vilosource/pi-usage-reporter` declares `"peerDependencies": { "@mariozechner/pi-coding-agent": ">=0.52.0" }`.

**Scope:** `@vilosource/pi-usage-reporter` package.

**Rationale:** Verified via `git log -S` on the upstream pi-mono repo at `~/pi-mono`:
- The `message_end` event (load-bearing for our per-turn emit) was added in commit `ff5148e7` ("feat(extensions): forward message and tool execution events to extensions", PR #1375), first released in tag **v0.52.10**.
- `session_compact` and `model_select` are older.
- Latest pi-mono release at decision time: **v0.74.0**.

`>=0.52.0` covers everyone running a pi recent enough to have all hooks we use. Phase 0.1 spike will verify the extension also works on the latest (currently 0.74.x); if any hook-contract break is found in that range, we narrow the bound or add a compatibility shim.

---

## How to add an entry

1. Append a new section at the bottom: `## YYYY-MM-DD · D<n> · <one-line title>`.
2. Required fields: **Decision**, **Scope**, **Rationale**.
3. Old entries are never edited. To correct a decision, write a new entry that explicitly says "supersedes D<n>".
4. Commit on a feature branch; PR review confirms the decision was actually agreed; merge.

---

## 2026-05-08 · D7 · Pi-mom support deferred

**Decision:** Pi-mom support is out of scope for v1. If/when pi-mom is deployed with this extension loaded, spend is attributed to the bot account (whatever `PI_USAGE_USER_ID` resolves to inside the mom container). No Slack-user attribution. No pi-mom-specific code paths. No mom-test scenarios in the lab.

**Scope:** All public artifacts in `vilosource/pi-extensions` and the future `vilosource/agent-spend-dashboard`.

**Rationale:** The extension is designed against the `pi-ai`/`pi-agent-core` hook contract, not against the CLI specifically. Mom should work as a side effect of correctness; verifying it before there is a real user costs more than the value it provides. Bot-account attribution is sufficient for "is the bot spending money?" visibility, which is the only question that matters until someone explicitly asks for more.

---

## 2026-05-08 · D8 · Dashboard renamed harness-agnostic; `agent.*` attribute namespace

**Decision:**

- The future dashboard repo is `vilosource/agent-spend-dashboard`, not `vilosource/pi-usage-dashboard`.
- The custom (non-`gen_ai.*`) attribute namespace is `agent.*`, not `pi.*`. Every per-turn attribute is renamed accordingly (`agent.user.id`, `agent.machine.id`, `agent.session.id`, `agent.workspace.{cwd,repo,branch,is_ci}`, `agent.api.dialect`, `agent.cost.{input,output,cache_read,cache_write,total}.usd`, `agent.stop_reason`, `agent.event.kind`, `agent.parent.session_id`, `agent.tenant_id`).
- Two new attributes added: `agent.harness.name` (e.g. `"pi"`, `"claude-code"`, `"cursor"`) and `agent.harness.version` (e.g. `"0.74.0"`).
- Postgres table renamed: `agent_spend_logs`. Database renamed: `agent_spend`.
- Histogram metric renamed: `agent.cost.usd`.
- The pi extension package keeps its name (`@vilosource/pi-usage-reporter`); a future Claude Code extension would be `@vilosource/claude-code-spend-reporter` and emit the same `agent.*` attributes to the same dashboard.
- The `PI_USAGE_*` env vars on the extension stay — they are the *pi extension's* env vars and pi-specificity is correct there.

**Scope:** All public artifacts in `vilosource/pi-extensions` and the future `vilosource/agent-spend-dashboard`.

**Rationale:**

The OTel GenAI semantic conventions, the OTLP wire format, the per-user/team/finance dashboard surface, and the schema columns are not pi-specific in any meaningful sense. Pi was the first harness we instrumented, but the dashboard's value proposition (per-developer LLM spend visibility, attribution, audit) applies to any coding-agent harness that emits OTel GenAI.

Naming the dashboard `pi-*` and the schema `pi_spend_logs` would lock the design to one harness when nothing about it actually requires that. Adding a Claude Code extension six months from now would either require schema migration or awkward `pi_user_id` columns containing Claude Code data.

The extension stays pi-named because the extension *is* pi-specific (it hooks into pi's extension API; it could not be a Claude Code extension even if we wanted). This separation — extensions are per-harness, dashboard is harness-agnostic — is the correct factoring.

`agent.harness.name` and `agent.harness.version` let the dashboard distinguish spend by harness without changing the schema. The pi extension sets `agent.harness.name = "pi"` automatically; future extensions for other harnesses set their own value.

**Implements:** the harness-agnosticism implied by [`scope-and-deployment-STRATEGY.md`](scope-and-deployment-STRATEGY.md). That doc already said the extension and the dashboard are organization-agnostic; this decision extends the same logic to harness-agnosticism for the dashboard.

**Migrations:** none — no code or data exists yet; this is a doc-only rename.

---

## 2026-05-08 · D9 · Quality floor — mechanical enforcement before any package code

**Decision:** Establish a mechanical quality floor before any package code lands. Specifically: TypeScript strict (with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables`), Biome (with `noExplicitAny: error`, `useConst`, `useNodejsImportProtocol`, `noUnusedImports`, `noUnusedVariables`, cognitive-complexity ≤ 15), `dependency-cruiser` (no cycles, no deep imports across packages, `src/shared/` is pure, no test imports from prod, no devDeps in prod), Vitest with tests next to source, a "source changes ship with tests" PR-gate, and a 3-field PR template. The full set is documented in [`AGENTS.md`](../../AGENTS.md#mechanical-enforcement) and runnable as `npm run check`.

**Scope:** `vilosource/pi-extensions`. The same pattern will be applied to `vilosource/agent-spend-dashboard` when its code starts.

**Rationale:** Doc-only enforcement of architectural principles decays. Mechanical CI is the only enforcement that holds against tired humans and LLM agents. We deliberately set up the floor *before* any package code lands, so the first line of code is written against the gates rather than retrofitting gates around legacy code.

We resisted maximalism: no eslint-plugin-functional, no `tsarch`, no Stryker mutation testing, no coverage thresholds. Each of those would have produced more friction than value at this scope. The floor includes only rules that catch concrete classes of error we have specific reason to want caught. Rules will be tuned by deletion as easily as by addition.

The architecture document at [`architecture-PRINCIPLES.md`](architecture-PRINCIPLES.md) is intentionally **descriptive, not prescriptive**: it records the patterns this codebase uses, with links to where each pattern appears in code. It does not list aspirational principles. The reference implementation at [`packages/_template/`](../../packages/_template/) is the architecture document agents will actually pattern-match on.

The PR template is **3 fields** (what / why / what test): minimal accountability without becoming ritual.

**Patterns explicitly named as "avoid":** Singleton, god-class controllers, Active Record, deep inheritance trees, speculative abstractions. (See `architecture-PRINCIPLES.md`.)

---

## 2026-05-08 · D10 · Pi-mono package scope migrated to @earendil-works (supersedes D6)

**Decision:** Update package references throughout the codebase: `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent`, same for `pi-agent-core`, `pi-ai`, `pi-tui`. The package.json `peerDependencies` for `@vilosource/pi-usage-reporter` is `"@earendil-works/pi-coding-agent": ">=0.74.0"` (was `">=0.52.0"` against the Mariozechner scope per D6, but that scope is no longer the canonical home).

**Scope:** All packages in `vilosource/pi-extensions`. Documentation references in `docs/`. The design doc's §3.2 `package.json` example.

**Rationale:** Pi-mono was transferred from Mario Zechner to the earendil-works organization. Both the GitHub repository (already documented as the redirect from `badlogic/pi-mono` → `earendil-works/pi`) and the npm packages followed. Latest under `@mariozechner` is **0.73.1** (frozen May 7, 2026); newest releases under `@earendil-works` start at **0.74.0**.

The hook event shapes are unchanged between the two scopes:
- `Usage` interface is identical
- `AssistantMessage` adds three optional fields (`responseModel`, `responseId`, `diagnostics`) but is backward-compatible
- `MessageEndEvent`, `SessionShutdownEvent`, `SessionCompactEvent`, `ModelSelectEvent` shapes unchanged

So the design doc's hook usage and `Usage` mapping require no change — only the package name and version.

**Implementation note:** the new `responseModel` field maps cleanly to `gen_ai.response.model` in our schema (when set, it differs from `gen_ai.request.model` for routing providers like OpenRouter `auto`). Use it.

**Supersedes:** D6 in full. The `>=0.52.0` lower bound under the old scope is moot because no one will install the new extension against the old (frozen) scope.

---

## 2026-05-08 · D11 · OTel SDK shutdown errors must be caught

**Decision:** The extension's `session_shutdown` hook handler MUST wrap `sdk.shutdown()` in a `try/catch` and swallow any error after logging at warn level. The extension MUST NOT propagate OTel SDK shutdown errors to pi.

**Scope:** `packages/pi-usage-reporter/src/extension/otel.ts` and the corresponding hook handler.

**Rationale:** The phase 0.1 spike (run 2026-05-08) discovered that when the OTel collector endpoint is unreachable at shutdown time, `await sdk.shutdown()` raises an **uncaught exception** of `ECONNREFUSED` shape, which Node treats as fatal and crashes the process.

In our context, the process is the developer's pi session. A crash on session end would cause two visible problems: (1) pi exits with a non-zero status when it would otherwise have exited cleanly, masking the developer's actual exit intent; (2) any post-shutdown work pi does (writing the session JSONL, etc.) is skipped.

The extension's contract is that telemetry never affects the user's pi session. Telemetry failures must be silent at worst, warning-logged at best. This is the same posture as the WAL design: collector down → events stay in WAL → next run replays them. A failed shutdown is the same case — events stay buffered, get replayed next run.

**Implementation pattern:**

```typescript
try {
  await Promise.race([
    sdk.shutdown(),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("OTel shutdown timeout")), 5000),
    ),
  ]);
} catch (err) {
  if (cfg.verbose) {
    console.warn("[pi-usage-reporter] OTel shutdown failed (telemetry events stay in WAL):", err);
  }
}
```

The 5-second timeout is also new — without it, `sdk.shutdown()` can hang indefinitely when the receiver is unresponsive (different from unreachable: TCP connect succeeds but the HTTP request never completes).

**Spike output:** confirmed in `/tmp/otel-spike` against Jaeger all-in-one. With Jaeger reachable, all 27 attributes arrive correctly, span renders in Jaeger UI. Without Jaeger, plain `await sdk.shutdown()` crashes the process; with the try/catch + timeout pattern above, exit is clean.

---

## 2026-05-08 · D12 · Subscription provider cost handling — `agent.cost.estimation`

**Decision:** Add an `agent.cost.estimation` attribute (string enum: `metered` / `subscription` / `unreported`) to every emitted turn. Classifier is in `packages/pi-usage-reporter/src/shared/cost-classification.ts`:

- `metered`: any cost bucket > 0 — the provider returned per-token cost data; dashboards render dollar amounts.
- `subscription`: all costs are zero but token counts are > 0 — the provider didn't return cost (typical of subscription plans like GitHub Copilot, where pi-mono's `models.generated.ts` deliberately omits the `cost` field). Dashboards render adoption/token metrics; financial views ignore these rows.
- `unreported`: both costs and tokens are zero — likely an aborted, errored, or no-op turn. Dashboards filter these out by default.

**Scope:** `packages/pi-usage-reporter` and the schema in `docs/design/pi-usage-reporter-DESIGN.md` §3.9.

**Rationale:** Resolves spike-defect D2 from the phase 0.1 retrospective.

The phase 0.1 spike discovered that GitHub Copilot (subscription-billed) returns `Usage` with `cost.total = 0`. pi-mono's `models.generated.ts` confirms this is by design: Copilot model entries deliberately omit the `cost` field because Copilot is subscription-billed, not per-token. Without an explicit signal, the dashboard cannot distinguish "this turn really cost zero" from "we don't have cost data for this provider."

We considered three options (per the spike retrospective):
1. **Estimate cost client-side** from a published rate. Rejected: subscription users may not pay per-token at all; estimating dollars where there are no per-call dollars would be misleading.
2. **Surface explicitly via an attribute.** Chosen.
3. **Skip telemetry entirely for subscription providers.** Rejected: loses the adoption signal, which is independently valuable.

The classifier is a pure function with 5 unit tests. Verified end-to-end against pi 0.66.1 + Copilot: `agent.cost.estimation = subscription` arrives in Jaeger as expected.

**Implementation note:** The spike retrospective claimed Copilot returns "all zeros" including tokens. That was wrong: Copilot **does** return token counts, just not cost. Verified: `gen_ai.usage.input_tokens = 6` for the phase 0.2 verification turn. Adoption metrics work even on subscription providers.


---

## 2026-05-08 · D13 · Identity from JWT, not from environment (mirrors dashboard D8)

**Decision:** The pi-usage-reporter extension reads only its bearer token (from `~/.config/pi-usage/config.json` or `PI_USAGE_TOKEN` env var) and forwards it as `Authorization: Bearer <jwt>` on every OTLP request. The extension does not decode the token, does not assert a `user_id`, and the previous `git config --global user.email` fallback is removed. Identity is extracted from the JWT by the API per [`pi-usage-reporter-DESIGN.md` §3.6](../design/pi-usage-reporter-DESIGN.md) and [`agent-spend-dashboard/docs/strategy/decisions-LOG.md` D8](https://github.com/vilosource/agent-spend-dashboard/blob/main/docs/strategy/decisions-LOG.md).

**Removed configuration** (no longer accepted; logged as warnings if set):
- `PI_USAGE_USER_ID` env var
- `git config --global user.email` fallback
- `${USER}@${hostname}` last-resort fallback

**Scope:** `packages/pi-usage-reporter/src/extension/identity.ts` simplifies dramatically; the entire identity-resolver flow becomes "read the token; if no token, warn once and disable."

**Rationale:** Until D13, the extension's identity was best-effort and forgeable: anyone could set `PI_USAGE_USER_ID=ceo@example.com` and the dashboard would treat that as truth. Fine for a lab; not fine for any deployed environment. Mirroring dashboard D8 here records the agreement on the extension side: the extension does not assert identity; the API does.

**Implementation impact:**

- `identity.ts` shrinks to ~20 LOC: read token from config or env, resolve machine-id UUID, return.
- `index.ts` extension entry point: emit a one-line warning ("PI_USAGE_TOKEN not configured; telemetry disabled. Run `pi-usage login`.") if no token; do not crash pi.
- The OTel `Authorization` header is set from the token instead of from a separate `PI_USAGE_TOKEN` env var (the env var is one of the input sources for the token, not a separate concept).
- `pi-usage doctor`'s identity check changes from "verify git config" to "verify token validity by hitting `/api/me`."

**Sunset note:** The previous `agent.user.id` attribute the extension emits is **kept** (still useful as audit data — what did the extension *think* the user was?), but is no longer used as identity ground truth on the server.

---

## 2026-05-08 · D14 · `pi-usage login` becomes the primary install path

**Decision:** The recommended install path is **clicking "Install" in the SPA** (visible after SSO login) and pasting the resulting one-liner into a terminal. The script writes `~/.config/pi-usage/config.json`, runs `npm install -g @vilosource/pi-usage-reporter`, and patches `~/.pi/agent/settings.json` to load the extension. `pi-usage login` is the alternative for terminal-only environments via OAuth 2.0 Device Authorization Grant (RFC 8628).

For lab work without SSO: `pi-usage login --lab --endpoint http://localhost:8080`. For CI: `PI_USAGE_TOKEN=$AGENT_SPEND_CI_TOKEN`.

All three paths produce the same `~/.config/pi-usage/config.json`.

**Scope:** `pi-usage` CLI (`login`, `logout`, `whoami`, `uninstall`); the SPA's `/install` page generates the one-liner.

**Rationale:** Per [D10 in the dashboard's decisions log](https://github.com/vilosource/agent-spend-dashboard/blob/main/docs/strategy/decisions-LOG.md). The SPA-driven path is faster (60 seconds from first SSO to running pi with telemetry) and matches the privacy-by-design pattern (SPA shows what will be transmitted before the user pastes anything). The CLI path is the fallback for environments where opening a browser on the same host is awkward (CI, headless dev VMs).

**`pi-usage uninstall`** is symmetric: revokes the server-side token, removes `~/.config/pi-usage/`, patches `settings.json` to remove the extension entry. No cruft left on a developer's machine. (Per [C6 of the API+SPA design](https://github.com/vilosource/agent-spend-dashboard/blob/main/docs/design/api-and-spa-DESIGN.md).)
