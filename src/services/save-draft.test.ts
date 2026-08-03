import { describe, expect, test } from "bun:test";
import { renderDraft } from "../lib/draft";
import {
	type Github,
	GithubAlreadyExistsError,
	GithubConflictError,
} from "../lib/github";
import type { Project, Site, Writing } from "../lib/site";
import { saveDraft } from "./save-draft";

// T-07, T-08, T-12, T-13, T-14, T-32 — see specs/004-drafts/design.md → Test
// cases → save_draft. T-09…T-11, T-15 belong to Task 4 and are not covered
// here.
//
// The seam is `deps.site` and `deps.github`, both plain object literals. No
// mocking framework, no `mock.module()`, no `as any`.
//
// Result shape — pinning `path` as the success field, source of truth for
// Task 6, same convention as get-skill.test.ts:
//
//   { ok: true; path: string } | { ok: false; error: string }

// saveDraft never reads a directory, reads a single file, or deletes one —
// only writeFile is exercised. Every fake wires the rest to throw loudly so
// an accidental call fails the test instead of passing silently.
const noReadPath = {
	async listDirectory(): Promise<never> {
		throw new Error("listDirectory is not part of save_draft");
	},
	async readFile(): Promise<never> {
		throw new Error("readFile is not part of save_draft");
	},
	async readFileWithSha(): Promise<never> {
		throw new Error("readFileWithSha is not part of save_draft");
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of save_draft");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 11 widens `Github` with these
	// three, so every fake must carry them to typecheck. saveDraft never
	// touches the publish path, so these throw rather than return a plausible
	// value: an accidental call fails loudly instead of passing silently.
	async getBranchHead(): Promise<never> {
		throw new Error("getBranchHead is not part of save_draft");
	},
	async createBranch(): Promise<never> {
		throw new Error("createBranch is not part of save_draft");
	},
	async createPullRequest(): Promise<never> {
		throw new Error("createPullRequest is not part of save_draft");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 15 adds `findPullRequest` to
	// `Github`, so every fake must carry it to typecheck. saveDraft never
	// touches the publish path, so this throws rather than returning `null` —
	// `null` is a meaningful answer here ("no PR exists for this branch"), and
	// a stub that returned it could let an idempotency test pass without
	// saveDraft ever having called it.
	async findPullRequest(): Promise<never> {
		throw new Error("findPullRequest is not part of save_draft");
	},
};

type WriteCall = {
	repo: string;
	path: string;
	content: string;
	options: { message: string; sha?: string };
};

// Records every writeFile call so a test can assert the exact write (T-07,
// T-08, T-14) or assert none happened at all (T-12, T-13, T-32).
function githubAcceptingWrites(): { github: Github; calls: WriteCall[] } {
	const calls: WriteCall[] = [];
	const github: Github = {
		...noReadPath,
		async writeFile(repo, path, content, options) {
			calls.push({ repo, path, content, options });
		},
	};
	return { github, calls };
}

const writingItem = (slug: string): Writing => ({
	slug,
	title: "An existing post",
	date: "2026-01-01",
	readingTime: "3 min",
	summary: "Already published.",
});

// Test revision, 2026-08-03 — see Test revisions table in
// specs/005-publish/implementation.md. Task 4 widens `Site` with
// `fetchSchema`, so every fake must carry it to typecheck. saveDraft never
// reaches the publish path, so this throws rather than return a plausible
// value: an accidental call fails loudly instead of passing silently.
async function fetchSchemaNotPartOfThisTest(): Promise<never> {
	throw new Error("fetchSchema is not part of this test");
}

// Test revision, 2026-08-03 (second) — see Test revisions table in
// specs/005-publish/implementation.md. Task 6 widens `Site` with
// `fetchDocument`, so every fake must carry it to typecheck too. Same
// reasoning as fetchSchemaNotPartOfThisTest above.
async function fetchDocumentNotPartOfThisTest(): Promise<never> {
	throw new Error("fetchDocument is not part of this test");
}

// A site whose fetchContent returns whatever items are handed to it,
// regardless of kind — the tests only ever exercise one kind at a time.
function siteReturning(items: Writing[] | Project[]): Site {
	return {
		async fetchContent() {
			return items;
		},
		fetchSchema: fetchSchemaNotPartOfThisTest,
		fetchDocument: fetchDocumentNotPartOfThisTest,
	};
}

// A site that cannot be reached at all — used for T-13 and, incidentally,
// to prove T-32 never gets far enough to call it.
function siteThatThrows(): Site {
	return {
		async fetchContent() {
			throw new Error("ashutoshverma.dev did not respond");
		},
		fetchSchema: fetchSchemaNotPartOfThisTest,
		fetchDocument: fetchDocumentNotPartOfThisTest,
	};
}

describe("saveDraft — creating a new draft", () => {
	test("T-07: a new writing draft is written to drafts/writing/{slug}.mdx with no sha", async () => {
		const { github, calls } = githubAcceptingWrites();
		const site = siteReturning([]);
		const metadata = { title: "A Post" };
		const body = "Hello world.";

		const result = await saveDraft(
			{ site, github },
			{ kind: "writing", slug: "a-post", metadata, body },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");

		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error("expected a write call");
		expect(call.repo).toBe("workshop");
		expect(call.path).toBe("drafts/writing/a-post.mdx");
		expect(call.content).toBe(renderDraft(metadata, body));
		expect(call.options.sha).toBeUndefined();
	});

	test("T-08: a new project draft is written to drafts/project/{slug}.mdx", async () => {
		const { github, calls } = githubAcceptingWrites();
		const site = siteReturning([]);
		const metadata = { title: "A Thing" };
		const body = "Some project body.";

		const result = await saveDraft(
			{ site, github },
			{ kind: "project", slug: "a-thing", metadata, body },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");

		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error("expected a write call");
		expect(call.path).toBe("drafts/project/a-thing.mdx");
		expect(call.content).toBe(renderDraft(metadata, body));
		expect(call.options.sha).toBeUndefined();
	});
});

describe("saveDraft — refusing to shadow or guess", () => {
	test("T-12: refuses when the slug is already published, naming the slug, and never writes", async () => {
		const { github, calls } = githubAcceptingWrites();
		const site = siteReturning([writingItem("a-post")]);

		const result = await saveDraft(
			{ site, github },
			{
				kind: "writing",
				slug: "a-post",
				metadata: { title: "A Post" },
				body: "Body.",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("a-post");
		expect(calls).toHaveLength(0);
	});

	test("T-13: refuses when the site is unreachable, naming the site, and never writes", async () => {
		const { github, calls } = githubAcceptingWrites();
		const site = siteThatThrows();

		const result = await saveDraft(
			{ site, github },
			{
				kind: "writing",
				slug: "a-post",
				metadata: { title: "A Post" },
				body: "Body.",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("ashutoshverma.dev");
		expect(calls).toHaveLength(0);
	});
});

describe("saveDraft — reserved keys", () => {
	test("T-14: show, order and readingTime are dropped silently; the title survives", async () => {
		const { github, calls } = githubAcceptingWrites();
		const site = siteReturning([]);
		const metadata = {
			title: "A Post",
			show: true,
			order: 3,
			readingTime: "5 min",
		};

		const result = await saveDraft(
			{ site, github },
			{ kind: "writing", slug: "a-post", metadata, body: "Body." },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");

		const call = calls[0];
		if (!call) throw new Error("expected a write call");
		expect(call.content).toContain("A Post");
		expect(call.content).not.toContain("show");
		expect(call.content).not.toContain("order");
		expect(call.content).not.toContain("readingTime");
	});
});

// A github whose writeFile records the call (so a test can prove it fired
// exactly once) and then throws the given error — used for T-10, T-11, T-15.
function githubThrowingOnWrite(error: Error): {
	github: Github;
	calls: WriteCall[];
} {
	const calls: WriteCall[] = [];
	const github: Github = {
		...noReadPath,
		async writeFile(repo, path, content, options) {
			calls.push({ repo, path, content, options });
			throw error;
		},
	};
	return { github, calls };
}

describe("saveDraft — the update path", () => {
	test("T-09: a sha is supplied, the writer accepts it, and the writer received that exact sha", async () => {
		const { github, calls } = githubAcceptingWrites();
		const site = siteReturning([]);
		const metadata = { title: "An Edited Post" };
		const body = "Edited body.";

		const result = await saveDraft(
			{ site, github },
			{
				kind: "writing",
				slug: "a-post",
				metadata,
				body,
				sha: "abc",
			},
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");

		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error("expected a write call");
		expect(call.options.sha).toBe("abc");
	});
});

describe("saveDraft — refusing a stale or blind write", () => {
	test("T-10: a GithubConflictError refuses without retrying, telling the model to re-read with get_content", async () => {
		const { github, calls } = githubThrowingOnWrite(
			new GithubConflictError("workshop", "drafts/writing/a-post.mdx"),
		);
		const site = siteReturning([]);

		const result = await saveDraft(
			{ site, github },
			{
				kind: "writing",
				slug: "a-post",
				metadata: { title: "A Post" },
				body: "Body.",
				sha: "stale-sha",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("changed");
		expect(result.error).toContain("get_content");
		// Not a retry: the writer was called exactly once, not called again
		// with a fresh sha or without one.
		expect(calls).toHaveLength(1);
	});

	test("T-11: a GithubAlreadyExistsError with no sha refuses instead of silently overwriting", async () => {
		const { github, calls } = githubThrowingOnWrite(
			new GithubAlreadyExistsError("workshop", "drafts/writing/a-post.mdx"),
		);
		const site = siteReturning([]);

		const result = await saveDraft(
			{ site, github },
			{
				kind: "writing",
				slug: "a-post",
				metadata: { title: "A Post" },
				body: "Body.",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("already exists");
		expect(result.error).toContain("get_content");
		expect(calls).toHaveLength(1);
	});

	test("T-15: a plain GitHub error is returned as a result naming GitHub, never thrown", async () => {
		const { github, calls } = githubThrowingOnWrite(
			new Error("GitHub returned 500 on the workshop repo."),
		);
		const site = siteReturning([]);

		const result = await saveDraft(
			{ site, github },
			{
				kind: "writing",
				slug: "a-post",
				metadata: { title: "A Post" },
				body: "Body.",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("GitHub");
		// Must not be mistaken for either refusal above.
		expect(result.error).not.toContain("get_content");
		expect(calls).toHaveLength(1);
	});
});

describe("saveDraft — the slug is a trust boundary", () => {
	test("T-32: a slug that is not kebab-case is refused before anything is written", async () => {
		const { github, calls } = githubAcceptingWrites();
		// siteThatThrows alone doesn't prove ordering: a reversed check would also
		// end in `{ ok: false }` with no write, just via the site-unreachable path
		// (its error names ashutoshverma.dev). Asserting the message does NOT name
		// the site is what tells the two refusals apart and fails if the order
		// flips.
		const site = siteThatThrows();

		const result = await saveDraft(
			{ site, github },
			{
				kind: "writing",
				slug: "../../../etc/passwd",
				metadata: { title: "A Post" },
				body: "Body.",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).not.toContain("ashutoshverma.dev");
		expect(calls).toHaveLength(0);
	});
});
