import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAuthData } from "../auth/auth-file.js";
import { saveCliConfig } from "../auth/config.js";
import { fakeJwt } from "../auth/fake-idp.js";
import type { CliConfig } from "../auth/types.js";
import { runStatus } from "./status.js";

const CFG: CliConfig = {
	endpoint: "https://backend.example",
	authority: "https://issuer.example/v2.0",
	clientId: "cid",
	apiScope: "api://cid/access_as_user",
};

describe("runStatus", () => {
	let dir: string;
	const env = (): NodeJS.ProcessEnv => ({ TOKEN_TRACKER_CONFIG_DIR: dir });
	const run = (): { code: number; out: string } => {
		const lines: string[] = [];
		const code = runStatus(env(), (l) => lines.push(l));
		return { code, out: lines.join("\n") };
	};
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-tt-status-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("reports not-configured (exit 1)", () => {
		const { code, out } = run();
		expect(code).toBe(1);
		expect(out).toMatch(/Not configured/);
	});

	it("reports configured-but-not-signed-in (exit 1)", () => {
		saveCliConfig(CFG, env());
		const { code, out } = run();
		expect(code).toBe(1);
		expect(out).toMatch(/Not signed in/);
		expect(out).toContain(CFG.endpoint);
	});

	it("reports signed-in with a valid token (exit 0)", () => {
		saveCliConfig(CFG, env());
		writeAuthData(
			{
				accessToken: fakeJwt({ upn: "dev@example.invalid" }),
				refreshToken: "RT",
				expiresAt: Math.floor(Date.now() / 1000) + 3600,
			},
			env(),
		);
		const { code, out } = run();
		expect(code).toBe(0);
		expect(out).toMatch(/dev@example\.invalid/);
		expect(out).toMatch(/valid/);
		expect(out).toMatch(/silent refresh enabled/);
	});

	it("flags an expired token with no refresh token (exit 1)", () => {
		saveCliConfig(CFG, env());
		writeAuthData({ accessToken: fakeJwt({ upn: "x@y" }), expiresAt: Math.floor(Date.now() / 1000) - 5 }, env());
		const { code, out } = run();
		expect(code).toBe(1);
		expect(out).toMatch(/EXPIRED/);
	});

	it("warns about a plaintext non-loopback endpoint", () => {
		saveCliConfig({ ...CFG, endpoint: "http://prod.example" }, env());
		expect(run().out).toMatch(/plaintext http/);
	});
});
