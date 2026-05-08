# pi-extensions

Pi coding agent extensions and skills by **Vilosource** — usage telemetry, internal tools, and shared infrastructure.

This is a monorepo. Each extension is published as its own scoped npm package under `@vilosource/...` and is independently installable. See [`docs/strategy/pi-extensions-monorepo-STRATEGY.md`](docs/strategy/pi-extensions-monorepo-STRATEGY.md) for why this repo exists and how it's organized.

## Packages

| Package | Description | Status |
|---|---|---|
| `@vilosource/pi-usage-reporter` | Per-developer token usage and cost telemetry, shipped over OpenTelemetry to a centralized Grafana stack and Postgres-backed dashboard | Design ([DESIGN](docs/design/pi-usage-reporter-DESIGN.md), [research](docs/research/usage-tracking-dashboard-RESEARCH.md)) |

(More to come.)

## Install

Each package can be installed individually from npm:

```bash
pi install npm:@vilosource/pi-usage-reporter
```

Or, for a curated bundle of the whole repo:

```bash
pi install git:github.com/vilosource/pi-extensions
```

then filter to the packages you want in `~/.pi/agent/settings.json` per the [Pi packages docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md).

## Companion repo

The **dashboard** that consumes OTel events from this extension lives in a separate repository: [`vilosource/agent-spend-dashboard`](https://github.com/vilosource/agent-spend-dashboard). It is harness-agnostic — future Claude Code, Cursor, or Aider extensions emit the same `agent.*` attributes to the same dashboard. See [`docs/strategy/scope-and-deployment-STRATEGY.md`](docs/strategy/scope-and-deployment-STRATEGY.md) for the three-artifact split.

## Documentation

### Strategy

Cross-cutting decisions that apply to every package in this repo.

| Doc | Subject |
|---|---|
| [`scope-and-deployment-STRATEGY.md`](docs/strategy/scope-and-deployment-STRATEGY.md) | Three-artifact split (extension, reference dashboard server, organization deployments). Read this first. |
| [`public-boundary-STRATEGY.md`](docs/strategy/public-boundary-STRATEGY.md) | What may and may not appear in public artifacts; CI enforcement |
| [`pi-extensions-monorepo-STRATEGY.md`](docs/strategy/pi-extensions-monorepo-STRATEGY.md) | Why monorepo, why npm workspaces, naming conventions, tooling, release flow |
| [`dashboard-backend-STRATEGY.md`](docs/strategy/dashboard-backend-STRATEGY.md) | Reference dashboard server: Grafana + Postgres dual backend; phased delivery order |
| [`decisions-LOG.md`](docs/strategy/decisions-LOG.md) | Append-only log of small settled decisions |

### Design

Per-package design documents.

| Doc | Package |
|---|---|
| [`pi-usage-reporter-DESIGN.md`](docs/design/pi-usage-reporter-DESIGN.md) | `@vilosource/pi-usage-reporter` |

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
