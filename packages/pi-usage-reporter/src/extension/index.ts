/**
 * Pi extension entry point.
 *
 * Pi loads this file when the package's `pi.extensions` field points
 * here (see package.json). The default export is called with the
 * ExtensionAPI provided by pi.
 *
 * Per the design (§3.4):
 *   - Resolve config + identity + harness version once at init.
 *   - Resolve workspace and session id at session_start.
 *   - On message_end with an assistant message, build a TurnEvent and
 *     forward to the OtelSink.
 *   - On session_shutdown, flush (errors swallowed per D11).
 *
 * The shape of pi's ExtensionAPI is intentionally NOT imported. This
 * extension is loaded BY pi at runtime; pi's package is a peer dep,
 * not a build-time dep. We type the interface structurally instead.
 */

import type { AssistantMessageSlice, Identity, TurnEvent, Workspace } from "../shared/types.js";
import { loadConfig } from "./config.js";
import { detectHarnessVersion } from "./harness-version.js";
import { resolveIdentity } from "./identity.js";
import { initOtel, type OtelSink } from "./otel.js";
import { resolveSessionId } from "./session-id.js";
import { resolveWorkspace } from "./workspace.js";

/**
 * Structural type matching the subset of pi's ExtensionAPI we use.
 *
 * Defined here to keep the build-time dependency on pi optional (pi loads
 * us; we don't import pi). The shape is verified by phase 0.1 spike
 * against pi 0.66.1 and by upstream type inspection of @earendil-works/
 * pi-coding-agent main as of 2026-05-08.
 */
interface PiExtensionAPI {
	on(event: "session_start", handler: () => void | Promise<void>): void;
	on(event: "message_end", handler: (e: { message: AssistantMessageSlice | { role: string } }) => void): void;
	on(event: "session_shutdown", handler: () => void | Promise<void>): void;
	on(event: string, handler: (...args: unknown[]) => unknown): void;
}

/**
 * Per-session state. `identity` and `harnessVersion` are stable for the
 * lifetime of the extension. `workspace` and `sessionId` are resolved per
 * session_start.
 */
interface SessionState {
	readonly identity: Identity;
	readonly harnessVersion: string;
	workspace: Workspace;
	sessionId: string;
}

export default function piUsageReporter(pi: PiExtensionAPI): void {
	const cfg = loadConfig();
	if (!cfg.enabled) {
		// Per D11: never affect the host. One-line warn, then silence.
		// eslint-disable-next-line no-console
		console.warn("[pi-usage-reporter] PI_USAGE_ENDPOINT not set — telemetry disabled.");
		return;
	}

	const identity = resolveIdentity();
	const harnessVersion = detectHarnessVersion();
	const otel: OtelSink = initOtel(cfg, identity);

	const state: SessionState = {
		identity,
		harnessVersion,
		// Initial values; refreshed on every session_start.
		workspace: resolveWorkspace(),
		sessionId: resolveSessionId({ cwd: process.cwd() }),
	};

	pi.on("session_start", () => {
		// Pi may switch sessions during a process lifetime (resume, fork, new).
		// Re-resolve per session_start so subsequent turns get the right id.
		state.workspace = resolveWorkspace();
		state.sessionId = resolveSessionId({ cwd: process.cwd() });
		if (cfg.verbose) {
			// eslint-disable-next-line no-console
			console.warn(`[pi-usage-reporter] session_start: id=${state.sessionId} cwd=${state.workspace.cwd}`);
		}
	});

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		// Type-narrow: pi may send other message kinds; we only emit for assistant.
		if (!isAssistantMessage(message)) return;

		const turn: TurnEvent = {
			kind: "turn",
			sessionId: state.sessionId,
			provider: message.provider,
			api: message.api,
			model: message.model,
			responseModel: message.responseModel ?? message.model,
			usage: message.usage,
			stopReason: message.stopReason,
			timestamp: message.timestamp,
		};
		otel.recordTurn(turn, {
			identity: state.identity,
			workspace: state.workspace,
			harnessName: "pi",
			harnessVersion: state.harnessVersion,
		});
	});

	pi.on("session_shutdown", async () => {
		await otel.shutdown();
	});
}

function isAssistantMessage(m: unknown): m is AssistantMessageSlice {
	if (typeof m !== "object" || m === null) return false;
	const r = m as Record<string, unknown>;
	return (
		r["role"] === "assistant" &&
		typeof r["api"] === "string" &&
		typeof r["provider"] === "string" &&
		typeof r["model"] === "string" &&
		typeof r["usage"] === "object" &&
		typeof r["stopReason"] === "string" &&
		typeof r["timestamp"] === "number"
	);
}
