import { describe, expect, it } from "vitest";
import { mapProvider, turnAttributes } from "./mapping.js";
import type { Identity, TurnEvent, Workspace } from "./types.js";

const identity: Identity = {
	userId: "test@example.invalid",
	machineId: "00000000-0000-0000-0000-000000000001",
};

const workspace: Workspace = {
	cwd: "/workspace",
	repo: "vilosource/pi-extensions",
	branch: "main",
	isCi: false,
};

const ctx = {
	identity,
	workspace,
	harnessName: "pi",
	harnessVersion: "0.74.0",
};

const turn: TurnEvent = {
	kind: "turn",
	sessionId: "session-uuid",
	provider: "anthropic",
	api: "anthropic-messages",
	model: "glm-4.6",
	responseModel: "glm-4.6",
	usage: {
		input: 100,
		output: 50,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 150,
		cost: { input: 0.0001, output: 0.0002, cacheRead: 0, cacheWrite: 0, total: 0.0003 },
	},
	stopReason: "stop",
	timestamp: 1714000000000,
};

describe("turnAttributes", () => {
	it("emits all required gen_ai.* attributes", () => {
		const attrs = turnAttributes(turn, ctx);
		expect(attrs["gen_ai.operation.name"]).toBe("chat");
		expect(attrs["gen_ai.provider.name"]).toBe("anthropic");
		expect(attrs["gen_ai.request.model"]).toBe("glm-4.6");
		expect(attrs["gen_ai.response.model"]).toBe("glm-4.6");
		expect(attrs["gen_ai.usage.input_tokens"]).toBe(100);
		expect(attrs["gen_ai.usage.output_tokens"]).toBe(50);
		expect(attrs["gen_ai.usage.cache_read.input_tokens"]).toBe(0);
		expect(attrs["gen_ai.usage.cache_creation.input_tokens"]).toBe(0);
		expect(attrs["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
		expect(attrs["gen_ai.conversation.id"]).toBe("session-uuid");
	});

	it("emits all required agent.* attributes", () => {
		const attrs = turnAttributes(turn, ctx);
		expect(attrs["agent.user.id"]).toBe("test@example.invalid");
		expect(attrs["agent.machine.id"]).toBe("00000000-0000-0000-0000-000000000001");
		expect(attrs["agent.session.id"]).toBe("session-uuid");
		expect(attrs["agent.workspace.cwd"]).toBe("/workspace");
		expect(attrs["agent.workspace.repo"]).toBe("vilosource/pi-extensions");
		expect(attrs["agent.workspace.branch"]).toBe("main");
		expect(attrs["agent.workspace.is_ci"]).toBe(false);
		expect(attrs["agent.api.dialect"]).toBe("anthropic-messages");
		expect(attrs["agent.cost.input.usd"]).toBe(0.0001);
		expect(attrs["agent.cost.output.usd"]).toBe(0.0002);
		expect(attrs["agent.cost.total.usd"]).toBe(0.0003);
		expect(attrs["agent.stop_reason"]).toBe("stop");
		expect(attrs["agent.event.kind"]).toBe("turn");
		expect(attrs["agent.harness.name"]).toBe("pi");
		expect(attrs["agent.harness.version"]).toBe("0.74.0");
	});

	it("omits agent.workspace.repo when undefined (avoids null in OTel)", () => {
		const noRepo = { ...ctx, workspace: { ...workspace, repo: undefined } };
		const attrs = turnAttributes(turn, noRepo);
		expect("agent.workspace.repo" in attrs).toBe(false);
	});

	it("omits agent.workspace.branch when undefined", () => {
		const noBranch = { ...ctx, workspace: { ...workspace, branch: undefined } };
		const attrs = turnAttributes(turn, noBranch);
		expect("agent.workspace.branch" in attrs).toBe(false);
	});
});

describe("mapProvider", () => {
	it.each([
		["anthropic", "anthropic"],
		["openai", "openai"],
		["google", "gcp.gen_ai"],
		["bedrock", "aws.bedrock"],
		["azure", "az.ai.inference"],
		["openrouter", "openrouter"],
		["copilot", "github.copilot"],
		["github-copilot", "github.copilot"],
		["vllm", "vllm"],
		["pi-pods", "vllm"],
	])("maps pi-mono provider %s to OTel %s", (input, expected) => {
		expect(mapProvider(input)).toBe(expected);
	});

	it("passes unknown providers through lowercased", () => {
		expect(mapProvider("SomeFutureProvider")).toBe("somefutureprovider");
	});
});
