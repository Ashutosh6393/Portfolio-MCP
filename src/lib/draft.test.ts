import { describe, expect, test } from "bun:test";
import { readDraft, renderDraft } from "./draft";

// T-01, T-02, T-03, T-04, T-05, T-06, T-06b
// See specs/004-drafts/design.md → Test cases → The format — src/lib/draft.ts.
//
// renderDraft and readDraft are exact inverses. The round trip is the property
// that matters; every convenience added to one side breaks it. The two-space
// indent is load-bearing — it is what leaves the top-level closing brace as the
// only `}` at column 0, which is the whole delimiter.
//
// draftPath and isSlug are proven at the service level by T-07 and T-32.

describe("renderDraft / readDraft round trip", () => {
	test("T-01: returns the metadata and body unchanged, with nested closing braces never ending the block", () => {
		const metadata = {
			title: "What CRDTs taught me",
			order: 3,
			author: { name: "Ashutosh", handle: "Ashutosh6393" },
			tags: ["crdt", "sync", "offline"],
		};
		const body = [
			"The body starts here, plain MDX.",
			"",
			"A second paragraph.",
			"And a third line.",
		].join("\n");

		const result = readDraft(renderDraft(metadata, body));

		expect(result).toEqual({ metadata, body });
	});

	test("T-02: drops a key whose value is undefined rather than writing an empty one", () => {
		const rendered = renderDraft(
			{ title: "A draft", summary: undefined },
			"body",
		);

		expect(rendered).not.toContain("summary");
		expect(rendered).not.toContain('""');

		const result = readDraft(rendered);

		expect(result).not.toBeNull();
		expect(Object.keys(result?.metadata ?? {})).toEqual(["title"]);
		expect(result?.metadata).toEqual({ title: "A draft" });
	});

	test("T-03: reads back empty metadata as an empty object, not as a failure", () => {
		const body = "A draft with no metadata yet.";

		const result = readDraft(renderDraft({}, body));

		expect(result).not.toBeNull();
		expect(result).toEqual({ metadata: {}, body });
	});

	test("T-04: preserves a body containing a line that is exactly a closing brace", () => {
		const metadata = { title: "Fenced code" };
		const body = [
			"Here is a fenced block:",
			"",
			"```js",
			"function hello() {",
			'  return "world";',
			"}",
			"```",
			"",
			"And some words after it.",
		].join("\n");

		const result = readDraft(renderDraft(metadata, body));

		expect(result?.body).toBe(body);
		expect(result?.metadata).toEqual(metadata);
	});
});

describe("renderDraft", () => {
	test("T-05: renders the metadata block with quoted keys indented two spaces, a closing brace at column 0, and a blank line before the body", () => {
		const rendered = renderDraft({ title: "x" }, "body");

		expect(rendered).toBe(
			'export const metadata = {\n  "title": "x"\n}\n\nbody',
		);
	});
});

describe("readDraft", () => {
	test("T-06: refuses a metadata block that will not parse", () => {
		const text = [
			"export const metadata = {",
			'  "title": "x",',
			"}",
			"",
			"body",
		].join("\n");

		expect(readDraft(text)).toBeNull();
	});

	test("T-06b: refuses a metadata block that never closes at column 0, without throwing", () => {
		const text = [
			"export const metadata = {",
			'  "title": "x"',
			"  }",
			"",
			"body",
		].join("\n");

		expect(() => readDraft(text)).not.toThrow();
		expect(readDraft(text)).toBeNull();
	});
});
