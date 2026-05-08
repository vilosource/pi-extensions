# Contributing

Thanks for your interest. This is a small, opinionated repository — please read the conventions before opening a PR.

## Before you open a PR

1. Read [`AGENTS.md`](AGENTS.md). It applies to humans too.
2. Read the relevant strategy doc in [`docs/strategy/`](docs/strategy/) for context.
3. If your change introduces a new architectural decision, also append an entry to [`docs/strategy/decisions-LOG.md`](docs/strategy/decisions-LOG.md).

## Boundary

This is a public repository. Real organization names other than `vilosource`, real FQDNs, real tokens, real Vault paths, and similar values must not appear in source. The denylist in [`scripts/check-public-boundary.sh`](scripts/check-public-boundary.sh) enforces this on every PR. See [`docs/strategy/public-boundary-STRATEGY.md`](docs/strategy/public-boundary-STRATEGY.md) for the full rules.

If you hit a false positive, add the file to [`.boundary-allowlist`](.boundary-allowlist) with a one-line justification, in the same PR.

## Commits

- One logical change per commit.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- Reference issues with `closes #N` / `fixes #N` when applicable.
- Stage explicit paths only; never `git add -A` or `git add .`.

## Branches

- Feature branches off `main`: `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
- We never open PRs directly to `main` from automated agents — humans review first.
- No force pushes to `main`. No `git reset --hard` on shared branches.

## Diagrams

All diagrams use Mermaid, rendered inline in Markdown. See [`AGENTS.md`](AGENTS.md) for the conventions (which diagram type for which purpose).

## Code

This repository currently contains documentation and tooling only. When package code lands under `packages/`, the per-package conventions (TypeScript project references, Biome lint+format, Vitest, Release Please) are documented in [`docs/strategy/pi-extensions-monorepo-STRATEGY.md`](docs/strategy/pi-extensions-monorepo-STRATEGY.md). PRs that land code must pass the standard CI gate (`npm run check`).

## Questions

Open an issue. We'll respond when we can.
