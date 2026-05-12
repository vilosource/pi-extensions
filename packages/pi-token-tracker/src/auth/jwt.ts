/**
 * Decode the claims segment of a JWT WITHOUT verifying the signature.
 *
 * The CLI only needs a handful of claims for display (`upn` /
 * `preferred_username` for `token-tracker status`, `exp` as a sanity check)
 * and for the diagnostic `agent.user.id` span attribute. The backend is the
 * only party that verifies signatures — see the verifier in the
 * token-tracker source (`auth/idp.ts`). Never trust these claims for
 * authorization decisions.
 *
 * Returns `undefined` for anything that isn't a well-formed three-segment
 * JWT with a base64url-decodable JSON payload.
 */

export function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length !== 3) return undefined;
	const payload = parts[1];
	if (payload === undefined || payload.length === 0) return undefined;
	try {
		const json = Buffer.from(payload, "base64url").toString("utf8");
		const parsed: unknown = JSON.parse(json);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

/** Best-effort human identity from a decoded access/id token. */
export function userIdFromClaims(claims: Record<string, unknown> | undefined): string | undefined {
	if (claims === undefined) return undefined;
	for (const key of ["upn", "preferred_username", "email", "unique_name"]) {
		const v = claims[key];
		if (typeof v === "string" && v.length > 0) return v;
	}
	return undefined;
}
