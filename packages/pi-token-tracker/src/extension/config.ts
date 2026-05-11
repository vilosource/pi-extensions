/**
 * Extension knobs read from `TOKEN_TRACKER_*` env vars. The connection
 * config (endpoint / authority / clientId / apiScope) lives in the auth
 * module's `config.json`; this file only carries the small behavioural
 * overrides the extension itself needs.
 */

export interface ExtensionConfig {
	/** `TOKEN_TRACKER_ENABLED=false` hard-disables the extension. */
	readonly explicitlyDisabled: boolean;
	/** OTel `deployment.environment` resource attribute. Default `prod`. */
	readonly environment: string;
	/** `TOKEN_TRACKER_VERBOSE=1` → debug logging on stderr. Default silent. */
	readonly verbose: boolean;
	/** OTel batch span export interval, ms. Default 10000. */
	readonly batchIntervalMs: number;
}

export function loadExtensionConfig(env: NodeJS.ProcessEnv = process.env): ExtensionConfig {
	return {
		explicitlyDisabled: env["TOKEN_TRACKER_ENABLED"] === "false",
		environment: env["TOKEN_TRACKER_ENVIRONMENT"] ?? "prod",
		verbose: env["TOKEN_TRACKER_VERBOSE"] === "1",
		batchIntervalMs: parseIntOr(env["TOKEN_TRACKER_BATCH_INTERVAL_MS"], 10_000),
	};
}

function parseIntOr(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}
