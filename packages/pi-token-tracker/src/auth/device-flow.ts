/**
 * RFC 8628 OAuth 2.0 Device Authorization Grant — the flow `token-tracker
 * login` uses. Public client: no client secret, identity proven by the user
 * authenticating at the IdP's verification URL in a browser.
 *
 *   1. requestDeviceCode → { userCode, verificationUri, deviceCode, interval, expiresIn }
 *   2. show userCode + verificationUri to the user
 *   3. pollForToken → polls the token endpoint until the user finishes
 */

import type { CliConfig, DeviceCodeResponse, OidcEndpoints, OidcTokenResponse } from "./types.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Scope requested in both the device-code request and the refresh request. */
export function requestedScope(config: CliConfig): string {
	return `${config.apiScope} offline_access openid profile email`;
}

function form(params: Record<string, string>): string {
	return new URLSearchParams(params).toString();
}

function asString(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asPositiveInt(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

export async function requestDeviceCode(
	config: CliConfig,
	endpoints: OidcEndpoints,
	fetchImpl: FetchLike = fetch,
): Promise<DeviceCodeResponse> {
	const resp = await fetchImpl(endpoints.deviceAuthorizationEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
		body: form({ client_id: config.clientId, scope: requestedScope(config) }),
	});
	const bodyUnknown: unknown = await resp.json().catch(() => undefined);
	if (!resp.ok || typeof bodyUnknown !== "object" || bodyUnknown === null) {
		throw new Error(`device authorization request failed: ${resp.status} ${describeError(bodyUnknown)}`);
	}
	const b = bodyUnknown as Record<string, unknown>;
	const deviceCode = asString(b["device_code"]);
	const userCode = asString(b["user_code"]);
	const verificationUri = asString(b["verification_uri"]) ?? asString(b["verification_url"]);
	if (deviceCode === undefined || userCode === undefined || verificationUri === undefined) {
		throw new Error("device authorization response missing device_code / user_code / verification_uri");
	}
	const verificationUriComplete = asString(b["verification_uri_complete"]) ?? asString(b["verification_url_complete"]);
	return {
		deviceCode,
		userCode,
		verificationUri,
		...(verificationUriComplete !== undefined ? { verificationUriComplete } : {}),
		expiresIn: asPositiveInt(b["expires_in"], 900),
		interval: asPositiveInt(b["interval"], 5),
	};
}

export interface PollOptions {
	readonly intervalSeconds: number;
	readonly expiresInSeconds: number;
	readonly fetchImpl?: FetchLike;
	/** Injectable for tests. Default: real `setTimeout`. */
	readonly sleep?: (ms: number) => Promise<void>;
	/** Injectable for tests. Default: `Date.now`. */
	readonly now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type PollStep = { done: true; token: OidcTokenResponse } | { done: false; nextIntervalSeconds: number };

async function pollOnce(
	config: CliConfig,
	endpoints: OidcEndpoints,
	deviceCode: string,
	intervalSeconds: number,
	fetchImpl: FetchLike,
): Promise<PollStep> {
	const resp = await fetchImpl(endpoints.tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
		body: form({
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			client_id: config.clientId,
			device_code: deviceCode,
		}),
	});
	const bodyUnknown: unknown = await resp.json().catch(() => undefined);
	if (
		resp.ok &&
		typeof bodyUnknown === "object" &&
		bodyUnknown !== null &&
		asString((bodyUnknown as Record<string, unknown>)["access_token"]) !== undefined
	) {
		return { done: true, token: bodyUnknown as OidcTokenResponse };
	}
	const error =
		typeof bodyUnknown === "object" && bodyUnknown !== null
			? asString((bodyUnknown as Record<string, unknown>)["error"])
			: undefined;
	if (error === "authorization_pending") return { done: false, nextIntervalSeconds: intervalSeconds };
	if (error === "slow_down") return { done: false, nextIntervalSeconds: intervalSeconds + 5 };
	throw new Error(`device token request failed: ${resp.status} ${describeError(bodyUnknown)}`);
}

export async function pollForToken(
	config: CliConfig,
	endpoints: OidcEndpoints,
	deviceCode: string,
	opts: PollOptions,
): Promise<OidcTokenResponse> {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const sleep = opts.sleep ?? defaultSleep;
	const now = opts.now ?? Date.now;
	const deadline = now() + opts.expiresInSeconds * 1000;
	let interval = opts.intervalSeconds;

	for (;;) {
		if (now() >= deadline) {
			throw new Error("device code expired before authorization completed — run `token-tracker login` again");
		}
		await sleep(interval * 1000);
		const step = await pollOnce(config, endpoints, deviceCode, interval, fetchImpl);
		if (step.done) return step.token;
		interval = step.nextIntervalSeconds;
	}
}

export function describeError(body: unknown): string {
	if (typeof body !== "object" || body === null) return "(no error body)";
	const b = body as Record<string, unknown>;
	const error = asString(b["error"]) ?? "unknown_error";
	const description = asString(b["error_description"]);
	return description !== undefined ? `${error}: ${description}` : error;
}
