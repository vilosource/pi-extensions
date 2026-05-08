/**
 * Map a `TurnEvent` plus identity and workspace context to the OTel
 * attribute dictionary, following the schema in
 * docs/design/pi-usage-reporter-DESIGN.md §3.9.
 *
 * Adds `agent.cost.estimation` per spike-defect D2: distinguishes
 * subscription-billed providers (which return zero cost) from metered
 * ones, so the dashboard can render them differently.
 *
 * Pure function. No IO. Easy to test.
 */

import { classifyCost } from "./cost-classification.js";
import type { Identity, TurnEvent, Workspace } from "./types.js";

export interface MappingContext {
	readonly identity: Identity;
	readonly workspace: Workspace;
	readonly harnessName: string; // typically "pi"
	readonly harnessVersion: string; // pi-mono package version, when knowable
}

export function turnAttributes(
	event: TurnEvent,
	ctx: MappingContext,
): Record<string, string | number | boolean | string[]> {
	return {
		// Standard OTel GenAI attributes
		"gen_ai.operation.name": "chat",
		"gen_ai.provider.name": mapProvider(event.provider),
		"gen_ai.request.model": event.model,
		"gen_ai.response.model": event.responseModel,
		"gen_ai.usage.input_tokens": event.usage.input,
		"gen_ai.usage.output_tokens": event.usage.output,
		"gen_ai.usage.cache_read.input_tokens": event.usage.cacheRead,
		"gen_ai.usage.cache_creation.input_tokens": event.usage.cacheWrite,
		"gen_ai.response.finish_reasons": [event.stopReason],
		"gen_ai.conversation.id": event.sessionId,

		// pi-extensions agent.* extension namespace
		"agent.user.id": ctx.identity.userId,
		"agent.machine.id": ctx.identity.machineId,
		"agent.session.id": event.sessionId,
		"agent.workspace.cwd": ctx.workspace.cwd,
		...(ctx.workspace.repo !== undefined && {
			"agent.workspace.repo": ctx.workspace.repo,
		}),
		...(ctx.workspace.branch !== undefined && {
			"agent.workspace.branch": ctx.workspace.branch,
		}),
		"agent.workspace.is_ci": ctx.workspace.isCi,
		"agent.api.dialect": event.api,
		"agent.cost.input.usd": event.usage.cost.input,
		"agent.cost.output.usd": event.usage.cost.output,
		"agent.cost.cache_read.usd": event.usage.cost.cacheRead,
		"agent.cost.cache_write.usd": event.usage.cost.cacheWrite,
		"agent.cost.total.usd": event.usage.cost.total,
		"agent.cost.estimation": classifyCost(event.usage),
		"agent.stop_reason": event.stopReason,
		"agent.event.kind": event.kind,
		"agent.harness.name": ctx.harnessName,
		"agent.harness.version": ctx.harnessVersion,
	};
}

/**
 * Map pi-mono's provider names to OTel canonical provider names.
 * Per docs/design/pi-usage-reporter-DESIGN.md §3.10.
 */
export function mapProvider(piProvider: string): string {
	const mapping: Record<string, string> = {
		anthropic: "anthropic",
		openai: "openai",
		google: "gcp.gen_ai",
		bedrock: "aws.bedrock",
		azure: "az.ai.inference",
		openrouter: "openrouter",
		copilot: "github.copilot",
		"github-copilot": "github.copilot",
		vllm: "vllm",
		"pi-pods": "vllm",
	};
	return mapping[piProvider] ?? piProvider.toLowerCase();
}
