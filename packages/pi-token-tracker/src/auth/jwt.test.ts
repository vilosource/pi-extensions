import { describe, expect, it } from "vitest";
import { decodeJwtClaims, userIdFromClaims } from "./jwt.js";

function jwt(claims: Record<string, unknown>): string {
	const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
	return `${enc({ alg: "none" })}.${enc(claims)}.sig`;
}

describe("decodeJwtClaims", () => {
	it("decodes the payload of a well-formed JWT", () => {
		expect(decodeJwtClaims(jwt({ upn: "a@b.invalid", exp: 123 }))).toEqual({ upn: "a@b.invalid", exp: 123 });
	});
	it("returns undefined for a non-three-segment string", () => {
		expect(decodeJwtClaims("not.a.jwt.really")).toBeUndefined();
		expect(decodeJwtClaims("nope")).toBeUndefined();
	});
	it("returns undefined when the payload isn't base64url JSON", () => {
		expect(decodeJwtClaims("aaa.!!!.bbb")).toBeUndefined();
		expect(decodeJwtClaims(`aaa.${Buffer.from("[1,2,3]").toString("base64url")}.bbb`)).toBeUndefined();
	});
});

describe("userIdFromClaims", () => {
	it.each([
		[{ upn: "u@x" }, "u@x"],
		[{ preferred_username: "p@x" }, "p@x"],
		[{ email: "e@x" }, "e@x"],
		[{ unique_name: "n@x" }, "n@x"],
		[{ upn: "u@x", email: "e@x" }, "u@x"],
	])("prefers upn > preferred_username > email > unique_name (%j → %s)", (claims, expected) => {
		expect(userIdFromClaims(claims)).toBe(expected);
	});
	it("returns undefined for empty / missing / non-string claims", () => {
		expect(userIdFromClaims(undefined)).toBeUndefined();
		expect(userIdFromClaims({})).toBeUndefined();
		expect(userIdFromClaims({ upn: "" })).toBeUndefined();
		expect(userIdFromClaims({ upn: 42 })).toBeUndefined();
	});
});
