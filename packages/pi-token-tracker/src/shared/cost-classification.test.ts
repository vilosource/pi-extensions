import { describe, expect, it } from "vitest";
import { classifyCost } from "./cost-classification.js";
import type { Usage } from "./types.js";

function usage(overrides: Partial<Usage> & { cost?: Partial<Usage["cost"]> } = {}): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		...overrides,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
			...(overrides.cost ?? {}),
		},
	};
}

describe("classifyCost", () => {
	it("classifies a normal Anthropic-style turn as metered", () => {
		const u = usage({
			input: 100,
			output: 50,
			cost: { input: 0.0001, output: 0.0002, cacheRead: 0, cacheWrite: 0, total: 0.0003 },
		});
		expect(classifyCost(u)).toBe("metered");
	});

	it("classifies a Copilot-style turn (tokens, no cost) as subscription", () => {
		const u = usage({ input: 100, output: 50 });
		expect(classifyCost(u)).toBe("subscription");
	});

	it("classifies an error/aborted turn (no tokens, no cost) as unreported", () => {
		const u = usage();
		expect(classifyCost(u)).toBe("unreported");
	});

	it("classifies cache-only Copilot reads as subscription", () => {
		const u = usage({ cacheRead: 200 });
		expect(classifyCost(u)).toBe("subscription");
	});

	it("classifies a tiny non-zero cost as metered (does not round to subscription)", () => {
		const u = usage({
			input: 100,
			cost: { input: 0.0000001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.0000001 },
		});
		expect(classifyCost(u)).toBe("metered");
	});
});
