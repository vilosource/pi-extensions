/**
 * Extension configuration.
 *
 * Reads PI_USAGE_* env vars with sane defaults. Per the design doc §3.12,
 * the extension stays single-config-line for normal users; knobs exist for
 * unusual cases.
 *
 * If no endpoint is set, the extension is `enabled: false` and no-ops.
 * Per D11 (forthcoming), telemetry never affects the user's pi session.
 */

export interface Config {
	readonly enabled: boolean;
	readonly endpoint: string | undefined;
	readonly token: string | undefined;
	readonly environment: string;
	readonly verbose: boolean;
	readonly batchIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const explicitDisable = env["PI_USAGE_ENABLED"] === "false";
	const endpoint = env["PI_USAGE_ENDPOINT"];
	const token = env["PI_USAGE_TOKEN"];

	// No endpoint = disabled. Print one warning at init, then never speak again.
	const enabled = !explicitDisable && Boolean(endpoint);

	return {
		enabled,
		endpoint,
		token,
		environment: env["PI_USAGE_ENVIRONMENT"] ?? "prod",
		verbose: env["PI_USAGE_VERBOSE"] === "1",
		batchIntervalMs: parseIntOr(env["PI_USAGE_BATCH_INTERVAL_MS"], 10_000),
	};
}

function parseIntOr(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}
