import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insecureUrlWarnings, loadCliConfig, saveCliConfig } from "./config.js";
import type { CliConfig } from "./types.js";

const CFG: CliConfig = {
	endpoint: "https://backend.example",
	authority: "https://issuer.example/v2.0",
	clientId: "cid",
	apiScope: "api://cid/access_as_user",
};

describe("loadCliConfig / saveCliConfig", () => {
	let dir: string;
	const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ TOKEN_TRACKER_CONFIG_DIR: dir, ...extra });
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-tt-cfg-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("returns undefined when nothing is configured", () => {
		expect(loadCliConfig(env())).toBeUndefined();
	});

	it("returns undefined when only some fields are present", () => {
		writeFileSync(join(dir, "config.json"), JSON.stringify({ endpoint: "https://x" }));
		expect(loadCliConfig(env())).toBeUndefined();
	});

	it("round-trips a full config through save → load", () => {
		saveCliConfig(CFG, env());
		expect(loadCliConfig(env())).toEqual(CFG);
	});

	it("strips trailing slashes from endpoint/authority", () => {
		saveCliConfig(
			{ ...CFG, endpoint: "https://backend.example/", authority: "https://issuer.example/v2.0//" },
			env(),
		);
		const loaded = loadCliConfig(env());
		expect(loaded?.endpoint).toBe("https://backend.example");
		expect(loaded?.authority).toBe("https://issuer.example/v2.0");
	});

	it("lets env vars override the file", () => {
		saveCliConfig(CFG, env());
		const loaded = loadCliConfig(env({ TOKEN_TRACKER_ENDPOINT: "https://override.example" }));
		expect(loaded?.endpoint).toBe("https://override.example");
		expect(loaded?.authority).toBe(CFG.authority);
	});

	it("writes config.json with mode 0600 and a trailing newline", () => {
		saveCliConfig(CFG, env());
		expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
		expect(readFileSync(join(dir, "config.json"), "utf8").endsWith("\n")).toBe(true);
	});
});

describe("insecureUrlWarnings", () => {
	it("warns for plaintext non-loopback endpoint/authority", () => {
		expect(insecureUrlWarnings({ ...CFG, endpoint: "http://prod.example" })).toHaveLength(1);
		expect(
			insecureUrlWarnings({ ...CFG, endpoint: "http://prod.example", authority: "http://idp.example" }),
		).toHaveLength(2);
	});
	it("does not warn for https or loopback http", () => {
		expect(insecureUrlWarnings(CFG)).toHaveLength(0);
		expect(
			insecureUrlWarnings({ ...CFG, endpoint: "http://localhost:7080", authority: "http://127.0.0.1:7019" }),
		).toHaveLength(0);
	});
});
