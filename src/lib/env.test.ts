import { describe, expect, test } from "bun:test";
import { parseEnv } from "./env";

// T-01, T-02, T-03 — see specs/001-server-skeleton/design.md → Test cases.
// parseEnv takes the environment as an argument (never mutates process.env),
// so every test here passes a plain object literal.

// A fine-grained PAT is `github_pat_` followed by opaque characters. Never a
// real token — see .claude/rules/security.md.
const validToken = `github_pat_${"x".repeat(22)}`;

describe("parseEnv", () => {
	test("T-01: throws naming MCP_SECRET_PATH when it is missing entirely", () => {
		expect(() => parseEnv({})).toThrow(/MCP_SECRET_PATH/);
	});

	test("T-02: throws stating the 32-character minimum when the secret is too short", () => {
		const shortSecret = "a".repeat(8);
		expect(() => parseEnv({ MCP_SECRET_PATH: shortSecret })).toThrow(/32/);
	});

	// Test revision, 2026-07-31 — see Test revisions table in
	// specs/002-github-access/implementation.md. Spec 001's T-03 pair passed an
	// environment holding only MCP_SECRET_PATH and PORT, complete at the time.
	// Spec 002 Task 1 makes GITHUB_TOKEN required, so that input is no longer a
	// valid environment and these two would fail on a missing variable rather
	// than on the behaviour they assert. Only the input grew — every assertion
	// below is untouched.
	test("T-03: returns a typed object with PORT coerced to a number when all vars are set", () => {
		const validSecret = "a".repeat(32);

		const env = parseEnv({
			MCP_SECRET_PATH: validSecret,
			GITHUB_TOKEN: validToken,
			PORT: "4000",
		});

		expect(env.MCP_SECRET_PATH).toBe(validSecret);
		expect(env.PORT).toBe(4000);
		expect(typeof env.PORT).toBe("number");
	});

	test("T-03: PORT defaults to 3000 when absent", () => {
		const validSecret = "a".repeat(32);

		const env = parseEnv({
			MCP_SECRET_PATH: validSecret,
			GITHUB_TOKEN: validToken,
		});

		expect(env.PORT).toBe(3000);
	});
});

// 002-T-01, 002-T-02, 002-T-03 — see specs/002-github-access/design.md → Test
// cases. Prefixed because spec 001 already owns T-01…T-03 in this file.
//
// The prefix check is stricter than .min(1) on purpose (design.md → Env
// validation): GitHub answers 404, not 403, for a private repo a token cannot
// see, so a classic token or a truncated paste would otherwise surface later as
// "skill not found" — an error pointing at exactly the wrong thing.

describe("parseEnv — GITHUB_TOKEN", () => {
	const validSecret = "a".repeat(32);

	test("002-T-01: throws naming GITHUB_TOKEN when it is missing entirely", () => {
		expect(() => parseEnv({ MCP_SECRET_PATH: validSecret })).toThrow(
			/GITHUB_TOKEN/,
		);
	});

	test("002-T-02: throws stating the github_pat_ prefix when given a classic ghp_ token", () => {
		const classicToken = `ghp_${"x".repeat(36)}`;

		expect(() =>
			parseEnv({ MCP_SECRET_PATH: validSecret, GITHUB_TOKEN: classicToken }),
		).toThrow(/github_pat_/);
	});

	test("002-T-02: throws on an empty token rather than accepting it", () => {
		expect(() =>
			parseEnv({ MCP_SECRET_PATH: validSecret, GITHUB_TOKEN: "" }),
		).toThrow(/github_pat_/);
	});

	test("002-T-03: returns the token on the parsed object when it is well-formed", () => {
		const env = parseEnv({
			MCP_SECRET_PATH: validSecret,
			GITHUB_TOKEN: validToken,
		});

		expect(env.GITHUB_TOKEN).toBe(validToken);
	});
});
