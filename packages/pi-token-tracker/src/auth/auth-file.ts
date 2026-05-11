/**
 * Read / write / delete `~/.config/token-tracker/auth.json` (mode 0600).
 *
 * Writes are atomic (write to a sibling temp file, then rename) so a
 * concurrent reader never sees a half-written file, and a crash mid-write
 * leaves the previous token intact.
 */

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { authFilePath } from "./paths.js";
import type { AuthData, OidcTokenResponse } from "./types.js";

export function readAuthData(env: NodeJS.ProcessEnv = process.env): AuthData | undefined {
	const path = authFilePath(env);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const o = parsed as Record<string, unknown>;
		if (typeof o["accessToken"] !== "string" || typeof o["expiresAt"] !== "number") return undefined;
		const data: AuthData = {
			accessToken: o["accessToken"],
			expiresAt: o["expiresAt"],
			...(typeof o["refreshToken"] === "string" ? { refreshToken: o["refreshToken"] } : {}),
			...(typeof o["idToken"] === "string" ? { idToken: o["idToken"] } : {}),
		};
		return data;
	} catch {
		return undefined;
	}
}

export function writeAuthData(data: AuthData, env: NodeJS.ProcessEnv = process.env): void {
	const path = authFilePath(env);
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.tmp`;
	const body = `${JSON.stringify(data, null, 2)}\n`;
	const fd = openSync(tmp, "w", 0o600);
	try {
		writeSync(fd, body);
	} finally {
		closeSync(fd);
	}
	try {
		renameSync(tmp, path);
	} catch (err) {
		try {
			rmSync(tmp, { force: true });
		} catch {
			// ignore cleanup failure
		}
		throw err;
	}
}

export function deleteAuthData(env: NodeJS.ProcessEnv = process.env): boolean {
	try {
		unlinkSync(authFilePath(env));
		return true;
	} catch {
		return false;
	}
}

/**
 * Build the persisted shape from a token-endpoint response. `expiresAt` is
 * derived from the response's `expires_in` relative to `now` (epoch seconds);
 * we deliberately do NOT trust the access token's own `exp` claim here since
 * the CLI doesn't verify the signature.
 */
export function authDataFromTokenResponse(
	resp: OidcTokenResponse,
	nowSeconds: number,
	previous?: AuthData | undefined,
): AuthData {
	const expiresIn = typeof resp.expires_in === "number" && resp.expires_in > 0 ? resp.expires_in : 3600;
	// A refresh response may omit refresh_token (the IdP keeps the old one valid)
	// — fall back to the previously-stored one so we don't lose it.
	const refreshToken = resp.refresh_token ?? previous?.refreshToken;
	const idToken = resp.id_token ?? previous?.idToken;
	return {
		accessToken: resp.access_token,
		expiresAt: nowSeconds + expiresIn,
		...(refreshToken !== undefined ? { refreshToken } : {}),
		...(idToken !== undefined ? { idToken } : {}),
	};
}
