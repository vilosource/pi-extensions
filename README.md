# pi-extensions

Pi coding agent extensions and skills by **Vilosource** — usage telemetry, internal tools, and shared infrastructure.

This is a monorepo. Each extension is published as its own scoped npm package under `@vilosource/...` and is independently installable.

## Packages

| Package | Description | Status |
|---|---|---|
| `@vilosource/pi-usage-reporter` | Per-developer token usage and cost telemetry, shipped to a centralized OpenTelemetry collector and dashboard | Design |

(More to come — see [`docs/strategy/pi-extensions-monorepo-STRATEGY.md`](docs/strategy/pi-extensions-monorepo-STRATEGY.md) for why this repo exists and how it's organized.)

## Install

Each package can be installed individually from npm:

```bash
pi install npm:@vilosource/pi-usage-reporter
```

Or, for our internal developers, install the curated bundle:

```bash
pi install git:github.com/vilosource/pi-extensions
```

then filter to the packages you want in `~/.pi/agent/settings.json` per the [Pi packages docs](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md).

## Documentation

- [`docs/strategy/`](docs/strategy/) — repository organization decisions
- [`docs/design/`](docs/design/) — per-package design documents
- [`docs/research/`](docs/research/) — research briefs that informed designs

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). For agents (including AI agents) working in this repo, see [AGENTS.md](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).
