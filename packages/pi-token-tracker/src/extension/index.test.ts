/**
 * Disabled-path coverage for the pi extension entry — the "never break pi"
 * guarantee: with no config / explicitly disabled / no credential, it warns
 * once and registers ZERO hooks. The enabled path (which starts the OTel SDK)
 * is exercised by the scenario test, not here.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import piTokenTracker from "./index.js";

type Handler = (...args: unknown[]) => unknown;
function fakePi(): { calls: [string, Handler][]; on(event: string, handler: Handler): void } {
	const calls: [string, Handler][] = [];
	return {
		calls,
		on(event, handler) {
			calls.push([event, handler]);
		},
	};
}

const KEYS = [
	"TOKEN_TRACKER_CONFIG_DIR",
	"TOKEN_TRACKER_ENABLED",
	"TOKEN_TRACKER_ENDPOINT",
	"TOKEN_TRACKER_AUTHORITY",
	"TOKEN_TRACKER_CLIENT_ID",
	"TOKEN_TRACKER_API_SCOPE",
	"TOKEN_TRACKER_VERBOSE",
] as const;

describe("piTokenTracker (disabled paths)", () => {
	let dir: string;
	let saved: Record<string, string | undefined>;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-tt-ext-"));
		saved = {};
		for (const k of KEYS) {
			saved[k] = process.env[k];
			delete process.env[k];
		}
		process.env["TOKEN_TRACKER_CONFIG_DIR"] = dir;
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
	});
	afterEach(() => {
		for (const k of KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
	});

	it("registers nothing and warns when TOKEN_TRACKER_ENABLED=false", () => {
		process.env["TOKEN_TRACKER_ENABLED"] = "false";
		const pi = fakePi();
		piTokenTracker(pi);
		expect(pi.calls).toHaveLength(0);
		expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/disabled/i));
	});

	it("registers nothing and warns when not configured", () => {
		const pi = fakePi();
		piTokenTracker(pi);
		expect(pi.calls).toHaveLength(0);
		expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/not configured/i));
	});

	it("registers nothing and warns when configured but no credential exists", () => {
		process.env["TOKEN_TRACKER_ENDPOINT"] = "https://backend.example";
		process.env["TOKEN_TRACKER_AUTHORITY"] = "https://issuer.example/v2.0";
		process.env["TOKEN_TRACKER_CLIENT_ID"] = "cid";
		process.env["TOKEN_TRACKER_API_SCOPE"] = "api://cid/access_as_user";
		const pi = fakePi();
		piTokenTracker(pi);
		expect(pi.calls).toHaveLength(0);
		expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/no stored credentials/i));
	});
});
