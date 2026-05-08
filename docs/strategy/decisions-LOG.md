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
