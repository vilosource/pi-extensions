import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInstalled, runInstall, runUninstall } from "./install.js";

const EXT = "/opt/pkg/pi-token-tracker/dist/extension";
const sink = (): { lines: string[]; log: (l: string) => void } => {
	const lines: string[] = [];
	return { lines, log: (l) => lines.push(l) };
};

describe("install / uninstall", () => {
	let dir: string;
	let settings: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-tt-install-"));
		settings = join(dir, "settings.json");
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("creates the settings file when it doesn't exist", () => {
		const { log } = sink();
		expect(runInstall(settings, EXT, log)).toBe(0);
		expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({ extensions: [EXT] });
		expect(isInstalled(settings, EXT)).toBe(true);
	});

	it("appends without disturbing other keys or extensions", () => {
		writeFileSync(settings, JSON.stringify({ defaultModel: "x", extensions: ["/other/ext"] }));
		const { log } = sink();
		expect(runInstall(settings, EXT, log)).toBe(0);
		const parsed = JSON.parse(readFileSync(settings, "utf8"));
		expect(parsed.defaultModel).toBe("x");
		expect(parsed.extensions).toEqual(["/other/ext", EXT]);
	});

	it("is idempotent", () => {
		const { log } = sink();
		runInstall(settings, EXT, log);
		expect(runInstall(settings, EXT, log)).toBe(0);
		expect(JSON.parse(readFileSync(settings, "utf8")).extensions).toEqual([EXT]);
	});

	it("uninstall removes only this extension", () => {
		writeFileSync(settings, JSON.stringify({ extensions: ["/other/ext", EXT] }));
		const { log } = sink();
		expect(runUninstall(settings, EXT, log)).toBe(0);
		expect(JSON.parse(readFileSync(settings, "utf8")).extensions).toEqual(["/other/ext"]);
	});

	it("uninstall is a no-op when not installed", () => {
		writeFileSync(settings, JSON.stringify({ extensions: ["/other/ext"] }));
		const { log } = sink();
		expect(runUninstall(settings, EXT, log)).toBe(0);
		expect(JSON.parse(readFileSync(settings, "utf8")).extensions).toEqual(["/other/ext"]);
	});

	it("uninstall is a no-op when the file is absent", () => {
		const { log } = sink();
		expect(runUninstall(settings, EXT, log)).toBe(0);
	});

	it("refuses to touch a settings file that isn't valid JSON", () => {
		writeFileSync(settings, "{ not json");
		const { lines, log } = sink();
		expect(runInstall(settings, EXT, log)).toBe(1);
		expect(lines.join(" ")).toMatch(/not valid JSON/);
	});

	it("refuses when `extensions` is not an array of strings", () => {
		writeFileSync(settings, JSON.stringify({ extensions: { a: 1 } }));
		const { lines, log } = sink();
		expect(runInstall(settings, EXT, log)).toBe(1);
		expect(lines.join(" ")).toMatch(/not an array of strings/);
	});
});
