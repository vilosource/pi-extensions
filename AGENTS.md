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
