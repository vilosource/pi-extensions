/**
 * In-process fake OIDC IdP for the auth/CLI tests: serves a discovery
 * document, an RFC 8628 device-authorization endpoint, and a token endpoint
 * handling the `device_code` and `refresh_token` grants. Scripted via queues
 * so a test can model `authorization_pending` → success, `slow_down`,
 * `access_denied`, refresh success/failure, etc.
 *
 * Not a `*.test.ts` file (so vitest doesn't run it as a spec) and excluded
 * from `tsc` output via the package `tsconfig.json` (so it never lands in
 * `dist`). Imported only by the `*.test.ts` specs.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface ScriptedResponse {
	readonly status: number;
	readonly body: unknown;
}

export interface FakeIdpScript {
	readonly devicePollResponses?: ScriptedResponse[];
	readonly refreshResponses?: ScriptedResponse[];
	readonly interval?: number;
	readonly expiresIn?: number;
	readonly omitDeviceEndpointInDiscovery?: boolean;
	/** If true, `/token` answers 302 → `/elsewhere` instead of the scripted body. */
	readonly redirectTokenEndpoint?: boolean;
}

export interface FakeIdp {
	readonly url: string;
	readonly tokenRequests: Record<string, string>[];
	close(): Promise<void>;
}

export const DEVICE_CODE = "DEV-CODE";

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

export async function startFakeIdp(script: FakeIdpScript = {}): Promise<FakeIdp> {
	const devicePoll = [...(script.devicePollResponses ?? [])];
	const refresh = [...(script.refreshResponses ?? [])];
	const tokenRequests: Record<string, string>[] = [];

	const onToken = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		const params = new URLSearchParams(await readBody(req));
		const record: Record<string, string> = {};
		for (const [k, v] of params) record[k] = v;
		tokenRequests.push(record);
		if (script.redirectTokenEndpoint) {
			res.writeHead(302, { location: "/elsewhere" });
			res.end();
			return;
		}
		const grant = params.get("grant_type");
		if (grant === "urn:ietf:params:oauth:grant-type:device_code") {
			if (params.get("device_code") !== DEVICE_CODE) {
				send(res, 400, { error: "invalid_grant" });
				return;
			}
			send(res, ...drain(devicePoll, { error: "expired_token" }));
			return;
		}
		if (grant === "refresh_token") {
			send(res, ...drain(refresh, { error: "invalid_grant" }));
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

function drain(queue: ScriptedResponse[], fallback: unknown): [number, unknown] {
	const next = queue.shift() ?? { status: 400, body: fallback };
	return [next.status, next.body];
}

/** A base64url-encoded JWT-shaped string with the given claims (NOT signed). */
export function fakeJwt(claims: Record<string, unknown>): string {
	const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
	return `${enc({ alg: "none" })}.${enc(claims)}.sig`;
}

/** No-op sleep for injecting into device-flow polling so tests don't wait. */
export const noSleep = (_ms: number): Promise<void> => Promise.resolve();
