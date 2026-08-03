import { describe, expect, test } from "bun:test";
import { branchName, publicUrl, publishedPath, renderPrBody } from "./publish";

// T-39, T-40 — see specs/005-publish/design.md → Test cases → Slice 3, and
// → The PR body for the exact specified text.
//
// renderPrBody's argument shape (decided here, not in design.md):
//
//   type RenderPrBodyArgs =
//     | { kind: "writing"; slug: string; readingTime: string }
//     | { kind: "project"; slug: string; show: boolean; order: number };
//
// `readingTime` arrives pre-formatted ("16 min"), matching what `readingTime()`
// in lib/reading-time.ts returns — renderPrBody does not format it itself.

describe("renderPrBody", () => {
	test("T-39: a writing's body names the permanent URL, verbatim per design.md", () => {
		const body = renderPrBody({
			kind: "writing",
			slug: "my-first-post",
			readingTime: "16 min",
		});

		expect(body).toBe(
			`-> ashutoshverma.dev/writing/my-first-post
   This URL is permanent after merge.

Publishing writing/my-first-post from the workshop draft.
readingTime: 16 min — computed from the body, not supplied.`,
		);
	});

	test("T-40: a project's body names the supplied show/order, verbatim per design.md", () => {
		const body = renderPrBody({
			kind: "project",
			slug: "scaffold-ai",
			show: true,
			order: 1,
		});

		expect(body).toBe(
			`-> ashutoshverma.dev/projects/scaffold-ai
   This URL is permanent after merge.

   Homepage: show: true, order: 1
   Supplied, not computed. Fix them in this diff before merging if wrong.

Publishing project/scaffold-ai from the workshop draft.`,
		);
	});

	test("T-40: show: false and order: 0 are rendered, not dropped as falsy", () => {
		const body = renderPrBody({
			kind: "project",
			slug: "yapper",
			show: false,
			order: 0,
		});

		expect(body).toContain("Homepage: show: false, order: 0");
	});

	test("a writing's body carries the readingTime line", () => {
		const body = renderPrBody({
			kind: "writing",
			slug: "any-slug",
			readingTime: "3 min",
		});

		expect(body).toContain(
			"readingTime: 3 min — computed from the body, not supplied.",
		);
	});

	test("a project's body never carries a readingTime line", () => {
		const body = renderPrBody({
			kind: "project",
			slug: "any-slug",
			show: true,
			order: 2,
		});

		expect(body).not.toContain("readingTime");
	});

	test("a writing's body never carries the Homepage block", () => {
		const body = renderPrBody({
			kind: "writing",
			slug: "any-slug",
			readingTime: "1 min",
		});

		expect(body).not.toContain("Homepage");
	});
});

// T-56…T-59 — not in design.md's original list. Added to cover the plural
// hazard design.md names as "the single most likely thing to get wrong":
// two of {publishedPath, publicUrl, branchName} use the plural directory
// name (`projects`), one uses the singular domain word (`project`). See
// design.md → Live facts and → Risks.

describe("the plural hazard (T-56…T-59)", () => {
	test("T-56: publishedPath('project', ...) is plural — content/projects/", () => {
		expect(publishedPath("project", "scaffold-ai")).toBe(
			"content/projects/scaffold-ai.mdx",
		);
	});

	test("T-57: publishedPath('writing', ...) is singular — content/writing/", () => {
		expect(publishedPath("writing", "my-first-post")).toBe(
			"content/writing/my-first-post.mdx",
		);
	});

	test("T-58: publicUrl('project', ...) is plural — /projects/", () => {
		expect(publicUrl("project", "scaffold-ai")).toBe(
			"ashutoshverma.dev/projects/scaffold-ai",
		);
	});

	test("T-59: branchName('project', ...) is SINGULAR — publish/project/, not publish/projects/", () => {
		expect(branchName("project", "scaffold-ai")).toBe(
			"publish/project/scaffold-ai",
		);
	});

	test("publicUrl('writing', ...) is singular — /writing/", () => {
		expect(publicUrl("writing", "my-first-post")).toBe(
			"ashutoshverma.dev/writing/my-first-post",
		);
	});

	test("branchName('writing', ...) is singular — publish/writing/", () => {
		expect(branchName("writing", "my-first-post")).toBe(
			"publish/writing/my-first-post",
		);
	});
});
