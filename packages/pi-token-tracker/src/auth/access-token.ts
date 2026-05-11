/**
 * `getValidAccessToken` — the single entry point the OTel exporter (and the
 * CLI) use to obtain a bearer token for `${endpoint}/v1/traces`.
 *
 * Behaviour, per the token-tracker redesign §4.3 ("silent refresh on every
 * flush") and its risk note ("refresh failure mid-flush → log a warning,
 * drop the spans for that batch; don't buffer to disk in v1"):
 *
 *   1. Not configured (no config.json / env)            → undefined
 *   2. No auth.json (never ran `token-tracker login`)   → undefined
 *   3. Cached access token still valid (> skew left)    → return it
 *   4. Expired/near-expiry, refresh token present       → refresh, persist, return new token
 *   5. Expired, no refresh token                        → warn, undefined
 *   6. Refresh attempt throws                           → warn, undefined (auth.json left intact)
 *
 * In cases 1/2/5/6 the exporter sends no Authorization header; the server
 * answers 401 and the SDK drops that batch. Telemetry failures never affect
 * the host pi process.
 */

import { authDataFromTokenResponse, readAuthData, writeAuthData } from "./auth-file.js";
import { loadCliConfig } from "./config.js";
import { discoverEndpoints } from "./discovery.js";
import { refreshAccessToken } from "./refresh.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GetAccessTokenOptions {
	readonly env?: NodeJS.ProcessEnv;
	/** Override "now" in epoch milliseconds. Used by tests. */
	readonly now?: number;
	/** Refresh when fewer than this many seconds remain. Default: 120. */
	readonly refreshSkewSeconds?: number;
	readonly fetchImpl?: FetchLike;
	/** Called once with a human message when a token can't be produced. */
	readonly onWarn?: (message: string) => void;
}

export async function getValidAccessToken(opts: GetAccessTokenOptions = {}): Promise<string | undefined> {
	const env = opts.env ?? process.env;
	const config = loadCliConfig(env);
	if (config === undefined) return undefined;
	const auth = readAuthData(env);
	if (auth === undefined) return undefined;

	const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
	const skew = opts.refreshSkewSeconds ?? 120;
	if (auth.expiresAt - nowSeconds > skew) {
		return auth.accessToken;
	}

	if (auth.refreshToken === undefined) {
		opts.onWarn?.("access token expired and no refresh token is stored — run `token-tracker login`");
		return undefined;
	}

	try {
		const endpoints = await discoverEndpoints(config.authority, opts.fetchImpl ?? fetch);
		const resp = await refreshAccessToken(config, endpoints, auth.refreshToken, opts.fetchImpl ?? fetch);
		const next = authDataFromTokenResponse(resp, nowSeconds, auth);
		writeAuthData(next, env);
		return next.accessToken;
	} catch (err) {
		opts.onWarn?.(
			`token refresh failed (${err instanceof Error ? err.message : String(err)}) — run \`token-tracker login\` if this persists`,
		);
		return undefined;
	}
}
