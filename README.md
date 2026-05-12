# pi-extensions

Pi coding agent extensions and skills by **Vilosource** — usage telemetry, internal tools, and shared infrastructure.

This is a monorepo. Each extension is published as its own scoped npm package under `@vilosource/...` and is independently installable. See [`docs/strategy/pi-extensions-monorepo-STRATEGY.md`](docs/strategy/pi-extensions-monorepo-STRATEGY.md) for why this repo exists and how it's organized.

## Packages

| Package | Description | Status |
|---|---|---|
| `@vilosource/pi-token-tracker` | Per-developer AI coding-agent token-usage telemetry over OpenTelemetry GenAI to the [token-tracker](https://github.com/vilosource/token-tracker) backend, plus a `token-tracker` device-flow login CLI (`install` / `login` / `status` / `logout` / `uninstall`) | 148 unit tests + a green lab end-to-end smoke (`npm run smoke`). Pre-publish. ([README](packages/pi-token-tracker/README.md)) |

> `@vilosource/pi-usage-reporter` (the predecessor, which targeted the legacy `agent-spend` backend) was **removed 2026-05-12** when that backend was decommissioned — superseded by `@vilosource/pi-token-tracker`. Its design notes are kept at [`docs/design/pi-usage-reporter-DESIGN.md`](docs/design/pi-usage-reporter-DESIGN.md) for history.

## Install

```bash
npm i -g @vilosource/pi-token-tracker
token-tracker install                # registers the extension in ~/.pi/agent/settings.json
token-tracker login --endpoint=… --authority=… --client-id=… --api-scope=…
```

See [`packages/pi-token-tracker/README.md`](packages/pi-token-tracker/README.md) for the full setup. For a specific deployment the four `login` values are fixed — wrap the three commands in an internal setup snippet so developers paste one line.

## Companion repo

The **dashboard** that consumes the OTel events lives in a separate repository: [`vilosource/token-tracker`](https://github.com/vilosource/token-tracker) (formerly `agent-spend-dashboard`). It is harness-agnostic — future Claude Code, Cursor, or Aider extensions emit the same `agent.*` attributes to the same dashboard. See [`docs/strategy/scope-and-deployment-STRATEGY.md`](docs/strategy/scope-and-deployment-STRATEGY.md) for the three-artifact split.

## Documentation

### Strategy

Cross-cutting decisions that apply to every package in this repo.

| Doc | Subject |
|---|---|
| [`scope-and-deployment-STRATEGY.md`](docs/strategy/scope-and-deployment-STRATEGY.md) | Three-artifact split (extension, reference dashboard server, organization deployments). Read this first. |
| [`public-boundary-STRATEGY.md`](docs/strategy/public-boundary-STRATEGY.md) | What may and may not appear in public artifacts; CI enforcement |
| [`pi-extensions-monorepo-STRATEGY.md`](docs/strategy/pi-extensions-monorepo-STRATEGY.md) | Why monorepo, why npm workspaces, naming conventions, tooling, release flow |
| [`dashboard-backend-STRATEGY.md`](docs/strategy/dashboard-backend-STRATEGY.md) | Reference dashboard server: Grafana + Postgres dual backend; phased delivery order |
| [`architecture-PRINCIPLES.md`](docs/strategy/architecture-PRINCIPLES.md) | What we believe about code quality and how it is mechanically enforced |
| [`decisions-LOG.md`](docs/strategy/decisions-LOG.md) | Append-only log of small settled decisions |

### Design

Per-package design documents.

| Doc | Package |
|---|---|
| [`pi-usage-reporter-DESIGN.md`](docs/design/pi-usage-reporter-DESIGN.md) | `@vilosource/pi-usage-reporter` — **historical** (package removed 2026-05-12); the successor `@vilosource/pi-token-tracker`'s design lives upstream in [`vilosource/token-tracker` → `docs/design/token-tracker-redesign-DESIGN.md`](https://github.com/vilosource/token-tracker/blob/main/docs/design/token-tracker-redesign-DESIGN.md) |

### Research

Research briefs that informed the strategies and designs.

| Doc | Topic |
|---|---|
| [`usage-tracking-dashboard-RESEARCH.md`](docs/research/usage-tracking-dashboard-RESEARCH.md) | State of the art for tracking pi-mono token usage and shipping it to a multi-user dashboard |

## Diagrams

All diagrams in this repo use **Mermaid**, rendered inline in Markdown. See [`AGENTS.md`](AGENTS.md) for the full convention.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). For agents (including AI agents) working in this repo, see [AGENTS.md](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).
