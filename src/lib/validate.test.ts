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

// T-05 .. T-10 — see specs/005-publish/design.md -> Test cases -> Slice 1.
//
// These fixtures carry the live schema shape, constraint keywords and all,
// per specs/005-publish/design.md -> Live facts. They stand alongside the
// Task 2 structure-only fixtures above rather than replacing them, so T-11's
// "unknown keyword refuses" behaviour is still exercised against a schema
// that genuinely has none of these six keywords implemented yet.
const liveWritingSchema = {
	type: "object",
	properties: {
		title: { type: "string", minLength: 1 },
		date: {
			type: "string",
			format: "date",
			// A real date-range pattern, not just digit-shape, so T-07 can prove
			// the pattern is doing the work and not the (no-op) format keyword.
			pattern: "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$",
		},
		readingTime: { type: "string", minLength: 1 },
		summary: { type: "string", minLength: 1 },
	},
	required: ["title", "date", "readingTime", "summary"],
	additionalProperties: false,
};

const liveProjectSchema = {
	type: "object",
	properties: {
		title: { type: "string", minLength: 1 },
		summary: { type: "string", minLength: 1 },
		stack: { type: "array", minItems: 1, items: { type: "string" } },
		status: { type: "string", enum: ["shipped", "wip"] },
		repo: { type: "string", format: "uri" },
		demo: { type: "string", format: "uri" },
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

	test("T-05: minLength is enforced", () => {
		const metadata = {
			title: "",
			date: "2026-08-03",
			readingTime: "3 min",
			summary: "A short summary.",
		};

		const errors = validate(liveWritingSchema, metadata);

		// Naming the field alone isn't enough: the "unknown keyword" refusal
		// also names the field. This must be a real constraint violation, not
		// that refusal — otherwise the test passes before minLength is ever
		// checked.
		expect(
			errors.some(
				(error) =>
					error.includes("title") && !error.includes("does not implement"),
			),
		).toBe(true);
	});

	test("T-06: an enum is enforced and lists the allowed values", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: ["typescript"],
			status: "done",
		};

		const errors = validate(liveProjectSchema, metadata);

		expect(errors.some((error) => error.includes("status"))).toBe(true);
		expect(errors.some((error) => error.includes("shipped"))).toBe(true);
		expect(errors.some((error) => error.includes("wip"))).toBe(true);
	});

	test("T-07: pattern is enforced", () => {
		const metadata = {
			title: "What CRDTs taught me",
			date: "2026-13-45",
			readingTime: "3 min",
			summary: "A short summary.",
		};

		const errors = validate(liveWritingSchema, metadata);

		expect(
			errors.some(
				(error) =>
					error.includes("date") && !error.includes("does not implement"),
			),
		).toBe(true);
	});

	test("T-08: format: uri is enforced", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: ["typescript"],
			repo: "not a url",
		};

		const errors = validate(liveProjectSchema, metadata);

		expect(
			errors.some(
				(error) =>
					error.includes("repo") && !error.includes("does not implement"),
			),
		).toBe(true);
	});

	test("T-09: minItems is enforced", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: [],
		};

		const errors = validate(liveProjectSchema, metadata);

		expect(
			errors.some(
				(error) =>
					error.includes("stack") && !error.includes("does not implement"),
			),
		).toBe(true);
	});

	test("T-10: items type is enforced", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: [1, 2],
		};

		const errors = validate(liveProjectSchema, metadata);

		expect(
			errors.some(
				(error) =>
					error.includes("stack") && !error.includes("does not implement"),
			),
		).toBe(true);
	});
});
