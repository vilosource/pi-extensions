import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAuthData } from "../auth/auth-file.js";
import { fakeJwt } from "../auth/fake-idp.js";
import { machineIdFilePath } from "../auth/paths.js";
import { resolveIdentity } from "./identity.js";

describe("resolveIdentity", () => {
	let dir: string;
	const env = (): NodeJS.ProcessEnv => ({ TOKEN_TRACKER_CONFIG_DIR: dir });
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-tt-id-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("persists a stable machine id and reuses it", () => {
		const a = resolveIdentity(env());
		expect(existsSync(machineIdFilePath(env()))).toBe(true);
		expect(a.machineId).toMatch(/^[0-9a-f-]{36}$/);
		const b = resolveIdentity(env());
		expect(b.machineId).toBe(a.machineId);
		expect(readFileSync(machineIdFilePath(env()), "utf8").trim()).toBe(a.machineId);
	});

	it("derives userId from the access-token claims when an auth file exists", () => {
		writeAuthData({ accessToken: fakeJwt({ upn: "dev@example.invalid" }), expiresAt: 1 }, env());
		expect(resolveIdentity(env()).userId).toBe("dev@example.invalid");
	});

	it("falls back to machine:<uuid> when there is no auth file", () => {
		const id = resolveIdentity(env());
		expect(id.userId).toBe(`machine:${id.machineId}`);
	});

	it("falls back to machine:<uuid> when the token has no usable claim", () => {
		writeAuthData({ accessToken: fakeJwt({ sub: "no-name-here" }), expiresAt: 1 }, env());
		const id = resolveIdentity(env());
		expect(id.userId).toBe(`machine:${id.machineId}`);
	});
});
