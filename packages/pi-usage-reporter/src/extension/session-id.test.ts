import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeCwd, resolveSessionId } from "./session-id.js";

describe("encodeCwd", () => {
	it.each([
		["/home/jasonvi/KB/pi-dev", "--home-jasonvi-KB-pi-dev--"],
		["/", "----"],
		["home/dir", "--home-dir--"],
		["/a/b/c", "--a-b-c--"],
	])("encodes %s as %s", (input, expected) => {
		expect(encodeCwd(input)).toBe(expected);
	});
});

describe("resolveSessionId", () => {
	let tmp: string;
	const cwd = "/home/jasonvi/test-cwd";
	const dir = () => join(tmp, encodeCwd(cwd));

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "pi-usage-test-"));
		mkdirSync(dir(), { recursive: true });
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("returns the UUID of the newest recent jsonl file", () => {
		const uuid1 = "11111111-1111-1111-1111-111111111111";
		const uuid2 = "22222222-2222-2222-2222-222222222222";
		const f1 = join(dir(), `2026-05-08T10-00-00-000Z_${uuid1}.jsonl`);
		const f2 = join(dir(), `2026-05-08T10-00-01-000Z_${uuid2}.jsonl`);
		writeFileSync(f1, "");
		writeFileSync(f2, "");
		const now = Date.now();
		// Set mtimes explicitly: f1 in the past, f2 closer to now.
		// Filesystem mtime resolution can be 1s on some platforms; use 5s gap.
		utimesSync(f1, now / 1000, (now - 5000) / 1000);
		utimesSync(f2, now / 1000, (now - 1000) / 1000);
		const result = resolveSessionId({ cwd, sessionsRoot: tmp, now });
		expect(result).toBe(uuid2);
	});

	it("ignores files outside the recent window", () => {
		const oldUuid = "11111111-1111-1111-1111-111111111111";
		const f = join(dir(), `2026-05-08T10-00-00-000Z_${oldUuid}.jsonl`);
		writeFileSync(f, "");
		// Pretend an hour passed
		const now = Date.now() + 3_600_000;
		const result = resolveSessionId({ cwd, sessionsRoot: tmp, now });
		// Should fall back to a UUID, NOT return oldUuid
		expect(result).not.toBe(oldUuid);
		// Result is still a valid UUID
		expect(result).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("returns a generated UUID when the session directory is missing", () => {
		const result = resolveSessionId({
			cwd: "/nonexistent",
			sessionsRoot: tmp,
		});
		expect(result).toMatch(/^[0-9a-f-]{36}$/);
	});

	it("ignores files that do not match the expected name pattern", () => {
		writeFileSync(join(dir(), "garbage.jsonl"), "");
		writeFileSync(join(dir(), "not-a-session.txt"), "");
		const result = resolveSessionId({ cwd, sessionsRoot: tmp });
		expect(result).toMatch(/^[0-9a-f-]{36}$/);
		expect(result).not.toBe("garbage");
	});
});
