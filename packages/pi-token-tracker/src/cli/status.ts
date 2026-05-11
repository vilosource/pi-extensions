/**
 * `token-tracker status` — prints whether the CLI is configured, whether
 * there are stored credentials, the signed-in user, and the access-token
 * expiry. Read-only; touches nothing.
 */

import { readAuthData } from "../auth/auth-file.js";
import { loadCliConfig } from "../auth/config.js";
import { decodeJwtClaims, userIdFromClaims } from "../auth/jwt.js";
import { authFilePath, configFilePath } from "../auth/paths.js";

type Logger = (line: string) => void;

export function runStatus(env: NodeJS.ProcessEnv, log: Logger): number {
	const config = loadCliConfig(env);
	if (config === undefined) {
		log("Not configured. Run:");
		log("  token-tracker login --endpoint=<url> --authority=<oidc-issuer> --client-id=<id> --api-scope=<scope>");
		return 1;
	}
	log(`Config file:  ${configFilePath(env)}`);
	log(`Endpoint:     ${config.endpoint}`);
	log(`Authority:    ${config.authority}`);
	log(`Client id:    ${config.clientId}`);
	log(`API scope:    ${config.apiScope}`);

	const auth = readAuthData(env);
	if (auth === undefined) {
		log("");
		log("Not signed in. Run `token-tracker login`.");
		return 1;
	}
	const who = userIdFromClaims(decodeJwtClaims(auth.idToken ?? auth.accessToken));
	const nowSeconds = Math.floor(Date.now() / 1000);
	const secsLeft = auth.expiresAt - nowSeconds;
	const expiry = new Date(auth.expiresAt * 1000).toISOString();
	log("");
	log(`Auth file:    ${authFilePath(env)}`);
	log(`Signed in as: ${who ?? "(unknown — could not decode token)"}`);
	log(
		secsLeft > 0
			? `Access token: valid, expires ${expiry} (${Math.floor(secsLeft / 60)} min from now)`
			: `Access token: EXPIRED at ${expiry}`,
	);
	log(
		`Refresh token: ${auth.refreshToken !== undefined ? "stored (silent refresh enabled)" : "NOT stored — re-login needed on expiry"}`,
	);
	return secsLeft > 0 || auth.refreshToken !== undefined ? 0 : 1;
}
