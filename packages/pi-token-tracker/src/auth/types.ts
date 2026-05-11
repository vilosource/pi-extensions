/**
 * Shared types for the auth module (device flow + refresh + token cache).
 *
 * Pure type declarations only.
 */

/**
 * The four values needed to talk to the IdP and the backend. Persisted in
 * `~/.config/token-tracker/config.json` by `token-tracker login`, with each
 * field individually overridable via a `TOKEN_TRACKER_*` env var.
 *
 * - `endpoint`  — the token-tracker backend base URL; OTLP is POSTed to
 *   `${endpoint}/v1/traces`.
 * - `authority` — the OIDC issuer URL (e.g. `https://login.microsoftonline.com/<tenant>/v2.0`).
 *   Its `.well-known/openid-configuration` is fetched to discover the
 *   device-authorization and token endpoints.
 * - `clientId`  — the public-client app registration's client id.
 * - `apiScope`  — the delegated scope to request so the issued access token
 *   has the backend's audience (e.g. `api://<appId>/access_as_user`).
 */
export interface CliConfig {
	readonly endpoint: string;
	readonly authority: string;
	readonly clientId: string;
	readonly apiScope: string;
}

/**
 * The persisted token state in `~/.config/token-tracker/auth.json` (mode 0600).
 * `expiresAt` is epoch seconds (the access token's `exp`, or `now + expires_in`
 * if `exp` is unavailable).
 */
export interface AuthData {
	readonly accessToken: string;
	readonly refreshToken?: string;
	readonly idToken?: string;
	readonly expiresAt: number;
}

/** The subset of the OIDC discovery document we use. */
export interface OidcEndpoints {
	readonly deviceAuthorizationEndpoint: string;
	readonly tokenEndpoint: string;
	readonly endSessionEndpoint?: string;
}

/** RFC 8628 §3.2 device-authorization response (the fields we use). */
export interface DeviceCodeResponse {
	readonly deviceCode: string;
	readonly userCode: string;
	readonly verificationUri: string;
	readonly verificationUriComplete?: string;
	readonly expiresIn: number;
	readonly interval: number;
}

/** OAuth 2.0 token-endpoint success response (the fields we use). */
export interface OidcTokenResponse {
	readonly access_token: string;
	readonly refresh_token?: string;
	readonly id_token?: string;
	readonly expires_in?: number;
	readonly token_type?: string;
	readonly scope?: string;
}
