import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAuthData } from "../auth/auth-file.js";
import { authFilePath } from "../auth/paths.js";
import { runLogout } from "./logout.js";

describe("runLogout", () => {
	let dir: string;
	const env = (): NodeJS.ProcessEnv => ({ TOKEN_TRACKER_CONFIG_DIR: dir });
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-tt-logout-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("removes the auth file and reports it", () => {
		writeAuthData({ accessToken: "AT", expiresAt: 1 }, env());
		const lines: string[] = [];
		expect(runLogout(env(), (l) => lines.push(l))).toBe(0);
		expect(existsSync(authFilePath(env()))).toBe(false);
		expect(lines.join(" ")).toMatch(/removed/i);
	});

	it("is a no-op when not signed in", () => {
		const lines: string[] = [];
		expect(runLogout(env(), (l) => lines.push(l))).toBe(0);
		expect(lines.join(" ")).toMatch(/Already signed out/i);
	});
});
