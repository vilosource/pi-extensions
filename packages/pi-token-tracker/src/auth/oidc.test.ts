/**
 * Auth-module tests against an in-process fake OIDC IdP: device-flow
 * sign-in (incl. authorization_pending / slow_down / access_denied / expiry)
 * and the silent-refresh dance behind `getValidAccessToken`.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getValidAccessToken } from "./access-token.js";
import { readAuthData, writeAuthData } from "./auth-file.js";
import { pollForToken, requestDeviceCode } from "./device-flow.js";
import { clearDiscoveryCache, discoverEndpoints } from "./discovery.js";
import { refreshAccessToken } from "./refresh.js";
import type { CliConfig } from "./types.js";

// ---- fake IdP -------------------------------------------------------------

interface ScriptedResponse {
	readonly status: number;
	readonly body: unknown;
}
interface FakeIdpScript {
	readonly devicePollResponses?: ScriptedResponse[];
	readonly refreshResponses?: ScriptedResponse[];
	readonly interval?: number;
	readonly expiresIn?: number;
	readonly omitDeviceEndpointInDiscovery?: boolean;
}
interface FakeIdp {
	readonly url: string;
	readonly tokenRequests: Record<string, string>[];
	close(): Promise<void>;
}

const DEVICE_CODE = "DEV-CODE";

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let d = "";
		req.on("data", (c) => {
			d += c;
		});
		req.on("end", () => resolve(d));
	});
}
function send(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

async function startFakeIdp(script: FakeIdpScript = {}): Promise<FakeIdp> {
	const devicePoll = [...(script.devicePollResponses ?? [])];
	const refresh = [...(script.refreshResponses ?? [])];
	const tokenRequests: Record<string, string>[] = [];

	const onToken = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const params = new URLSearchParams(await readBody(req));
		const record: Record<string, string> = {};
		for (const [k, v] of params) record[k] = v;
		tokenRequests.push(record);
		const grant = params.get("grant_type");
		if (grant === "urn:ietf:params:oauth:grant-type:device_code") {
			if (params.get("device_code") !== DEVICE_CODE) {
				send(res, 400, { error: "invalid_grant" });
				return;
			}
			const next = devicePoll.shift() ?? { status: 400, body: { error: "expired_token" } };
			send(res, next.status, next.body);
			return;
		}
		if (grant === "refresh_token") {
			const next = refresh.shift() ?? { status: 400, body: { error: "invalid_grant" } };
			send(res, next.status, next.body);
			return;
		}
		send(res, 400, { error: "unsupported_grant_type" });
	};

	const server: Server = createServer((req, res) => {
		const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		const url = req.url ?? "/";
		if (url.startsWith("/.well-known/openid-configuration")) {
			send(res, 200, {
				issuer: origin,
				token_endpoint: `${origin}/token`,
				...(script.omitDeviceEndpointInDiscovery ? {} : { device_authorization_endpoint: `${origin}/devicecode` }),
				end_session_endpoint: `${origin}/logout`,
			});
			return;
		}
		if (url.startsWith("/devicecode") && req.method === "POST") {
			send(res, 200, {
				device_code: DEVICE_CODE,
				user_code: "USER-CODE",
				verification_uri: `${origin}/device`,
				verification_uri_complete: `${origin}/device?code=USER-CODE`,
				expires_in: script.expiresIn ?? 600,
				interval: script.interval ?? 1,
			});
			return;
		}
		if (url.startsWith("/token") && req.method === "POST") {
			void onToken(req, res);
			return;
		}
		send(res, 404, { error: "not_found" });
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
		tokenRequests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function fakeJwt(claims: Record<string, unknown>): string {
	const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
	return `${enc({ alg: "none" })}.${enc(claims)}.sig`;
}
const noSleep = (_ms: number): Promise<void> => Promise.resolve();

// ---- fixtures -------------------------------------------------------------

let idp: FakeIdp;
let cfgDir: string;

function config(): CliConfig {
	return {
		endpoint: "http://backend.invalid",
		authority: idp.url,
		clientId: "test-client",
		apiScope: "api://test/access_as_user",
	};
}
function env(): NodeJS.ProcessEnv {
	return {
		TOKEN_TRACKER_CONFIG_DIR: cfgDir,
		TOKEN_TRACKER_ENDPOINT: "http://backend.invalid",
		TOKEN_TRACKER_AUTHORITY: idp.url,
		TOKEN_TRACKER_CLIENT_ID: "test-client",
		TOKEN_TRACKER_API_SCOPE: "api://test/access_as_user",
	};
}

beforeEach(() => {
	clearDiscoveryCache();
	cfgDir = mkdtempSync(join(tmpdir(), "pi-tt-test-"));
});
afterEach(async () => {
	await idp?.close();
	rmSync(cfgDir, { recursive: true, force: true });
});

// ---- discovery ------------------------------------------------------------

describe("discoverEndpoints", () => {
	it("reads the device-authorization and token endpoints from the discovery doc", async () => {
		idp = await startFakeIdp();
		const ep = await discoverEndpoints(idp.url);
		expect(ep.tokenEndpoint).toBe(`${idp.url}/token`);
		expect(ep.deviceAuthorizationEndpoint).toBe(`${idp.url}/devicecode`);
		expect(ep.endSessionEndpoint).toBe(`${idp.url}/logout`);
	});

	it("synthesises the device endpoint when the discovery doc omits it", async () => {
		idp = await startFakeIdp({ omitDeviceEndpointInDiscovery: true });
		const ep = await discoverEndpoints(idp.url);
		expect(ep.deviceAuthorizationEndpoint).toBe(`${idp.url}/devicecode`);
	});
});

// ---- device flow ----------------------------------------------------------

describe("device flow", () => {
	it("polls through authorization_pending until the token is issued", async () => {
		idp = await startFakeIdp({
			devicePollResponses: [
				{ status: 400, body: { error: "authorization_pending" } },
				{ status: 400, body: { error: "authorization_pending" } },
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
		const ep = await discoverEndpoints(idp.url);
		const device = await requestDeviceCode(config(), ep);
		expect(device.userCode).toBe("USER-CODE");
		const token = await pollForToken(config(), ep, device.deviceCode, {
			intervalSeconds: device.interval,
			expiresInSeconds: device.expiresIn,
			sleep: noSleep,
		});
		expect(token.access_token).toBe("AT");
		expect(token.refresh_token).toBe("RT");
		// 3 device-code polls
		expect(idp.tokenRequests.filter((r) => r["grant_type"]?.includes("device_code")).length).toBe(3);
	});

	it("handles slow_down by continuing to poll", async () => {
		idp = await startFakeIdp({
			devicePollResponses: [
				{ status: 400, body: { error: "slow_down" } },
				{ status: 200, body: { access_token: "AT2", expires_in: 3600 } },
			],
		});
		const ep = await discoverEndpoints(idp.url);
		const token = await pollForToken(config(), ep, DEVICE_CODE, {
			intervalSeconds: 1,
			expiresInSeconds: 600,
			sleep: noSleep,
		});
		expect(token.access_token).toBe("AT2");
	});

	it("throws when the user denies the request", async () => {
		idp = await startFakeIdp({
			devicePollResponses: [{ status: 400, body: { error: "access_denied", error_description: "user cancelled" } }],
		});
		const ep = await discoverEndpoints(idp.url);
		await expect(
			pollForToken(config(), ep, DEVICE_CODE, { intervalSeconds: 1, expiresInSeconds: 600, sleep: noSleep }),
		).rejects.toThrow(/access_denied/);
	});

	it("throws when the device code expires before authorization", async () => {
		idp = await startFakeIdp();
		const ep = await discoverEndpoints(idp.url);
		await expect(
			pollForToken(config(), ep, DEVICE_CODE, { intervalSeconds: 1, expiresInSeconds: 0, sleep: noSleep }),
		).rejects.toThrow(/expired/i);
	});
});

// ---- refresh --------------------------------------------------------------

describe("refreshAccessToken", () => {
	it("exchanges a refresh token for a fresh access token", async () => {
		idp = await startFakeIdp({
			refreshResponses: [
				{ status: 200, body: { access_token: "AT-NEW", refresh_token: "RT-NEW", expires_in: 3600 } },
			],
		});
		const ep = await discoverEndpoints(idp.url);
		const resp = await refreshAccessToken(config(), ep, "RT-OLD");
		expect(resp.access_token).toBe("AT-NEW");
		const sent = idp.tokenRequests.at(-1);
		expect(sent?.["grant_type"]).toBe("refresh_token");
		expect(sent?.["refresh_token"]).toBe("RT-OLD");
		expect(sent?.["client_id"]).toBe("test-client");
	});

	it("throws on a refresh error", async () => {
		idp = await startFakeIdp({
			refreshResponses: [{ status: 400, body: { error: "invalid_grant", error_description: "token expired" } }],
		});
		const ep = await discoverEndpoints(idp.url);
		await expect(refreshAccessToken(config(), ep, "RT-OLD")).rejects.toThrow(/invalid_grant/);
	});
});

// ---- getValidAccessToken --------------------------------------------------

describe("getValidAccessToken", () => {
	const farFuture = (): number => Math.floor(Date.now() / 1000) + 9999;
	const soon = (): number => Math.floor(Date.now() / 1000) + 30;

	it("returns undefined when not configured", async () => {
		idp = await startFakeIdp();
		const tok = await getValidAccessToken({ env: { TOKEN_TRACKER_CONFIG_DIR: cfgDir } });
		expect(tok).toBeUndefined();
	});

	it("returns undefined when configured but no auth file exists", async () => {
		idp = await startFakeIdp();
		const tok = await getValidAccessToken({ env: env() });
		expect(tok).toBeUndefined();
	});

	it("returns the cached token without contacting the IdP when it is still valid", async () => {
		idp = await startFakeIdp();
		writeAuthData({ accessToken: "AT-CACHED", refreshToken: "RT", expiresAt: farFuture() }, env());
		const tok = await getValidAccessToken({ env: env() });
		expect(tok).toBe("AT-CACHED");
		expect(idp.tokenRequests.length).toBe(0);
	});

	it("refreshes and persists when the cached token is near expiry", async () => {
		idp = await startFakeIdp({
			refreshResponses: [
				{ status: 200, body: { access_token: "AT-FRESH", refresh_token: "RT2", expires_in: 3600 } },
			],
		});
		writeAuthData({ accessToken: "AT-OLD", refreshToken: "RT1", expiresAt: soon() }, env());
		const tok = await getValidAccessToken({ env: env(), refreshSkewSeconds: 120 });
		expect(tok).toBe("AT-FRESH");
		const persisted = readAuthData(env());
		expect(persisted?.accessToken).toBe("AT-FRESH");
		expect(persisted?.refreshToken).toBe("RT2");
		expect((persisted?.expiresAt ?? 0) > soon()).toBe(true);
	});

	it("keeps the previous refresh token when the refresh response omits one", async () => {
		idp = await startFakeIdp({
			refreshResponses: [{ status: 200, body: { access_token: "AT-FRESH", expires_in: 3600 } }],
		});
		writeAuthData({ accessToken: "AT-OLD", refreshToken: "RT-KEEP", expiresAt: soon() }, env());
		await getValidAccessToken({ env: env() });
		expect(readAuthData(env())?.refreshToken).toBe("RT-KEEP");
	});

	it("returns undefined and leaves the auth file intact when refresh fails", async () => {
		idp = await startFakeIdp({ refreshResponses: [{ status: 400, body: { error: "invalid_grant" } }] });
		const before = { accessToken: "AT-OLD", refreshToken: "RT1", expiresAt: soon() };
		writeAuthData(before, env());
		let warned = "";
		const tok = await getValidAccessToken({
			env: env(),
			onWarn: (m) => {
				warned = m;
			},
		});
		expect(tok).toBeUndefined();
		expect(warned).toMatch(/refresh failed/i);
		expect(readAuthData(env())).toEqual(before);
	});

	it("returns undefined when the token is expired and no refresh token is stored", async () => {
		idp = await startFakeIdp();
		writeAuthData({ accessToken: "AT-OLD", expiresAt: Math.floor(Date.now() / 1000) - 10 }, env());
		let warned = "";
		const tok = await getValidAccessToken({
			env: env(),
			onWarn: (m) => {
				warned = m;
			},
		});
		expect(tok).toBeUndefined();
		expect(warned).toMatch(/refresh token/i);
	});
});
