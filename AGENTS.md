# AGENTS.md

Rules for any agent — human or AI — working in this repository.

## Style

- Technical prose only. No emoji in commits, issues, PR comments, or code.
- Be concise. Skip cheerful filler.
- Match the surrounding code style; we use Biome for lint+format once tooling lands.

## Commits

- One logical change per commit.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- Reference issues with `closes #N` / `fixes #N` when applicable.
- Never `git add -A` or `git add .` — stage explicit paths only.

## Branching

- Feature branches off `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- We never open PRs directly to `main` from agents — humans review first.
- No force pushes to `main`. No `git reset --hard` on shared branches.

## Per-package work

- Each package lives under `packages/<name>/` with its own `package.json` and `CHANGELOG.md`.
- Cross-package changes go in a single PR; same-package changes stay isolated.
- Tests for a package live next to it; running them must not require building other packages.

## Documentation

- New design decisions go under `docs/design/<package>-DESIGN.md`.
- Research briefs go under `docs/research/<topic>-RESEARCH.md`.
- Strategy / cross-cutting decisions go under `docs/strategy/<topic>-STRATEGY.md`.
- Always link the research that motivated a design, and the design that motivated an implementation.

## Pi extension authoring rules

- Hooks must be non-blocking on the hot path (turn-level events). Buffer and emit asynchronously.
- Never log prompt content, tool arguments, tool outputs, or file contents to anything that leaves the developer machine.
- Identity is never hardcoded. Resolve from environment / git config / explicit override, never from anything that resembles a hardware fingerprint.
- Configuration order is always: env var → config file → built-in default. Document every knob.

## Diagrams

All diagrams in this repository's documentation use **Mermaid**, rendered inline in Markdown. Do not use ASCII art, text boxes, or external image files for architecture or flow diagrams.

Conventions:

- **Architecture and data flow** → `flowchart LR` (left-to-right). Use `subgraph` to group by trust boundary or deployment location.
- **Protocols and lifecycles** → `sequenceDiagram` with `autonumber`.
- **Database schema** → `erDiagram`.
- **State machines** → `stateDiagram-v2`.
- **Roadmaps** → `gantt`.
- **Class / type relationships** → `classDiagram`, sparingly.
- **No theme directives** in diagram source. Let GitHub render with its default theme.
- **Above each diagram, write one sentence describing what it shows** so readers in plain-text viewers still understand the intent.
- **Keep each diagram under ~40 nodes.** Split into "context" and "detail" diagrams when larger.

## Public / private boundary

This repository is **public**. Per [`docs/strategy/public-boundary-STRATEGY.md`](docs/strategy/public-boundary-STRATEGY.md):

- Real organization names (other than vilosource), real FQDNs, real tokens, real Vault paths, real cloud-resource IDs **MUST NOT** appear in this repo. Use placeholders (`<organization-collector-host>`, `*.example.com`, `${ENV_VAR}`).
- A regex denylist enforces this on every push and PR (`scripts/check-public-boundary.sh`, `.github/workflows/boundary.yml`).
- If a placeholder triggers a false positive, add the file to `.boundary-allowlist` with a one-line justification, in the same PR.
- When generating examples, defer to the placeholders the rest of the repo uses. Do not invent realistic-looking FQDNs or tokens.

Organization-specific deployment values live in **private deployment repos** owned by each adopting organization, never here.

## Decisions log

Settled architectural decisions are recorded append-only in [`docs/strategy/decisions-LOG.md`](docs/strategy/decisions-LOG.md). New decisions go at the bottom; old ones are never edited (corrections are new entries that supersede the old). Reference an existing entry by its date and decision number (e.g. "per D5 in the decisions log") rather than re-arguing the question.

## Mechanical enforcement

The rules below are enforced by CI on every push and PR. Failing any of them blocks merge.

| Tool | What it enforces | Config |
|---|---|---|
| **Biome** | format, lint hygiene (no `any`, `useConst`, `useNodejsImportProtocol`, `noUnusedImports`, `noUnusedVariables`, cognitive-complexity ≤ 15) | [`biome.json`](biome.json) |
| **TypeScript strict** | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `useUnknownInCatchVariables` | [`tsconfig.base.json`](tsconfig.base.json) |
| **dependency-cruiser** | architectural invariants: no cycles, no deep imports across packages, `src/shared/` is pure (no IO), no test imports from prod, no devDeps in prod | [`.dependency-cruiser.cjs`](.dependency-cruiser.cjs) |
| **Vitest** | tests live next to source as `*.test.ts`; tests must pass | [`vitest.config.ts`](vitest.config.ts) |
| **test-coverage check** | source changes ship with corresponding test changes (PR-only, soft floor) | [`scripts/check-tests-with-source.sh`](scripts/check-tests-with-source.sh) |
| **Boundary** | no organization-specific values in source | [`scripts/check-public-boundary.sh`](scripts/check-public-boundary.sh) |

Run all of them locally with `npm run check`. Each tool can also be run individually (`npm run lint`, `npm run typecheck`, `npm run depgraph`, `npm run test`, `npm run boundary`).

When a rule false-positives on legitimate code, the fix is **either** to relax the rule in its config (with a justification in the PR), **or** to refactor the code. Do not add `// eslint-disable` style suppressions; if the rule is wrong, remove or weaken it; do not paper over.

## Per-package layout

Packages follow a layered structure demonstrated in [`packages/_template/`](packages/_template/):

```
packages/<name>/
├── package.json                  # name = @vilosource/<name>; declares vitest as devDep
├── tsconfig.json                 # extends ../../tsconfig.base.json
├── README.md                     # what the package is, who uses it, how
└── src/
    ├── index.ts                  # public exports only; thin re-exports
    ├── shared/                   # pure (no IO) — enforced by dependency-cruiser
    │   ├── <module>.ts
    │   └── <module>.test.ts      # tests live next to source
    ├── extension/                # IO-performing layer for pi extensions
    │   ├── index.ts              # the only file that imports pi APIs
    │   └── ...
    └── cli/                      # IO-performing layer for CLIs
        └── ...
```

Start a new package with `node scripts/new-package.mjs <name>`. The script copies `_template/`, fills in placeholder names, and adds the new package to the root `tsconfig.json` references.

## Things humans / agents are still expected to use judgement on

The mechanical rules above catch broad categories of mistakes. They do **not** catch:

- Whether an abstraction is the right one (vs. inlining or vs. a different shape).
- Whether a name communicates the thing it names.
- Whether an interface boundary is in the right place.
- Whether a test actually exercises the behaviour it claims to (vs. just running the code).
- Whether a comment is true.

These are the things human review (and informed agent review) is for. The PR template asks the right questions; reviewers verify them.
