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
