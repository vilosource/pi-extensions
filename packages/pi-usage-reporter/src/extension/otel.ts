/**
 * OTel SDK adapter.
 *
 * The only file in this package that imports from `@opentelemetry/*`.
 * The rest of the codebase consumes the `OtelSink` interface, which keeps
 * OTel concerns isolated and makes the SDK boundary easy to mock or replace.
 *
 * Critical: per D11 in the decisions log, when the OTel collector is
 * unreachable at shutdown time, `sdk.shutdown()` raises an uncaught
 * exception that crashes the host process (the developer's pi session).
 * We wrap shutdown in try/catch + timeout to ensure telemetry failures
 * NEVER affect the user.
 */

import { metrics, trace } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { type MappingContext, turnAttributes } from "../shared/mapping.js";
import type { Identity, TurnEvent } from "../shared/types.js";
import type { Config } from "./config.js";

/**
 * The shape the rest of the extension depends on.
 * Concrete implementations (real OTel; in-memory test stub) implement this.
 */
export interface OtelSink {
	recordTurn(event: TurnEvent, ctx: MappingContext): void;
	shutdown(): Promise<void>;
}

const SHUTDOWN_TIMEOUT_MS = 5000;

export function initOtel(cfg: Config, identity: Identity): OtelSink {
	if (!cfg.enabled || cfg.endpoint === undefined) {
		return new NoopSink();
	}

	const headers: Record<string, string> = {};
	if (cfg.token !== undefined) {
		headers["Authorization"] = `Bearer ${cfg.token}`;
	}

	const sdk = new NodeSDK({
		resource: resourceFromAttributes({
			"service.name": "pi-usage-reporter",
			"service.version": packageVersion(),
			"deployment.environment": cfg.environment,
			"agent.user.id": identity.userId,
			"agent.machine.id": identity.machineId,
		}),
		traceExporter: new OTLPTraceExporter({
			url: `${cfg.endpoint}/v1/traces`,
			headers,
		}),
		metricReader: new PeriodicExportingMetricReader({
			exporter: new OTLPMetricExporter({
				url: `${cfg.endpoint}/v1/metrics`,
				headers,
			}),
			exportIntervalMillis: cfg.batchIntervalMs,
		}),
	});

	sdk.start();

	const tracer = trace.getTracer("pi-usage-reporter");
	const meter = metrics.getMeter("pi-usage-reporter");

	const tokensHist = meter.createHistogram("gen_ai.client.token.usage", {
		unit: "{token}",
		description: "Number of input and output tokens used by a GenAI operation.",
	});
	const costHist = meter.createHistogram("agent.cost.usd", {
		unit: "USD",
		description: "Per-turn cost in USD for a GenAI operation.",
	});

	return {
		recordTurn(event, ctx) {
			const attrs = turnAttributes(event, ctx);
			const span = tracer.startSpan(`chat ${event.model}`, {
				attributes: attrs,
				startTime: event.timestamp,
			});
			span.end();

			const metricAttrs = stripArrays(attrs);
			tokensHist.record(event.usage.input, {
				...metricAttrs,
				"gen_ai.token.type": "input",
			});
			tokensHist.record(event.usage.output, {
				...metricAttrs,
				"gen_ai.token.type": "output",
			});
			if (event.usage.cacheRead > 0) {
				tokensHist.record(event.usage.cacheRead, {
					...metricAttrs,
					"gen_ai.token.type": "cache_read",
				});
			}
			if (event.usage.cacheWrite > 0) {
				tokensHist.record(event.usage.cacheWrite, {
					...metricAttrs,
					"gen_ai.token.type": "cache_creation",
				});
			}
			costHist.record(event.usage.cost.total, metricAttrs);
		},

		async shutdown() {
			// Per D11: shutdown errors must NEVER crash the host process.
			// Wrap in try/catch + timeout.
			try {
				await Promise.race([
					sdk.shutdown(),
					new Promise<void>((_, reject) =>
						setTimeout(() => reject(new Error("OTel shutdown timeout")), SHUTDOWN_TIMEOUT_MS),
					),
				]);
			} catch (err) {
				if (cfg.verbose) {
					// eslint-disable-next-line no-console
					console.warn("[pi-usage-reporter] OTel shutdown failed (events stay buffered):", err);
				}
			}
		},
	};
}

class NoopSink implements OtelSink {
	recordTurn(): void {
		// disabled — silently drop
	}
	async shutdown(): Promise<void> {
		// nothing to flush
	}
}

/**
 * Strip array-typed attribute values for use in metric attribute sets.
 * OTel histograms accept primitive attributes only; arrays are span-only.
 */
function stripArrays(
	attrs: Record<string, string | number | boolean | string[]>,
): Record<string, string | number | boolean> {
	const out: Record<string, string | number | boolean> = {};
	for (const [k, v] of Object.entries(attrs)) {
		if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
			out[k] = v;
		}
	}
	return out;
}

function packageVersion(): string {
	// Hardcode for the spike; in production this is read from package.json.
	return "0.0.0";
}
