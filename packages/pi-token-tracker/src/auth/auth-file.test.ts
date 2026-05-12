import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authDataFromTokenResponse, deleteAuthData, readAuthData, writeAuthData } from "./auth-file.js";
import type { AuthData } from "./types.js";

describe("auth-file", () => {
	let dir: string;
	const env = (): NodeJS.ProcessEnv => ({ TOKEN_TRACKER_CONFIG_DIR: dir });
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-tt-auth-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("round-trips, writes mode 0600, leaves no temp file", () => {
		const data: AuthData = { accessToken: "AT", refreshToken: "RT", idToken: "IT", expiresAt: 1234 };
		writeAuthData(data, env());
		expect(readAuthData(env())).toEqual(data);
		expect(statSync(join(dir, "auth.json")).mode & 0o777).toBe(0o600);
		expect(readdirSync(dir)).toEqual(["auth.json"]);
	});

	it("returns undefined for a missing or malformed file", () => {
		expect(readAuthData(env())).toBeUndefined();
		writeFileSync(join(dir, "auth.json"), "{ not json");
		expect(readAuthData(env())).toBeUndefined();
		writeFileSync(join(dir, "auth.json"), JSON.stringify({ refreshToken: "RT" })); // no accessToken/expiresAt
		expect(readAuthData(env())).toBeUndefined();
	});

	it("deleteAuthData removes the file and is idempotent", () => {
		writeAuthData({ accessToken: "AT", expiresAt: 1 }, env());
		expect(deleteAuthData(env())).toBe(true);
		expect(readAuthData(env())).toBeUndefined();
		expect(deleteAuthData(env())).toBe(false);
	});

	it("authDataFromTokenResponse derives expiresAt and keeps the previous refresh/id token when omitted", () => {
		const prev: AuthData = { accessToken: "old", refreshToken: "RT-OLD", idToken: "IT-OLD", expiresAt: 1 };
		const d = authDataFromTokenResponse({ access_token: "new", expires_in: 3600 }, 1000, prev);
		expect(d.accessToken).toBe("new");
		expect(d.expiresAt).toBe(1000 + 3600);
		expect(d.refreshToken).toBe("RT-OLD");
		expect(d.idToken).toBe("IT-OLD");
	});

	it("authDataFromTokenResponse prefers a fresh refresh token and defaults expires_in", () => {
		const d = authDataFromTokenResponse({ access_token: "new", refresh_token: "RT-NEW" }, 1000);
		expect(d.refreshToken).toBe("RT-NEW");
		expect(d.expiresAt).toBe(1000 + 3600);
	});
});
