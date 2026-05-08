/**
 * Shared types for pi-usage-reporter.
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
 * Identity resolved at extension init.
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
