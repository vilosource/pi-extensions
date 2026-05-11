/**
 * OTel SDK adapter — the only file that imports `@opentelemetry/*`.
 *
 * Emits one span per assistant turn to `${endpoint}/v1/traces`. The bearer
 * token is supplied by an async `headers` factory the OTLP exporter invokes
 * before every export: it calls `getValidAccessToken`, which reads the
 * cached token, silently refreshes it if near-expiry, and returns it — so
 * "refresh on every flush" (redesign §4.3) falls out of the exporter's own
 * batching. When no valid token is available the factory returns no
 * Authorization header; the server replies 401 and the SDK drops that batch.
 *
 * The token-tracker backend ingests OTLP *traces* only (it absorbed the OTel
 * Collector at phase 0.3.8 — there is no `/v1/metrics`), so unlike the old
 * pi-usage-reporter we register no metric exporter.
 *
 * Critical (carried over from pi-usage-reporter's D11): when the endpoint is
 * unreachable at shutdown, `sdk.shutdown()` can reject; an unhandled
 * rejection here would crash the host pi process. We wrap shutdown in
 * try/catch + a timeout so telemetry failures NEVER affect the user.
 */

import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getValidAccessToken } from "../auth/access-token.js";
import { type MappingContext, turnAttributes } from "../shared/mapping.js";
import type { TurnEvent } from "../shared/types.js";

export interface OtelSink {
	recordTurn(event: TurnEvent, ctx: MappingContext): void;
	shutdown(): Promise<void>;
}

export interface InitOtelArgs {
	readonly endpoint: string;
	readonly environment: string;
	readonly batchIntervalMs: number;
	readonly verbose: boolean;
	readonly machineId: string;
	readonly env?: NodeJS.ProcessEnv;
}

const SHUTDOWN_TIMEOUT_MS = 5000;
const SERVICE_VERSION = "0.0.0";

export function initOtel(args: InitOtelArgs): OtelSink {
	const warn = args.verbose
		? (message: string): void => {
				// eslint-disable-next-line no-console
				console.warn(`[pi-token-tracker] ${message}`);
			}
		: undefined;

	const headers = async (): Promise<Record<string, string>> => {
		const token = await getValidAccessToken({
			...(args.env !== undefined ? { env: args.env } : {}),
			...(warn !== undefined ? { onWarn: warn } : {}),
		});
		return token !== undefined ? { Authorization: `Bearer ${token}` } : {};
	};

	const sdk = new NodeSDK({
		resource: resourceFromAttributes({
			"service.name": "pi-token-tracker",
			"service.version": SERVICE_VERSION,
			"deployment.environment": args.environment,
			"agent.machine.id": args.machineId,
		}),
		traceExporter: new OTLPTraceExporter({
			url: `${args.endpoint}/v1/traces`,
			headers,
		}),
	});

	sdk.start();

	const tracer = trace.getTracer("pi-token-tracker");

	return {
		recordTurn(event, ctx) {
			const span = tracer.startSpan(`chat ${event.model}`, {
				attributes: turnAttributes(event, ctx),
				startTime: event.timestamp,
			});
			span.end();
		},

		async shutdown() {
			try {
				await Promise.race([
					sdk.shutdown(),
					new Promise<void>((_, reject) =>
						setTimeout(() => reject(new Error("OTel shutdown timeout")), SHUTDOWN_TIMEOUT_MS),
					),
				]);
			} catch (err) {
				warn?.(`OTel shutdown failed (events stay buffered): ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	};
}
