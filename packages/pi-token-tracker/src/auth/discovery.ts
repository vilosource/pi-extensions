/**
 * Fetch the OIDC discovery document and extract the device-authorization,
 * token, and end-session endpoints.
 *
 * Cached per (authority) for the lifetime of the process — a long-lived pi
 * session refreshes its access token many times but the discovery doc never
 * changes.
 *
 * If the discovery doc omits `device_authorization_endpoint` (some providers
 * do), we synthesise it for Entra-style authorities by swapping `/token` for
 * `/devicecode` on the token endpoint, which matches Entra's v2 layout.
 */

import type { OidcEndpoints } from "./types.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const cache = new Map<string, OidcEndpoints>();

function asString(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

export async function discoverEndpoints(authority: string, fetchImpl: FetchLike = fetch): Promise<OidcEndpoints> {
	const cached = cache.get(authority);
	if (cached !== undefined) return cached;

	const url = `${authority.replace(/\/+$/, "")}/.well-known/openid-configuration`;
	const resp = await fetchImpl(url, { headers: { accept: "application/json" } });
	if (!resp.ok) {
		throw new Error(`OIDC discovery failed: ${resp.status} ${resp.statusText} (${url})`);
	}
	const docUnknown: unknown = await resp.json();
	if (typeof docUnknown !== "object" || docUnknown === null) {
		throw new Error(`OIDC discovery returned a non-object document (${url})`);
	}
	const doc = docUnknown as Record<string, unknown>;

	const tokenEndpoint = asString(doc["token_endpoint"]);
	if (tokenEndpoint === undefined) {
		throw new Error(`OIDC discovery document has no token_endpoint (${url})`);
	}
	const deviceAuthorizationEndpoint =
		asString(doc["device_authorization_endpoint"]) ?? tokenEndpoint.replace(/\/token(\?|$)/, "/devicecode$1");
	const endSessionEndpoint = asString(doc["end_session_endpoint"]);

	const endpoints: OidcEndpoints = {
		deviceAuthorizationEndpoint,
		tokenEndpoint,
		...(endSessionEndpoint !== undefined ? { endSessionEndpoint } : {}),
	};
	cache.set(authority, endpoints);
	return endpoints;
}

/** For tests: drop the per-process discovery cache. */
export function clearDiscoveryCache(): void {
	cache.clear();
}
