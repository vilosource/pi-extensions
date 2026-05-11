/**
 * Classify whether a turn's cost is "metered" (per-token billing
 * reported by the provider) or "subscription" (flat-rate plan; provider
 * returns zero cost or pi-mono has no cost data).
 *
 * Per the spike-defect D2 retrospective: GitHub Copilot is subscription-
 * billed; pi-mono's `models.generated.ts` deliberately omits the `cost`
 * field for Copilot models, so `Usage.cost.total` arrives as 0. The
 * dashboard cannot tell zero-because-cheap apart from zero-because-
 * subscription without an explicit signal.
 *
 * Heuristic: if all four cost buckets are exactly zero AND at least one
 * token bucket is non-zero, the cost was not reported — classify as
 * subscription. Otherwise, metered.
 *
 * If both tokens and cost are zero, the turn was either an aborted/error
 * with no provider response, or a synthetic/no-op. Mark as "unreported"
 * — the dashboard treats these as adoption signal only.
 *
 * Pure function. Tested.
 */

import type { Usage } from "./types.js";

export type CostEstimation = "metered" | "subscription" | "unreported";

export function classifyCost(usage: Usage): CostEstimation {
	const allCostsZero =
		usage.cost.input === 0 && usage.cost.output === 0 && usage.cost.cacheRead === 0 && usage.cost.cacheWrite === 0;

	if (!allCostsZero) {
		return "metered";
	}

	const anyTokens = usage.input > 0 || usage.output > 0 || usage.cacheRead > 0 || usage.cacheWrite > 0;

	return anyTokens ? "subscription" : "unreported";
}
