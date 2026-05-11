/**
 * Shared types for pi-token-tracker.
 *
 * This module is pure: no IO, no environment access, no globals.
 * Enforced by the dependency-cruiser rule `shared-is-pure`.
 */

/**
 * Per-turn token + cost data, mirroring pi-mono's `Usage` interface.
 *
 * We re-declare it here (rather than importing from the pi-mono package)
 * because the extension is loaded BY pi at runtime; importing pi's type
 * would create a peer-dependency we cannot install at build time.
 */
export interface Usage {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly totalTokens: number;
	readonly cost: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly total: number;
	};
}

/**
 * The minimal subset of pi-mono's `AssistantMessage` we read in the
 * `message_end` hook. Pi-mono ships more fields; we only extract these.
 */
export interface AssistantMessageSlice {
	readonly role: "assistant";
	readonly api: string;
	readonly provider: string;
	readonly model: string;
	readonly responseModel?: string;
	readonly usage: Usage;
	readonly stopReason: string;
	readonly timestamp: number;
}

/**
 * A turn event we forward to OTel. Built from `AssistantMessageSlice`
 * plus session/identity context resolved at session start.
 */
export interface TurnEvent {
	readonly kind: "turn";
	readonly sessionId: string;
	readonly provider: string;
	readonly api: string;
	readonly model: string;
	readonly responseModel: string;
	readonly usage: Usage;
	readonly stopReason: string;
	readonly timestamp: number;
}

/**
 * Identity attached to emitted spans, for diagnostics only.
 *
 * Per the token-tracker redesign (ADR D8 / verifier §4.1), the server
 * derives the authoritative user identity from the verified access-token
 * claims, NOT from span attributes — `agent.user.id` on a span is ignored
 * even when present. `userId` here is best-effort: the `upn` /
 * `preferred_username` / `email` claim decoded from the local access
 * token, or `"unknown"` if no token is available. `machineId` is a stable
 * per-machine UUID persisted under the user's config dir.
 */
export interface Identity {
	readonly userId: string;
	readonly machineId: string;
}

/**
 * Workspace metadata resolved at session start.
 */
export interface Workspace {
	readonly cwd: string;
	readonly repo: string | undefined;
	readonly branch: string | undefined;
	readonly isCi: boolean;
}
