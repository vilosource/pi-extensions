/**
 * `token-tracker logout` — deletes `~/.config/token-tracker/auth.json`. The
 * connection config (`config.json`) is kept so a later `token-tracker login`
 * doesn't need the flags again.
 *
 * v1 does not call the IdP's end-session endpoint: for a public-client
 * device-flow token there is no server-side session to terminate, and the
 * refresh token simply ages out per IdP policy. (A future `--revoke` could
 * hit the IdP's token-revocation endpoint if one is published.)
 */

import { deleteAuthData } from "../auth/auth-file.js";

type Logger = (line: string) => void;

export function runLogout(env: NodeJS.ProcessEnv, log: Logger): number {
	const removed = deleteAuthData(env);
	log(removed ? "Signed out — stored credentials removed." : "Already signed out (no stored credentials).");
	return 0;
}
