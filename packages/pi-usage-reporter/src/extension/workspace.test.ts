import { describe, expect, it } from "vitest";
import { normalizeRepoUrl } from "./workspace.js";

describe("normalizeRepoUrl", () => {
	it.each([
		["git@github.com:vilosource/pi-extensions.git", "github.com/vilosource/pi-extensions"],
		["git@github.com:vilosource/pi-extensions", "github.com/vilosource/pi-extensions"],
		["https://github.com/vilosource/pi-extensions.git", "github.com/vilosource/pi-extensions"],
		["https://github.com/vilosource/pi-extensions", "github.com/vilosource/pi-extensions"],
		["http://gitlab.example.com/group/project.git", "gitlab.example.com/group/project"],
		["ssh://git@gitlab.example.com:2222/owner/proj.git", "gitlab.example.com/owner/proj"],
		["git://github.com/owner/repo.git", "github.com/owner/repo"],
	])("normalizes %s -> %s", (input, expected) => {
		expect(normalizeRepoUrl(input)).toBe(expected);
	});

	it("trims whitespace", () => {
		expect(normalizeRepoUrl("  git@github.com:owner/repo.git  ")).toBe("github.com/owner/repo");
	});
});
