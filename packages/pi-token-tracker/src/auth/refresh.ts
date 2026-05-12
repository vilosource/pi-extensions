/**
 * OAuth 2.0 refresh-token grant. Public client (no secret) — possession of
 * the refresh token is the proof. Used by `getValidAccessToken` to silently
 * mint a fresh access token before each OTLP flush when the cached one is
 * near expiry, and by `token-tracker status` indirectly.
 */

import { describeError, requestedScope } from "./device-flow.js";
import type { CliConfig, OidcEndpoints, OidcTokenResponse } from "./types.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function asString(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function refreshAccessToken(
	config: CliConfig,
	endpoints: OidcEndpoints,
	refreshToken: string,
	fetchImpl: FetchLike = fetch,
): Promise<OidcTokenResponse> {
	const resp = await fetchImpl(endpoints.tokenEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: config.clientId,
			refresh_token: refreshToken,
			scope: requestedScope(config),
		}).toString(),
		// Don't follow redirects — see device-flow.ts. A redirected refresh
		// would resend the refresh token in the body.
		redirect: "error",
	});
	const bodyUnknown: unknown = await resp.json().catch(() => undefined);
	if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
		throw new Error(`token refresh failed: ${resp.status} (no JSON body)`);
	}
	const accessToken = asString((bodyUnknown as Record<string, unknown>)["access_token"]);
	if (!resp.ok || accessToken === undefined) {
		throw new Error(`token refresh failed: ${resp.status} ${describeError(bodyUnknown)}`);
	}
	return bodyUnknown as OidcTokenResponse;
}
