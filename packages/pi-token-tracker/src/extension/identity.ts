/**
 * Resolve the `Identity` attached to emitted spans.
 *
 * - `machineId` — a stable per-machine UUID persisted at
 *   `~/.config/token-tracker/machine-id` (mode 0600). Regenerated if the
 *   file is missing or unreadable.
 * - `userId` — best-effort, diagnostic only: the `upn` /
 *   `preferred_username` / `email` claim decoded (NOT verified) from the
 *   cached access token. Falls back to `machine:<uuid>` when no token is
 *   available. The server derives the authoritative identity from the
 *   verified token claims (ADR D8), so this value is never trusted.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readAuthData } from "../auth/auth-file.js";
import { decodeJwtClaims, userIdFromClaims } from "../auth/jwt.js";
import { machineIdFilePath } from "../auth/paths.js";
import type { Identity } from "../shared/types.js";

export function resolveIdentity(env: NodeJS.ProcessEnv = process.env): Identity {
	const machineId = resolveMachineId(env);
	const auth = readAuthData(env);
	const fromToken = auth !== undefined ? userIdFromClaims(decodeJwtClaims(auth.accessToken)) : undefined;
	return { userId: fromToken ?? `machine:${machineId}`, machineId };
}

function resolveMachineId(env: NodeJS.ProcessEnv): string {
	const path = machineIdFilePath(env);
	if (existsSync(path)) {
		try {
			const existing = readFileSync(path, "utf8").trim();
			if (existing.length > 0) return existing;
		} catch {
			// Unreadable — regenerate below.
		}
	}
	const fresh = randomUUID();
	try {
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		writeFileSync(path, `${fresh}\n`, { mode: 0o600 });
	} catch {
		// Cannot persist — return the UUID anyway; it will regenerate next run.
	}
	return fresh;
}
