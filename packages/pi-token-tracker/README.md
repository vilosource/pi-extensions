# `@vilosource/pi-token-tracker`

Per-developer AI coding-agent token-usage telemetry over OpenTelemetry GenAI,
plus a device-flow login CLI for the [token-tracker](https://github.com/vilosource/token-tracker)
backend.

This package is the agent-side half of token-tracker: a **pi extension** that
emits one OTLP span per assistant turn to `${endpoint}/v1/traces`, and a
**`token-tracker` CLI** that does the OIDC device-flow sign-in and keeps the
access/refresh token in `~/.config/token-tracker/auth.json`. It replaces the
older `@vilosource/pi-usage-reporter` (which targeted the legacy `agent-spend`
backend); the two coexist until that stack is decommissioned.

## Auth model

The backend is a pure OAuth 2.0 resource server — it issues nothing and trusts
only tokens signed by the IdP. The CLI uses the **RFC 8628 device flow** (a
public-client flow needing no client secret): `token-tracker login` prints a
short code and URL, you authenticate in any browser, the CLI polls the IdP and
stores `{access_token, refresh_token, expires_at}`. Before each OTLP flush the
extension reads that file and, if the access token is within ~2 min of expiry,
silently exchanges the refresh token for a new one. The backend derives the
authoritative user identity from the verified token claims; the span's
`agent.user.id` is diagnostic only.

## Install (end users)

With a vanilla `pi` install:

```bash
npm i -g @vilosource/pi-token-tracker
token-tracker install                 # registers this extension in ~/.pi/agent/settings.json
token-tracker login \
  --endpoint=<backend-url> \
  --authority=<oidc-issuer-url> \
  --client-id=<public-client-id> \
  --api-scope=<api://...-access_as_user>
```

Restart `pi` and you're done — every assistant turn now ships a span to the
backend. `token-tracker status` shows the state; `token-tracker logout` clears
the credential; `token-tracker uninstall` removes the extension from pi's
settings. (`install`/`uninstall` are idempotent and preserve any other
extensions and the rest of `settings.json`. Override the settings path with
`--pi-settings=<path>` or `$TOKEN_TRACKER_PI_SETTINGS`.) For a specific
deployment the four `login` values are fixed — wrap the three commands in an
internal setup snippet so developers paste one line.

## CLI

```
token-tracker install [--pi-settings=<path>]
token-tracker login [--endpoint=<url> --authority=<oidc-issuer> --client-id=<id> --api-scope=<scope>]
token-tracker status
token-tracker logout
token-tracker uninstall [--pi-settings=<path>]
```

The four `login` options are required on the first run and saved to
`~/.config/token-tracker/config.json`; later runs reuse them. Each is also
overridable via the matching env var (`TOKEN_TRACKER_ENDPOINT`,
`TOKEN_TRACKER_AUTHORITY`, `TOKEN_TRACKER_CLIENT_ID`, `TOKEN_TRACKER_API_SCOPE`).

## Pi extension configuration

The extension self-disables (one stderr warning, then silence) unless the CLI
is configured **and** a credential exists — i.e. you've run `token-tracker
login`. Extra knobs:

| Env var | Purpose | Default |
|---|---|---|
| `TOKEN_TRACKER_ENABLED` | `false` hard-disables the extension | enabled |
| `TOKEN_TRACKER_ENVIRONMENT` | OTel `deployment.environment` resource attr | `prod` |
| `TOKEN_TRACKER_VERBOSE` | `1` → debug logging on stderr | silent |
| `TOKEN_TRACKER_BATCH_INTERVAL_MS` | OTel batch span export interval | `10000` |
| `TOKEN_TRACKER_CONFIG_DIR` | override the config/credential directory | `$XDG_CONFIG_HOME/token-tracker` or `~/.config/token-tracker` |

## Layout

```
src/
├── index.ts            public re-exports
├── shared/             pure modules (no IO) — types, OTel attribute mapping, cost classification
├── auth/               device flow + refresh + token cache
│   ├── config.ts       config.json + TOKEN_TRACKER_* env resolution
│   ├── auth-file.ts    ~/.config/token-tracker/auth.json (atomic, mode 0600)
│   ├── discovery.ts    OIDC .well-known discovery (cached)
│   ├── device-flow.ts  RFC 8628 device-code request + poll
│   ├── refresh.ts      refresh_token grant
│   └── access-token.ts getValidAccessToken — read / refresh-if-near-expiry / persist
├── extension/          pi entry point + identity + OTel adapter
└── cli/                the `token-tracker` binary
```

`src/shared/` is IO-free, enforced by the dependency-cruiser `shared-is-pure`
rule. The `auth/`, `extension/`, and `cli/` layers perform IO.

## Notes / limitations (v1)

- The refresh token is stored at rest in `~/.config/token-tracker/auth.json`
  with mode `0600` — same posture as the `gh` / `az` / `gcloud` CLIs.
  OS-keychain integration is a possible future enhancement.
- The backend ingests OTLP **traces** only (it absorbed the OTel Collector
  upstream), so this package registers no metric exporter.
- The extension's effect on `pi` is fail-safe: if it isn't configured, isn't
  signed in, or the backend is unreachable, it emits at most one stderr line
  and otherwise does nothing — telemetry failures never affect your session.

## Local smoke test against the token-tracker lab

```bash
# 1. Bring up the token-tracker source repo's lab (its own IdP + API + Postgres)
cd ~/GitHub/token-tracker && make lab

# 2. Build this package
cd ~/GitHub/pi-extensions && npm run build

# 3. Sign in against the lab IdP (values from `make lab` output / lab/idp config)
node packages/pi-token-tracker/dist/cli/index.js login \
  --endpoint=http://localhost:7080 \
  --authority=<lab-idp-issuer-url> \
  --client-id=<lab-client-id> \
  --api-scope=<lab-api-scope>
node packages/pi-token-tracker/dist/cli/index.js status

# 4. Run pi with this extension loaded and confirm a usage_log row lands
#    (TOKEN_TRACKER_ENDPOINT defaults to the saved config; verbose for debugging)
TOKEN_TRACKER_VERBOSE=1 pi
#    then: make psql  →  select * from usage_log order by ts desc limit 5;
```
