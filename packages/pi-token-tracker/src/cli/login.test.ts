import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAuthData } from "../auth/auth-file.js";
import { loadCliConfig } from "../auth/config.js";
import { clearDiscoveryCache } from "../auth/discovery.js";
import { type FakeIdp, fakeJwt, startFakeIdp } from "../auth/fake-idp.js";
import { parseArgs } from "./args.js";
import { runLogin } from "./login.js";

describe("runLogin", () => {
	let dir: string;
	let idp: FakeIdp;
	const env = (): NodeJS.ProcessEnv => ({ TOKEN_TRACKER_CONFIG_DIR: dir });
	beforeEach(() => {
		clearDiscoveryCache();
		dir = mkdtempSync(join(tmpdir(), "pi-tt-login-"));
	});
	afterEach(async () => {
		await idp?.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it("saves config and writes the credential on a successful device-flow login", async () => {
		idp = await startFakeIdp({
			interval: 1,
			devicePollResponses: [
				{
					status: 200,
					body: {
						access_token: "AT",
						refresh_token: "RT",
						expires_in: 3600,
						id_token: fakeJwt({ upn: "dev@example.invalid" }),
					},
				},
			],
		});
		const args = parseArgs([
			"login",
			"--endpoint=http://localhost:7080",
			`--authority=${idp.url}`,
			"--client-id=cid",
			"--api-scope=api://cid/access_as_user",
		]);
		const lines: string[] = [];
		const code = await runLogin(args, env(), (l) => lines.push(l));
		expect(code).toBe(0);
		expect(loadCliConfig(env())).toEqual({
			endpoint: "http://localhost:7080",
			authority: idp.url,
			clientId: "cid",
			apiScope: "api://cid/access_as_user",
		});
		const auth = readAuthData(env());
		expect(auth?.accessToken).toBe("AT");
		expect(auth?.refreshToken).toBe("RT");
		expect(lines.join("\n")).toMatch(/USER-CODE/);
		expect(lines.join("\n")).toMatch(/Signed in as dev@example\.invalid/);
	});

	it("fails with exit 2 and saves nothing when required config is missing", async () => {
		idp = await startFakeIdp();
		const lines: string[] = [];
		const code = await runLogin(parseArgs(["login"]), env(), (l) => lines.push(l));
		expect(code).toBe(2);
		expect(lines.join(" ")).toMatch(/missing required config/);
		expect(loadCliConfig(env())).toBeUndefined();
	});
});
