/**
 * Pi extension entry point.
 *
 * Pi loads this file when the package's `pi.extensions` field points
 * here (see package.json). The default export is called with the
 * ExtensionAPI provided by pi.
 *
 * Per the design (§3.4):
 *   - Resolve config + identity once at init.
 *   - Resolve workspace once per session_start.
 *   - On message_end with an assistant message, build a TurnEvent and
 *     forward to the OtelSink.
 *   - On session_shutdown, flush.
 *
 * The shape of pi's ExtensionAPI is intentionally NOT imported. This
 * extension is loaded BY pi at runtime; pi's package is a peer dep,
 * not a build-time dep. We type the interface structurally instead.
 */

import type { AssistantMessageSlice, Identity, TurnEvent, Workspace } from "../shared/types.js";
import { loadConfig } from "./config.js";
import { resolveIdentity } from "./identity.js";
import { initOtel, type OtelSink } from "./otel.js";
import { resolveWorkspace } from "./workspace.js";

/**
 * Structural type matching the subset of pi's ExtensionAPI we use.
 *
 * Defined here to keep the build-time dependency on pi optional (pi loads
 * us; we don't import pi). The shape is verified by the spike against
 * @earendil-works/pi-coding-agent >= 0.74.0.
 */
interface PiExtensionAPI {
	on(event: "message_end", handler: (e: { message: AssistantMessageSlice | { role: string } }) => void): void;
	on(event: "session_shutdown", handler: () => void | Promise<void>): void;
	on(event: string, handler: (...args: unknown[]) => unknown): void;
	session?: { id?: string };
}

/**
 * Per-session state. Resolved once at init (workspace) plus the
 * session_id we read from pi at message_end time.
 */
interface SessionContext {
	readonly identity: Identity;
	readonly workspace: Workspace;
	readonly harnessVersion: string;
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
	const workspace = resolveWorkspace();
	const harnessVersion = readHarnessVersion();
	const ctx: SessionContext = { identity, workspace, harnessVersion };

	const otel: OtelSink = initOtel(cfg, identity);

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		// Type-narrow: pi may send other message kinds; we only emit for assistant.
		if (!isAssistantMessage(message)) return;

		const turn: TurnEvent = {
			kind: "turn",
			sessionId: pi.session?.id ?? "unknown",
			provider: message.provider,
			api: message.api,
			model: message.model,
			responseModel: message.responseModel ?? message.model,
			usage: message.usage,
			stopReason: message.stopReason,
			timestamp: message.timestamp,
		};
		otel.recordTurn(turn, {
			identity: ctx.identity,
			workspace: ctx.workspace,
			harnessName: "pi",
			harnessVersion: ctx.harnessVersion,
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

function readHarnessVersion(): string {
	// Read from the running pi process if possible; for the spike, return unknown.
	return "unknown";
}
