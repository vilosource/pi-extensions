/**
 * `token-tracker login` — first run records the connection config in
 * `~/.config/token-tracker/config.json`, then runs the RFC 8628 device
 * flow and writes the resulting tokens to `~/.config/token-tracker/auth.json`
 * (mode 0600). Subsequent runs reuse the saved config (flags / env still
 * override).
 */

import { authDataFromTokenResponse, writeAuthData } from "../auth/auth-file.js";
import { insecureUrlWarnings, loadCliConfig, saveCliConfig } from "../auth/config.js";
import { pollForToken, requestDeviceCode } from "../auth/device-flow.js";
import { discoverEndpoints } from "../auth/discovery.js";
import { decodeJwtClaims, userIdFromClaims } from "../auth/jwt.js";
import { authFilePath } from "../auth/paths.js";
import type { CliConfig } from "../auth/types.js";
import { flagString, type ParsedArgs } from "./args.js";

type Logger = (line: string) => void;

function resolveConfig(args: ParsedArgs, env: NodeJS.ProcessEnv): CliConfig {
	const existing = loadCliConfig(env);
	const endpoint = flagString(args, "endpoint") ?? env["TOKEN_TRACKER_ENDPOINT"] ?? existing?.endpoint;
	const authority = flagString(args, "authority") ?? env["TOKEN_TRACKER_AUTHORITY"] ?? existing?.authority;
	const clientId = flagString(args, "client-id") ?? env["TOKEN_TRACKER_CLIENT_ID"] ?? existing?.clientId;
	const apiScope = flagString(args, "api-scope") ?? env["TOKEN_TRACKER_API_SCOPE"] ?? existing?.apiScope;
	const missing = [
		["--endpoint", endpoint],
		["--authority", authority],
		["--client-id", clientId],
		["--api-scope", apiScope],
	]
		.filter(([, v]) => v === undefined || v === "")
		.map(([k]) => k);
	if (missing.length > 0) {
		throw new Error(
			`missing required config: ${missing.join(", ")}. Pass them on the first \`token-tracker login\` (or set TOKEN_TRACKER_* env vars).`,
		);
	}
	return {
		// non-null: presence checked above
		endpoint: (endpoint as string).replace(/\/+$/, ""),
		authority: (authority as string).replace(/\/+$/, ""),
		clientId: clientId as string,
		apiScope: apiScope as string,
	};
}

export async function runLogin(args: ParsedArgs, env: NodeJS.ProcessEnv, log: Logger): Promise<number> {
	let config: CliConfig;
	try {
		config = resolveConfig(args, env);
	} catch (err) {
		log(err instanceof Error ? err.message : String(err));
		return 2;
	}
	saveCliConfig(config, env);
	for (const w of insecureUrlWarnings(config)) log(`warning: ${w}`);

	const endpoints = await discoverEndpoints(config.authority);
	const device = await requestDeviceCode(config, endpoints);

	log("");
	log("To sign in, open this URL in a browser and enter the code:");
	log(`    ${device.verificationUri}`);
	log(`    code: ${device.userCode}`);
	if (device.verificationUriComplete !== undefined) {
		log(`  (or open directly: ${device.verificationUriComplete})`);
	}
	log("");
	log("Waiting for you to finish signing in...");

	const token = await pollForToken(config, endpoints, device.deviceCode, {
		intervalSeconds: device.interval,
		expiresInSeconds: device.expiresIn,
	});
	const nowSeconds = Math.floor(Date.now() / 1000);
	const auth = authDataFromTokenResponse(token, nowSeconds);
	writeAuthData(auth, env);

	const who = userIdFromClaims(decodeJwtClaims(auth.idToken ?? auth.accessToken));
	log(`Signed in${who !== undefined ? ` as ${who}` : ""}. Credentials saved to ${authFilePath(env)}.`);
	if (auth.refreshToken === undefined) {
		log(
			"Note: the IdP did not return a refresh token — you'll need to run `token-tracker login` again when this access token expires.",
		);
	}
	return 0;
}
