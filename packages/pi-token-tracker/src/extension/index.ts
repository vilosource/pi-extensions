/**
 * Pi extension entry point.
 *
 * Pi loads this file when the package's `pi.extensions` field points here
 * (see package.json). The default export is called with pi's ExtensionAPI.
 *
 *   - At init: resolve config + identity + harness version; if the CLI is
 *     not configured or `token-tracker login` hasn't been run, warn once
 *     and no-op.
 *   - At session_start: re-resolve workspace + session id.
 *   - At message_end (assistant message): build a TurnEvent and forward to
 *     the OtelSink.
 *   - At session_shutdown: flush (errors swallowed — see otel.ts / D11).
 *
 * Pi's ExtensionAPI shape is intentionally NOT imported (pi loads us at
 * runtime; its package is an optional peer dep, not a build-time dep). We
 * type the subset we use structurally.
 */

import { readAuthData } from "../auth/auth-file.js";
import { insecureUrlWarnings, loadCliConfig } from "../auth/config.js";
import type { AssistantMessageSlice, Identity, TurnEvent, Workspace } from "../shared/types.js";
import { loadExtensionConfig } from "./config.js";
import { detectHarnessVersion } from "./harness-version.js";
import { resolveIdentity } from "./identity.js";
import { initOtel, type OtelSink } from "./otel.js";
import { resolveSessionId } from "./session-id.js";
import { resolveWorkspace } from "./workspace.js";

interface PiExtensionAPI {
	on(event: "session_start", handler: () => void | Promise<void>): void;
	on(event: "message_end", handler: (e: { message: AssistantMessageSlice | { role: string } }) => void): void;
	on(event: "session_shutdown", handler: () => void | Promise<void>): void;
	on(event: string, handler: (...args: unknown[]) => unknown): void;
}

interface SessionState {
	readonly identity: Identity;
	readonly harnessVersion: string;
	workspace: Workspace;
	sessionId: string;
}

function warnOnce(message: string): void {
	// eslint-disable-next-line no-console
	console.warn(`[pi-token-tracker] ${message}`);
}

export default function piTokenTracker(pi: PiExtensionAPI): void {
	const extCfg = loadExtensionConfig();
	if (extCfg.explicitlyDisabled) {
		warnOnce("TOKEN_TRACKER_ENABLED=false — telemetry disabled.");
		return;
	}
	const cli = loadCliConfig();
	if (cli === undefined) {
		warnOnce(
			"not configured — run `token-tracker login --endpoint=<url> --authority=<oidc-issuer> --client-id=<id> --api-scope=<scope>` (or set the TOKEN_TRACKER_* env vars). Telemetry disabled.",
		);
		return;
	}
	if (readAuthData() === undefined) {
		warnOnce("no stored credentials — run `token-tracker login`. Telemetry disabled.");
		return;
	}
	for (const w of insecureUrlWarnings(cli)) warnOnce(w);

	const identity = resolveIdentity();
	const harnessVersion = detectHarnessVersion();
	const otel: OtelSink = initOtel({
		endpoint: cli.endpoint,
		environment: extCfg.environment,
		batchIntervalMs: extCfg.batchIntervalMs,
		verbose: extCfg.verbose,
		machineId: identity.machineId,
	});

	const state: SessionState = {
		identity,
		harnessVersion,
		workspace: resolveWorkspace(),
		sessionId: resolveSessionId({ cwd: process.cwd() }),
	};

	pi.on("session_start", () => {
		state.workspace = resolveWorkspace();
		state.sessionId = resolveSessionId({ cwd: process.cwd() });
		if (extCfg.verbose) {
			warnOnce(`session_start: id=${state.sessionId} cwd=${state.workspace.cwd}`);
		}
	});

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
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
