import { describe, expect, it } from "vitest";
import { flagBool, flagString, parseArgs } from "./args.js";

describe("parseArgs", () => {
	it("extracts the subcommand and bare boolean flags", () => {
		const a = parseArgs(["status", "--help"]);
		expect(a.command).toBe("status");
		expect(flagBool(a, "help")).toBe(true);
	});

	it("parses --key=value", () => {
		const a = parseArgs(["login", "--endpoint=https://x.example", "--client-id=abc"]);
		expect(a.command).toBe("login");
		expect(flagString(a, "endpoint")).toBe("https://x.example");
		expect(flagString(a, "client-id")).toBe("abc");
	});

	it("parses --key value for known value flags", () => {
		const a = parseArgs(["login", "--authority", "https://issuer.example", "--api-scope", "api://x/access_as_user"]);
		expect(flagString(a, "authority")).toBe("https://issuer.example");
		expect(flagString(a, "api-scope")).toBe("api://x/access_as_user");
	});

	it("does not consume the next token for an unknown flag", () => {
		const a = parseArgs(["login", "--weird", "status"]);
		expect(flagBool(a, "weird")).toBe(true);
		expect(a.positionals).toEqual(["status"]);
	});

	it("returns undefined command for empty argv", () => {
		expect(parseArgs([]).command).toBeUndefined();
	});
});
