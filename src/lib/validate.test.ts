import { describe, expect, test } from "bun:test";
import { validate } from "./validate";

// T-01, T-02, T-03, T-04, T-11, T-12 — see specs/005-publish/design.md → Test
// cases → Slice 1.
//
// Task 2 implements only the structure keywords: type, properties, required,
// additionalProperties. The constraint keywords (minLength, enum, pattern,
// format, minItems, items) arrive in Task 3 — until then the interpreter must
// refuse them as unknown (T-11's whole point). These fixtures therefore carry
// only the four structure keywords and stay valid forever; they are never
// edited when Task 3 lands its own live-shaped fixtures.

const structureOnlyWritingSchema = {
	type: "object",
	properties: {
		title: { type: "string" },
		date: { type: "string" },
		readingTime: { type: "string" },
		summary: { type: "string" },
	},
	required: ["title", "date", "readingTime", "summary"],
	additionalProperties: false,
};

const structureOnlyProjectSchema = {
	type: "object",
	properties: {
		title: { type: "string" },
		summary: { type: "string" },
		stack: { type: "array" },
		status: { type: "string" },
		repo: { type: "string" },
		demo: { type: "string" },
	},
	required: ["title", "summary", "stack"],
	additionalProperties: false,
};

describe("validate", () => {
	test("T-01: valid writing metadata passes", () => {
		const metadata = {
			title: "What CRDTs taught me",
			date: "2026-08-03",
			readingTime: "3 min",
			summary: "A short summary.",
		};

		expect(validate(structureOnlyWritingSchema, metadata)).toEqual([]);
	});

	test("T-02: a missing required field is named", () => {
		const metadata = {
			title: "What CRDTs taught me",
			date: "2026-08-03",
			readingTime: "3 min",
		};

		const errors = validate(structureOnlyWritingSchema, metadata);

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("summary");
	});

	test("T-03: every error is collected, not just the first", () => {
		const metadata = {
			title: "What CRDTs taught me",
			readingTime: "3 min",
		};

		const errors = validate(structureOnlyWritingSchema, metadata);

		expect(errors).toHaveLength(2);
		expect(errors.some((error) => error.includes("date"))).toBe(true);
		expect(errors.some((error) => error.includes("summary"))).toBe(true);
	});

	test("T-04: an unknown key is refused", () => {
		const metadata = {
			title: "What CRDTs taught me",
			date: "2026-08-03",
			readingTime: "3 min",
			summary: "A short summary.",
			tags: ["crdt"],
		};

		const errors = validate(structureOnlyWritingSchema, metadata);

		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((error) => error.includes("tags"))).toBe(true);
	});

	test("T-11: an unknown keyword refuses, never silently passes", () => {
		const schemaWithUnknownKeyword = {
			...structureOnlyWritingSchema,
			properties: {
				...structureOnlyWritingSchema.properties,
				title: { type: "string", maxLength: 10 },
			},
		};
		const metadata = {
			title: "What CRDTs taught me",
			date: "2026-08-03",
			readingTime: "3 min",
			summary: "A short summary.",
		};

		const errors = validate(schemaWithUnknownKeyword, metadata);

		expect(errors).not.toEqual([]);
		expect(errors.some((error) => error.includes("maxLength"))).toBe(true);
	});

	test("T-12: an optional field may be absent", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: ["typescript"],
		};

		expect(validate(structureOnlyProjectSchema, metadata)).toEqual([]);
	});
});
