import { describe, expect, test } from "bun:test";
import { projectListSchema, writingListSchema } from "./site";

// T-14 — see specs/001-server-skeleton/design.md → Test cases.
// testing.md: lib/site.ts's fetch is not unit-tested against a mock of the
// site; that would test the mock. Its Zod parse is ours and is tested here,
// directly against the schemas — no fetch, no network.
//
// Live shapes, already verified and recorded in
// specs/001-server-skeleton/CLAUDE.md → Live facts:
//   writing:  slug, title, date, readingTime, summary
//   project:  slug, title, summary, stack, status, repo, +optional demo, show, order

describe("writingListSchema", () => {
	test("accepts a realistic writing entry", () => {
		const writings = [
			{
				slug: "hello-world",
				title: "Hello World",
				date: "2026-01-01",
				readingTime: "3 min",
				summary: "A first post.",
			},
		];

		expect(() => writingListSchema.parse(writings)).not.toThrow();
	});

	test("accepts an empty list", () => {
		expect(writingListSchema.parse([])).toEqual([]);
	});

	test("T-14: rejects an entry with an unexpected shape", () => {
		expect(() => writingListSchema.parse([{ nope: 1 }])).toThrow();
	});
});

describe("projectListSchema", () => {
	test("accepts a realistic project entry", () => {
		const projects = [
			{
				slug: "portfolio-mcp",
				title: "Portfolio MCP",
				summary: "An MCP server for the site.",
				stack: ["TypeScript", "Bun"],
				status: "live",
				repo: "ashutosh625/portfolio-mcp",
			},
		];

		expect(() => projectListSchema.parse(projects)).not.toThrow();
	});

	test("accepts a project entry with the optional fields present", () => {
		const projects = [
			{
				slug: "portfolio-mcp",
				title: "Portfolio MCP",
				summary: "An MCP server for the site.",
				stack: ["TypeScript", "Bun"],
				status: "live",
				repo: "ashutosh625/portfolio-mcp",
				demo: "https://example.com",
				show: true,
				order: 1,
			},
		];

		expect(() => projectListSchema.parse(projects)).not.toThrow();
	});

	test("accepts an empty list", () => {
		expect(projectListSchema.parse([])).toEqual([]);
	});

	test("T-14: rejects an entry with an unexpected shape", () => {
		expect(() => projectListSchema.parse([{ nope: 1 }])).toThrow();
	});
});
