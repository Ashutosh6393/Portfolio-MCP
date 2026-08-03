import { describe, expect, test } from "bun:test";
import { renderDraft } from "../lib/draft";
import { type Github, GithubNotFoundError } from "../lib/github";
import { discardDraft } from "./discard-draft";

// T-16…T-18, T-34 — see specs/004-drafts/design.md → Test cases → discard_draft.
//
// The seam is `deps.github`, a plain object literal. No mocking framework, no
// `mock.module()`, no `as any`.
//
// discardDraft only ever reads a sha and deletes — readFileWithSha and
// deleteFile are the only two methods exercised. Every fake wires the rest to
// throw loudly so an accidental call fails the test instead of passing
// silently.
const noOtherPath = {
	async listDirectory(): Promise<never> {
		throw new Error("listDirectory is not part of discard_draft");
	},
	async readFile(): Promise<never> {
		throw new Error("readFile is not part of discard_draft");
	},
	async writeFile(): Promise<never> {
		throw new Error("writeFile is not part of discard_draft");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 11 widens `Github` with these
	// three, so every fake must carry them to typecheck. discardDraft never
	// touches the publish path, so these throw rather than return a plausible
	// value: an accidental call fails loudly instead of passing silently.
	async getBranchHead(): Promise<never> {
		throw new Error("getBranchHead is not part of discard_draft");
	},
	async createBranch(): Promise<never> {
		throw new Error("createBranch is not part of discard_draft");
	},
	async createPullRequest(): Promise<never> {
		throw new Error("createPullRequest is not part of discard_draft");
	},
};

type ReadCall = { repo: string; path: string };
type DeleteCall = {
	repo: string;
	path: string;
	options: { message: string; sha: string };
};

// A github that answers readFileWithSha with the given text and sha, and
// records both readFileWithSha and deleteFile calls.
function githubReturning(
	text: string,
	sha: string,
): { github: Github; readCalls: ReadCall[]; deleteCalls: DeleteCall[] } {
	const readCalls: ReadCall[] = [];
	const deleteCalls: DeleteCall[] = [];
	const github: Github = {
		...noOtherPath,
		async readFileWithSha(repo, path) {
			readCalls.push({ repo, path });
			return { content: text, sha };
		},
		async deleteFile(repo, path, options) {
			deleteCalls.push({ repo, path, options });
		},
	};
	return { github, readCalls, deleteCalls };
}

// A github whose readFileWithSha throws the given error; deleteFile is wired
// to throw loudly since T-17 must prove it is never reached.
function githubThrowingOnRead(error: Error): {
	github: Github;
	readCalls: ReadCall[];
} {
	const readCalls: ReadCall[] = [];
	const github: Github = {
		...noOtherPath,
		async readFileWithSha(repo, path) {
			readCalls.push({ repo, path });
			throw error;
		},
		async deleteFile(): Promise<never> {
			throw new Error("deleteFile must not be called after a 404 read");
		},
	};
	return { github, readCalls };
}

describe("discardDraft — removing an existing draft", () => {
	test("T-16: deletes the draft at its path, using the sha the read returned", async () => {
		const { github, readCalls, deleteCalls } = githubReturning(
			renderDraft({ title: "A Post" }, "Body."),
			"abc",
		);

		const result = await discardDraft(
			{ github },
			{ kind: "writing", slug: "a-post" },
		);

		expect(result.ok).toBe(true);

		expect(readCalls).toHaveLength(1);
		const readCall = readCalls[0];
		if (!readCall) throw new Error("expected a read call");
		expect(readCall.repo).toBe("workshop");
		expect(readCall.path).toBe("drafts/writing/a-post.mdx");

		expect(deleteCalls).toHaveLength(1);
		const deleteCall = deleteCalls[0];
		if (!deleteCall) throw new Error("expected a delete call");
		expect(deleteCall.repo).toBe("workshop");
		expect(deleteCall.path).toBe("drafts/writing/a-post.mdx");
		expect(deleteCall.options.sha).toBe("abc");
	});
});

describe("discardDraft — no draft at that path", () => {
	test("T-17: a GithubNotFoundError is refused, naming the kind and slug, and deleteFile is never called", async () => {
		const { github, readCalls } = githubThrowingOnRead(
			new GithubNotFoundError("workshop", "drafts/project/a-thing.mdx"),
		);

		const result = await discardDraft(
			{ github },
			{ kind: "project", slug: "a-thing" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");

		// design.md line 326: this exact sentence has been confirmed by the
		// human as the text to ship. Note the tension flagged in
		// CLAUDE.md/security.md — GitHub answers 404 for both "not there" and
		// "the token cannot see it", so stating this as a fact of absence is
		// arguably not "what is true". The human decided to ship the specified
		// wording as-is and settle it separately; this test pins that decision,
		// not a re-litigation of it.
		expect(result.error).toBe("There is no draft at project/a-thing.");

		expect(readCalls).toHaveLength(1);
	});
});

describe("discardDraft — a draft with a broken metadata block", () => {
	test("T-18: is deleted anyway — the one you most want to throw away must not need parsing", async () => {
		// No line that is exactly "}", so readDraft would return null. discardDraft
		// must never call readDraft at all, so this content must still delete.
		const brokenText = 'export const metadata = { title: "Oops"\n\nBody text.';
		const { github, deleteCalls } = githubReturning(brokenText, "abc");

		const result = await discardDraft(
			{ github },
			{ kind: "writing", slug: "a-post" },
		);

		expect(result.ok).toBe(true);
		expect(deleteCalls).toHaveLength(1);
		const deleteCall = deleteCalls[0];
		if (!deleteCall) throw new Error("expected a delete call");
		expect(deleteCall.options.sha).toBe("abc");
	});
});

describe("discardDraft — the delete itself failing", () => {
	// T-35 — specs/004-drafts/design.md → Test cases → discard_draft, added by
	// the slice 3 review: readFileWithSha is guarded by try/catch but
	// deleteFile is not, so a throwing deleteFile currently rejects the whole
	// promise instead of returning the specified `{ ok: false }` union.
	test("T-35: a deleteFile failure is an error result naming GitHub, not a rejection", async () => {
		const github: Github = {
			...noOtherPath,
			async readFileWithSha() {
				return {
					content: renderDraft({ title: "A Post" }, "Body."),
					sha: "abc",
				};
			},
			async deleteFile(): Promise<never> {
				throw new Error("boom");
			},
		};

		const result = await discardDraft(
			{ github },
			{ kind: "writing", slug: "a-post" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("GitHub");
	});
});

describe("discardDraft — the slug is a trust boundary", () => {
	// Same trust boundary T-32 closed for save_draft and T-33 closed for
	// get_content — but this one deletes. Added to design.md before slice 3's
	// code exists, ahead of a review finding it missing.
	test("T-34: a slug that is not a slug is refused before any read or delete is attempted", async () => {
		const { github, readCalls, deleteCalls } = githubReturning(
			"irrelevant",
			"abc",
		);

		const result = await discardDraft(
			{ github },
			{
				kind: "writing",
				slug: "../../../../Portfolio-new/contents/package.json?",
			},
		);

		expect(result.ok).toBe(false);

		expect(readCalls).toHaveLength(0);
		expect(deleteCalls).toHaveLength(0);
	});
});
