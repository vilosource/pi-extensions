# Architecture Principles

**Document type:** Strategy
**Status:** Living document
**Owner:** Platform / DevEx
**Posture:** Descriptive, not prescriptive. Records the patterns this codebase uses and the reasoning. Update as the codebase evolves; do not add aspirational rules here.

This is the short version. The long version is the code, especially [`packages/_template/`](../../packages/_template/).

## What we believe

1. **Make the bad version not compile or not pass CI.** Mechanical enforcement (TypeScript strict, Biome, dependency-cruiser, Vitest, the boundary check) is the only enforcement that holds against tired humans and LLM agents. Aspirational rules in docs decay; CI rules don't. The list of mechanical rules lives in [`AGENTS.md`](../../AGENTS.md#mechanical-enforcement); each one encodes a specific decision.
2. **Make the good version easy to pattern-match.** Agents and new contributors copy what's already there far more than they read prose. The reference implementation in [`packages/_template/`](../../packages/_template/) is the architecture document agents actually use.
3. **Keep the rule set small enough to hold in working memory.** [`AGENTS.md`](../../AGENTS.md) caps at ~150 lines for a reason. If we cannot remember the rules, they are a wishlist, not constraints.

## Layered structure inside a package

Each package separates IO from logic. Demonstrated in [`packages/_template/src/`](../../packages/_template/src/):

- **`src/index.ts`** is the public surface. Other packages import only what is re-exported here. Enforced by the dependency-cruiser rule `no-reach-into-package-internals`.
- **`src/shared/`** is pure: no `node:fs`, `node:os`, `node:child_process`, no `process.env` reads, no globals. Pure functions and types only. Enforced by the dependency-cruiser rule `shared-is-pure`.
- **`src/extension/`** (when present) is the IO-performing layer for pi extensions: hooks, OTel emission, WAL persistence, env reads. The pi extension API is consumed only here.
- **`src/cli/`** (when present) is the IO-performing layer for CLIs: argv parsing, stdin/stdout, file IO, env reads.

Tests live next to source as `<module>.test.ts`. The CI gate "source changes ship with tests" enforces that `src/**/*.ts` changes touch a corresponding test file.

## Patterns we use, and why

These are the patterns this codebase actually uses. We add to this list as new patterns emerge in the code; we do not add patterns here speculatively.

- **Strategy** — for plug-points where multiple implementations of a small interface coexist (e.g. multiple OTLP exporters, multiple identity resolvers). Lets us add a new variant without editing existing code.
- **Adapter** — at the boundary with third-party SDKs we don't control. The OTel SDK lives behind one adapter file; the rest of the package depends on our interface, not on `@opentelemetry/*`.
- **Builder** — for constructing OTel spans and metric points where the construction has many optional fields. Avoids large positional argument lists.
- **Observer** — already provided by pi (`pi.on(event, handler)`). Our extension consumes it; we do not implement it.

## Patterns we explicitly avoid

- **Singleton.** Hides collaborators and makes testing miserable. Use module-level functions or pass dependencies explicitly.
- **God-class controllers.** A class with 20 methods is a refactoring opportunity. Break it into focused functions or smaller classes by responsibility.
- **Active Record.** We are not an ORM. Domain types are plain TypeScript types (POJOs); persistence is a separate function.
- **Deep inheritance trees.** Composition almost always beats inheritance for our use cases. The few base classes we have should be one level deep.
- **Speculative abstractions.** "We might need this someday" is a YAGNI smell. Add abstraction when the second concrete case arrives, not before.

## When to deviate

This document, like every other doc in this repo, is descriptive. If a PR introduces a new pattern, the PR description explains the decision and (if the decision is load-bearing) appends an entry to [`decisions-LOG.md`](decisions-LOG.md). Deviation is fine; undocumented deviation is not.
