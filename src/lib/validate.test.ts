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

// T-05 .. T-10, plus the review-added happy-path and hole coverage below —
// see specs/005-publish/design.md -> Test cases -> Slice 1.
//
// REVISION (2026-08-03, review-driven, see specs/005-publish/implementation.md
// -> Test revisions): these two fixtures used to be hand-written and did not
// match the real site. They are now the ACTUAL documents captured from
// `GET https://ashutoshverma.dev/api/schema.json`, verbatim — including the
// `$schema` key and `stack.items.minLength`, both of which the hand-written
// versions omitted. That omission is exactly why the suite passed while the
// shipped `validate()` refused every real document: the fixtures asserted a
// shape the live site does not serve.
const liveWritingSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	type: "object",
	properties: {
		title: { type: "string", minLength: 1 },
		date: {
			type: "string",
			format: "date",
			pattern:
				"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$",
		},
		readingTime: { type: "string", minLength: 1 },
		summary: { type: "string", minLength: 1 },
	},
	required: ["title", "date", "readingTime", "summary"],
	additionalProperties: false,
};

const liveProjectSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	type: "object",
	properties: {
		title: { type: "string", minLength: 1 },
		summary: { type: "string", minLength: 1 },
		stack: {
			minItems: 1,
			type: "array",
			items: { type: "string", minLength: 1 },
		},
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

	// REVISION (2026-08-03, review-driven): design.md's T-01 says "the live
	// writing schema" — the actual document, constraint keywords and all, not
	// the structure-only fixture above. This assertion was missing entirely,
	// which is how the shipped validator shipped refusing every real writing
	// while T-01 stayed green.
	test("T-01 (full live schema): valid writing metadata passes against the real document, $schema and all", () => {
		const metadata = {
			title: "What CRDTs taught me",
			date: "2026-08-03",
			readingTime: "3 min",
			summary: "A short summary.",
		};

		expect(validate(liveWritingSchema, metadata)).toEqual([]);
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

	// REVISION (2026-08-03, review-driven): same gap as T-01 above, for the
	// project schema — the missing happy-path assertion against the real
	// document, which is what would have caught `stack.items.minLength` being
	// unimplemented on day one.
	test("T-12 (full live schema): valid project metadata passes against the real document, including a stack of strings", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: ["typescript", "bun"],
		};

		expect(validate(liveProjectSchema, metadata)).toEqual([]);
	});

	// REVISION (2026-08-03, review-driven): T-05 .. T-10 used to assert only
	// `errors.some(...)` — that a matching error exists among however many
	// come back, never that it is the ONLY error. A validator that returns a
	// spurious error on every field (exactly what shipped, via the unrecognised
	// `$schema` key and the unrecognised `items.minLength`) passed all six
	// unchanged. Each now asserts the exact error set the spec describes.
	test("T-05: minLength is enforced, and nothing else is wrong", () => {
		const metadata = {
			title: "",
			date: "2026-08-03",
			readingTime: "3 min",
			summary: "A short summary.",
		};

		const errors = validate(liveWritingSchema, metadata);

		expect(errors).toEqual(["`title` must be at least 1 character long."]);
	});

	test("T-06: an enum is enforced and lists the allowed values, and nothing else is wrong", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: ["typescript"],
			status: "done",
		};

		const errors = validate(liveProjectSchema, metadata);

		expect(errors).toEqual(["`status` must be one of: shipped, wip."]);
	});

	test("T-07: pattern is enforced, and nothing else is wrong", () => {
		const metadata = {
			title: "What CRDTs taught me",
			date: "2026-13-45",
			readingTime: "3 min",
			summary: "A short summary.",
		};

		const errors = validate(liveWritingSchema, metadata);

		expect(errors).toEqual(["`date` is not in the format the site expects."]);
	});

	test("T-08: format: uri is enforced, and nothing else is wrong", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: ["typescript"],
			repo: "not a url",
		};

		const errors = validate(liveProjectSchema, metadata);

		expect(errors).toEqual(["`repo` must be a URL."]);
	});

	test("T-09: minItems is enforced, and nothing else is wrong", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: [],
		};

		const errors = validate(liveProjectSchema, metadata);

		expect(errors).toEqual(["`stack` must have at least 1 item."]);
	});

	test("T-10: items type is enforced, and nothing else is wrong", () => {
		const metadata = {
			title: "scaffold-ai",
			summary: "A short summary.",
			stack: [1, 2],
		};

		const errors = validate(liveProjectSchema, metadata);

		expect(errors).toEqual(["Every item in `stack` must be string."]);
	});

	// T-52, T-53, T-54 — added by review, not part of design.md's original
	// Slice 1 list. They cover a resolved Open question and two structural
	// holes the reviewer found: the suite could not have caught either.

	test("T-52 (added by review): format: date with no pattern beside it is accepted as satisfied", () => {
		// design.md -> Open questions settles this: format: "date" is a
		// deliberate no-op because the live schema's `pattern` does the real
		// work. This schema carries no `pattern`, so it isolates that no-op —
		// today, deleting the `if (format === "date") return [];` line in
		// checkFormat would turn this test red without touching any other test.
		const schema = {
			type: "object",
			properties: {
				date: { type: "string", format: "date" },
			},
			required: ["date"],
			additionalProperties: false,
		};

		expect(validate(schema, { date: "2026-08-03" })).toEqual([]);
	});

	test("T-53 (added by review): an unimplemented items keyword is refused even when the array property is absent from the metadata", () => {
		// Keyword recognition is a property of the schema, not of what the
		// draft happens to contain. Today the `items` keyword walk lives inside
		// checkConstraints, which only runs when the array value is present —
		// so an absent optional array silently skips past an unimplemented
		// `items` constraint instead of refusing it.
		const schema = {
			type: "object",
			properties: {
				stack: {
					type: "array",
					items: { type: "string", maxLength: 10 },
				},
			},
			required: [],
			additionalProperties: false,
		};

		const errors = validate(schema, {});

		expect(errors).toEqual([
			"The schema constrains the items of `stack` with `maxLength`, which this validator does not implement.",
		]);
	});

	test("T-54 (added by review): a property schema with no type is refused, not silently skipped", () => {
		// A subschema missing `type` (or carrying a non-string one) hits
		// `typeof expected !== "string"` today and `continue`s past every
		// constraint on that field, including the one that would have caught
		// the bad value below.
		const schema = {
			type: "object",
			properties: {
				status: { enum: ["shipped", "wip"] },
			},
			required: [],
			additionalProperties: false,
		};

		const errors = validate(schema, { status: "invalid" });

		expect(errors).not.toEqual([]);
		expect(errors.some((error) => error.includes("status"))).toBe(true);
	});
});
