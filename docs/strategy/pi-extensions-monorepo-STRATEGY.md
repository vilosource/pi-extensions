# pi-extensions Monorepo Strategy

**Document type:** Strategy
**Status:** Accepted
**Date:** 2026-05-08
**Owner:** Platform / DevEx
**Workspace:** `pi-dev`

## 1. Decision

We will publish all our pi extensions from a **single monorepo at `vilosource/pi-extensions`**. Each extension is its own scoped npm package under `@vilosource/...`, independently versioned and installable. Internal-only packages live in the same monorepo under a separate `@vilosource-internal/...` scope and ship to a private GitHub Packages registry.

This document records the reasoning and the conventions every package in this repo must follow.

## 2. Why this choice

We surveyed the live pi extension ecosystem on 2026-05-08 (the official [pi.dev/packages](https://pi.dev/packages) registry, the [`qualisero/awesome-pi-agent`](https://github.com/qualisero/awesome-pi-agent) curated list, and the most prolific contributors' repos). Three patterns dominate:

| Pattern | Examples | When it works |
|---|---|---|
| **A. One repo per extension** | `nicobailon/pi-subagents`, `nicobailon/pi-mcp-adapter`, `nicobailon/pi-web-access`, `nicobailon/pi-powerline-footer` (~7 separate repos by one author) | Single-package authors; each extension has its own community |
| **B. Monorepo, multiple scoped npm packages** | [`juicesharp/rpiv-mono`](https://github.com/juicesharp/rpiv-mono) → `@juicesharp/rpiv-todo`, `@juicesharp/rpiv-advisor`, `@juicesharp/rpiv-ask-user-question`, `@juicesharp/rpiv-web-tools`; [`jmcombs/pi-extensions`](https://github.com/jmcombs/pi-extensions) → `@jmcombs/pi-tavily-search`, `@jmcombs/pi-prompt-enhancer`; `@dreki-gg/pi-subagent`, `@dreki-gg/pi-plan-mode`; `@plannotator/pi-extension`; `@ollama/pi-web-search` | Authors with multiple extensions and a desire for shared tooling |
| **C. Monorepo, single git-installable bundle** | [`tmustier/pi-extensions`](https://github.com/tmustier/pi-extensions), [`tomsej/pi-ext`](https://github.com/tomsej/pi-ext), [`aliou/pi-extensions`](https://github.com/aliou/pi-extensions), [`prateekmedia/pi-hooks`](https://github.com/prateekmedia/pi-hooks), [`hjanuschka/shitty-extensions`](https://github.com/hjanuschka/shitty-extensions) | Personal collections; users `pi install git:...` and filter in `settings.json` |

Pattern B fits us best because:

1. **We will write multiple extensions.** Usage tracking is just the first; internal skills, identity helpers, and bundled defaults will follow. Pattern A's overhead grows linearly with extension count.
2. **They share concerns.** Identity resolution, OTel emission helpers, internal logging conventions, CI, release process — all of these belong in one place.
3. **We want consistent quality.** One lint config, one test runner, one CI gate, one release workflow.
4. **We need cross-extension refactors.** When the shared identity helper changes, every consumer should update atomically. Cross-repo coordination (Pattern A) is painful; Pattern C's lack of semver makes that unsafe.
5. **We get Pattern C for free anyway.** Pattern B with workspaces still supports `pi install git:github.com/vilosource/pi-extensions` and `~/.pi/agent/settings.json` filtering — so internal developers can install a curated bundle without changing how external users install single packages from npm.

The most polished public reference is [`jmcombs/pi-extensions`](https://github.com/jmcombs/pi-extensions). It uses npm workspaces, Release Please for per-package versioning, npm Trusted Publishing (OIDC), Conventional Commits, and a single `npm run check` quality gate. We adopt the same shape.

## 3. Repository conventions

### 3.1 Layout

```
pi-extensions/
├── package.json                    npm workspaces root, "private": true
├── tsconfig.base.json              shared TS config — packages extend this
├── biome.json                      lint + format (matches pi-mono)
├── vitest.config.ts                test runner config
├── release-please-config.json      per-package versioning automation
├── .release-please-manifest.json
├── .github/workflows/
│   ├── ci.yml                      lint + typecheck + test on every PR
│   └── release.yml                 Release Please + npm publish via OIDC
├── README.md                       lists packages, install lines, doc links
├── CONTRIBUTING.md
├── AGENTS.md                       agent rules (humans + AI)
├── LICENSE                         MIT
├── docs/
│   ├── strategy/                   cross-cutting decisions (this file)
│   ├── design/                     per-package DESIGN.md
│   └── research/                   per-topic RESEARCH.md
├── packages/
│   ├── _template/                  scaffold for new packages
│   ├── pi-shared/                  internal shared helpers (private package)
│   ├── pi-usage-reporter/          @vilosource/pi-usage-reporter
│   └── ...
└── scripts/
    ├── new-package.mjs             copies _template/ → packages/<name>/
    └── sync-versions.mjs           validates package conformance
```

### 3.2 Naming

| Item | Convention |
|---|---|
| GitHub repo | `vilosource/pi-extensions` |
| npm scope (public) | `@vilosource` — already in use by `@vilosource/mykb` |
| npm scope (internal) | `@vilosource-internal` — for packages that should never be on public npm |
| Package directory | `packages/pi-<name>/` |
| Public package npm name | `@vilosource/pi-<name>` (the `pi-` prefix inside the scope is redundant for uniqueness but matches how the pi ecosystem reads packages) |
| Internal package npm name | `@vilosource-internal/<name>` |
| Required keywords | every published package: `pi-package` (so it appears in [pi.dev/packages](https://pi.dev/packages)) and `pi-extension` |

### 3.3 Per-package `package.json` shape

Public extension:

```json
{
  "name": "@vilosource/pi-<name>",
  "version": "0.1.0",
  "type": "module",
  "description": "<one-line>",
  "keywords": ["pi-package", "pi-extension"],
  "license": "MIT",
  "publishConfig": { "access": "public" },
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "bin": { "pi-<name>": "./dist/cli/index.js" },
  "pi": { "extensions": ["./dist/extension"] },
  "scripts": {
    "build": "tsc -b",
    "test":  "vitest run",
    "check": "biome check --write . && tsc --noEmit && vitest run"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.30.0"
  }
}
```

Every package must:

- Be ESM (`"type": "module"`).
- Build with TypeScript project references (fast incremental builds across the workspace).
- Pass `npm run check` at the root before merge.
- Have its own `README.md` (npm renders this) and `CHANGELOG.md` (Release Please maintains this).
- Use `peerDependencies` for `@mariozechner/pi-coding-agent`, never `dependencies` (avoids version conflicts inside pi).

### 3.4 Tooling

| Concern | Tool | Why |
|---|---|---|
| Workspace manager | **npm workspaces** | matches pi-mono; zero new tools to learn |
| Lint + format | **Biome** | matches pi-mono; one tool replaces eslint + prettier |
| Type checking | **TypeScript** with project references | incremental, atomic cross-package edits |
| Tests | **Vitest** | matches pi-mono |
| Versioning + changelog | **Release Please** | per-package semver; matches `jmcombs/pi-extensions` |
| npm publish auth | **npm Trusted Publishing (OIDC)** | no long-lived `NPM_TOKEN` in GH secrets; requires Node 24 in CI |
| Commit policy | **Conventional Commits** | drives Release Please; gated by commitlint |
| Pre-commit | **husky** + lint-staged (light) | only runs format on changed files |

We deliberately do **not** use Nx, Turborepo, pnpm, Lerna, or Changesets. They're all reasonable; npm workspaces + Release Please is reasonable too and matches the ecosystem we're a citizen of.

### 3.5 CI / release flow

1. PR opens → CI runs `npm run check` (lint + format + typecheck + tests for every workspace).
2. PR merged with Conventional Commits → Release Please opens or updates a "Release PR" for each affected package, with a generated CHANGELOG entry.
3. Maintainer merges the Release PR → tag is created → `release.yml` publishes to npm via OIDC.
4. Each package is **versioned independently** with semver. There is no monorepo version.

### 3.6 Branch protection on `main`

- Require pull request before merging.
- Require all CI checks green.
- Require linear history (no merge commits).
- Require Conventional Commits (commitlint check).
- No force pushes. No deletion.
- Maintainer admin bypass allowed for emergency hotfixes; document each use in CHANGELOG.

## 4. What does NOT belong in this repo

To stop scope creep before it starts:

- **mykb (`vilosource/mykb`)** — has its own release cadence, its own `~/.mykb/` brain integration, and a separate user community. Stays where it is. May reconsider after this repo proves out.
- **The remote dashboard server** — separate repo `vilosource/pi-usage-dashboard` (or similar). The extension sends OTel; the dashboard ingests it. They release independently.
- **Forks of pi-mono** — never. We are an extension citizen, not a fork maintainer.
- **Internal company secrets, IdP-specific hardcoded URLs, customer data** — never in published packages. Endpoint URLs and tokens go in the operator's `~/.config/pi-usage/config.json`, not the package.
- **Skills (SKILL.md folders)** without an accompanying extension — these can live here under `packages/skills/<name>/` for cohesion, but the moment they grow their own runtime they should be promoted to a real package.

## 5. Internal vs public scope rules

| Type | Example | Where it ships |
|---|---|---|
| Open source extension, useful to anyone | `@vilosource/pi-usage-reporter` (the extension itself — endpoint URL is config-driven, not hardcoded) | public npm |
| Internal-only bundle (e.g. preset config that points at our IdP, includes our team mappings) | `@vilosource-internal/pi-defaults` | private GitHub Packages registry |
| Private dependency shared by other packages in this repo | `@vilosource-internal/pi-shared` | private GitHub Packages registry |

The default is **public**. We only mark something internal if there's a specific reason — usually because the package contains environment-specific defaults that would be confusing or wrong for outside consumers.

## 6. Adding a new package

1. Create a feature branch.
2. `node scripts/new-package.mjs <name>` — copies `packages/_template/` → `packages/pi-<name>/`, fills in placeholders.
3. Write the design doc at `docs/design/pi-<name>-DESIGN.md` first; reference any RESEARCH.md.
4. Implement. Tests required for any non-trivial logic.
5. PR. Reviewer signs off; CI green.
6. Merge. Release Please opens a release PR.
7. Merge the release PR. Tag pushed. npm publish via OIDC.

## 7. Open questions intentionally deferred

- **Do we need a `@vilosource/pi-bundle` meta-package** that depends on our recommended set, so a new developer types `pi install npm:@vilosource/pi-bundle` and gets everything? Likely yes once we have 3+ packages; over-engineered today.
- **Do we adopt `pi-extmgr`** ([ayagmar.github.io/pi-extmgr](https://ayagmar.github.io/pi-extmgr/)) as the recommended manager for our developers? Worth a look once we have multiple internal packages.
- **Do we contribute back?** Some of our extensions will be generally useful (the OTel usage reporter probably is). Default policy: yes, ship them under `@vilosource/...` on public npm and they're discoverable in [pi.dev/packages](https://pi.dev/packages). Decide case-by-case for anything sensitive.

## 8. Decisions this document commits to

1. **Repo:** `vilosource/pi-extensions`, public, MIT.
2. **Layout:** monorepo with npm workspaces, packages under `packages/`.
3. **Public npm scope:** `@vilosource`. Internal scope: `@vilosource-internal` (private GitHub Packages).
4. **Each extension is independently versioned** via Release Please.
5. **Tooling:** npm workspaces + TypeScript project refs + Biome + Vitest + Release Please + OIDC publishing + Conventional Commits.
6. **Required keywords on every published package:** `pi-package`, `pi-extension`.
7. **Both install paths supported:** `pi install npm:@vilosource/pi-<name>` (single package) or `pi install git:github.com/vilosource/pi-extensions` (curated bundle, filterable in `settings.json`).
8. **Strict separation of code and configuration:** packages contain code; environment-specific values (endpoints, tokens, team mappings) live in operator-managed config files.
9. **mykb stays at `vilosource/mykb`** for now — not migrated.
10. **No fork of pi-mono.** Ever.
