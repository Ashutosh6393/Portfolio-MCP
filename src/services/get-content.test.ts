import { describe, expect, test } from "bun:test";
import { renderDraft } from "../lib/draft";
import { type Github, GithubNotFoundError } from "../lib/github";
import { type Site, SiteNotFoundError, SiteShapeError } from "../lib/site";
import { getContent } from "./get-content";

// T-19…T-21 — see specs/004-drafts/design.md → Test cases → get_content /
// Test cases → readDraft (the unparseable-block refusal). Task 6's MCP-level
// tests are not covered here.
//
// The seam is `deps.github`, a plain object literal. No mocking framework, no
// `mock.module()`, no `as any`.
//
// getContent only ever reads — readFileWithSha is the one method exercised.
// Every fake wires the rest to throw loudly so an accidental call fails the
// test instead of passing silently.
const noWritePath = {
	async listDirectory(): Promise<never> {
		throw new Error("listDirectory is not part of get_content");
	},
	async readFile(): Promise<never> {
		throw new Error("readFile is not part of get_content");
	},
	async writeFile(): Promise<never> {
		throw new Error("writeFile is not part of get_content");
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of get_content");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 11 widens `Github` with these
	// three, so every fake must carry them to typecheck. getContent never
	// touches the publish path, so these throw rather than return a plausible
	// value: an accidental call fails loudly instead of passing silently.
	async getBranchHead(): Promise<never> {
		throw new Error("getBranchHead is not part of get_content");
	},
	async createBranch(): Promise<never> {
		throw new Error("createBranch is not part of get_content");
	},
	async createPullRequest(): Promise<never> {
		throw new Error("createPullRequest is not part of get_content");
	},
};

type ReadCall = { repo: string; path: string };

// Records every readFileWithSha call and answers with the given text and sha.
function githubReturning(
	text: string,
	sha: string,
): { github: Github; calls: ReadCall[] } {
	const calls: ReadCall[] = [];
	const github: Github = {
		...noWritePath,
		async readFileWithSha(repo, path) {
			calls.push({ repo, path });
			return { content: text, sha };
		},
	};
	return { github, calls };
}

// A github whose readFileWithSha throws the given error.
function githubThrowingOnRead(error: Error): {
	github: Github;
	calls: ReadCall[];
} {
	const calls: ReadCall[] = [];
	const github: Github = {
		...noWritePath,
		async readFileWithSha(repo, path) {
			calls.push({ repo, path });
			throw error;
		},
	};
	return { github, calls };
}

// Test revision, 2026-08-03 — see Test revisions table in
// specs/005-publish/implementation.md. Task 7 makes `state` a required
// argument and widens `deps` from `{ github }` to `{ github; site }`. The
// existing draft-reading tests above now pass `state: "draft"` explicitly
// and carry a `site` fake that throws if touched — no assertion changed,
// no test count dropped.
//
// A site whose every method throws — a draft read must never touch it.
const noSiteAccess: Site = {
	async fetchContent(): Promise<never> {
		throw new Error("fetchContent is not part of get_content");
	},
	async fetchSchema(): Promise<never> {
		throw new Error("fetchSchema is not part of get_content");
	},
	async fetchDocument(): Promise<never> {
		throw new Error("fetchDocument is not part of get_content");
	},
};

// A github whose every method throws — a published read must never touch it
// (T-25).
const noGithubAccess: Github = {
	async listDirectory(): Promise<never> {
		throw new Error("listDirectory is not part of a published read");
	},
	async readFile(): Promise<never> {
		throw new Error("readFile is not part of a published read");
	},
	async readFileWithSha(): Promise<never> {
		throw new Error("readFileWithSha is not part of a published read");
	},
	async writeFile(): Promise<never> {
		throw new Error("writeFile is not part of a published read");
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of a published read");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 11 widens `Github` with these
	// three, so every fake must carry them to typecheck. A published read
	// never touches the publish path, so these throw rather than return a
	// plausible value: an accidental call fails loudly instead of passing
	// silently.
	async getBranchHead(): Promise<never> {
		throw new Error("getBranchHead is not part of a published read");
	},
	async createBranch(): Promise<never> {
		throw new Error("createBranch is not part of a published read");
	},
	async createPullRequest(): Promise<never> {
		throw new Error("createPullRequest is not part of a published read");
	},
};

// A site returning a fixed document for any fetchDocument call.
function siteReturning(
	metadata: Record<string, unknown>,
	body: string,
): { site: Site; calls: Array<{ kind: string; slug: string }> } {
	const calls: Array<{ kind: string; slug: string }> = [];
	const site: Site = {
		async fetchContent(): Promise<never> {
			throw new Error("fetchContent is not part of get_content");
		},
		async fetchSchema(): Promise<never> {
			throw new Error("fetchSchema is not part of get_content");
		},
		async fetchDocument(kind, slug) {
			calls.push({ kind, slug });
			return { metadata, body };
		},
	};
	return { site, calls };
}

// A site whose fetchDocument throws the given error.
function siteThrowingOnFetchDocument(error: Error): {
	site: Site;
	calls: Array<{ kind: string; slug: string }>;
} {
	const calls: Array<{ kind: string; slug: string }> = [];
	const site: Site = {
		async fetchContent(): Promise<never> {
			throw new Error("fetchContent is not part of get_content");
		},
		async fetchSchema(): Promise<never> {
			throw new Error("fetchSchema is not part of get_content");
		},
		async fetchDocument(kind, slug) {
			calls.push({ kind, slug });
			throw error;
		},
	};
	return { site, calls };
}

describe("getContent — reading a draft", () => {
	test("T-19: returns the parsed metadata, exact body and sha of a rendered draft", async () => {
		// Non-trivial metadata: a nested object and an array, so "parsed" means
		// parsed and not a lucky flat case.
		const metadata = {
			title: "A Post",
			tags: ["mcp", "drafts"],
			author: { name: "Ashutosh", handle: "Ashutosh6393" },
		};
		const body = "Hello world.\n\nSome more text.";
		const text = renderDraft(metadata, body);
		const { github, calls } = githubReturning(text, "abc");

		const result = await getContent(
			{ github, site: noSiteAccess },
			{ kind: "writing", slug: "a-post", state: "draft" },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.metadata).toEqual(metadata);
		expect(result.body).toBe(body);
		expect(result.sha).toBe("abc");

		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error("expected a read call");
		expect(call.repo).toBe("workshop");
		expect(call.path).toBe("drafts/writing/a-post.mdx");
	});
});

describe("getContent — no draft at that path", () => {
	test("T-20: a GithubNotFoundError is refused, naming the kind and slug", async () => {
		const { github, calls } = githubThrowingOnRead(
			new GithubNotFoundError("workshop", "drafts/project/a-thing.mdx"),
		);

		const result = await getContent(
			{ github, site: noSiteAccess },
			{ kind: "project", slug: "a-thing", state: "draft" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("project");
		expect(result.error).toContain("a-thing");
		// CLAUDE.md → "A 404 might mean the token scope is wrong": the message
		// must not frame this as GitHub being unreachable (that is a different
		// failure) or repeat the raw ".mdx" path from the thrown error's own
		// message — either would mean the 404 fell through to the generic
		// catch-all instead of being told apart.
		expect(result.error).not.toContain("unreachable");
		expect(result.error).not.toContain(".mdx");

		expect(calls).toHaveLength(1);
	});
});

describe("getContent — a draft whose metadata block will not parse", () => {
	test("T-21: refuses with the specified message, naming the file, and never leaks the parse error", async () => {
		// A broken block: no line that is exactly "}", so readDraft returns null.
		const brokenText = 'export const metadata = { title: "Oops"\n\nBody text.';
		const { github, calls } = githubReturning(brokenText, "abc");

		const result = await getContent(
			{ github, site: noSiteAccess },
			{ kind: "writing", slug: "a-post", state: "draft" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");

		// The specified refusal, verbatim (design.md → the reader → the refusal
		// when a block will not parse).
		expect(result.error).toBe(
			"The metadata block in drafts/writing/a-post.mdx is not in a shape " +
				"this server can read. Fix it in GitHub and save the draft again.",
		);

		// Never leaks the underlying JSON.parse error: no character offset, no
		// raw parser message (ADR-004 → a character offset is useless on a
		// phone).
		expect(result.error).not.toMatch(/position \d+/i);
		expect(result.error).not.toContain("JSON.parse");
		expect(result.error).not.toContain("Unexpected");

		expect(calls).toHaveLength(1);
	});

	test("T-21: no partial result and no empty-metadata body leak through on the refusal", async () => {
		const brokenText = 'export const metadata = { title: "Oops"\n\nBody text.';
		const { github } = githubReturning(brokenText, "abc");

		const result = await getContent(
			{ github, site: noSiteAccess },
			{ kind: "writing", slug: "a-post", state: "draft" },
		);

		expect(result.ok).toBe(false);
		// A result that is `ok: false` has no `metadata`, `body` or `sha` fields
		// to accidentally read — this is the type-level guarantee that nothing
		// partial is returned.
		expect((result as { metadata?: unknown }).metadata).toBeUndefined();
		expect((result as { body?: unknown }).body).toBeUndefined();
	});
});

describe("getContent — the slug is a trust boundary", () => {
	// Slice 2 review found this guard missing: getContent built the path with
	// no isSlug check, so a traversal slug becomes a path segment that fetch
	// interpolates straight into the GitHub API URL. A trailing "?" pushes the
	// ".mdx" suffix into the query string, so the escape isn't even limited to
	// .mdx files (design.md → get_content test cases → T-33).
	test("T-33: a slug that is not a slug is refused before any read is attempted", async () => {
		const { github, calls } = githubReturning("irrelevant", "abc");

		const result = await getContent(
			{ github, site: noSiteAccess },
			{
				kind: "writing",
				slug: "../../../../Portfolio-new/contents/package.json?",
				state: "draft",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		// Names the slug problem, not a "not found" — this must read as a
		// refusal to even try, never as GitHub having answered 404.
		expect(result.error).toContain("slug");
		expect(result.error).not.toContain("could not be read");
		expect(result.error).not.toContain("token cannot see");

		// The guard runs before any network call — no request is attempted at
		// all, escaped or otherwise.
		expect(calls).toHaveLength(0);
	});

	test("T-33: a slug that climbs out of the drafts directory is refused before any read is attempted", async () => {
		const { github, calls } = githubReturning("irrelevant", "abc");

		const result = await getContent(
			{ github, site: noSiteAccess },
			{ kind: "project", slug: "../../../etc/passwd", state: "draft" },
		);

		expect(result.ok).toBe(false);
		expect(calls).toHaveLength(0);
	});
});

describe("getContent — reading published content", () => {
	test("T-20: a published writing reads back with metadata and body, and no sha", async () => {
		const metadata = { title: "A Post", date: "2026-01-01" };
		const body = "Published body text.";
		const { site, calls } = siteReturning(metadata, body);

		const result = await getContent(
			{ github: noGithubAccess, site },
			{ kind: "writing", slug: "a-post", state: "published" },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.metadata).toEqual(metadata);
		expect(result.body).toBe(body);
		// No sha to overwrite — there is no draft (design.md → get_content gains
		// `state`).
		expect((result as { sha?: unknown }).sha).toBeUndefined();
		expect("sha" in result).toBe(false);

		expect(calls).toEqual([{ kind: "writing", slug: "a-post" }]);
	});

	test("T-21: a draft read is unchanged — still returns metadata, body and sha", async () => {
		const metadata = { title: "A Draft Post" };
		const body = "Draft body text.";
		const text = renderDraft(metadata, body);
		const { github, calls } = githubReturning(text, "def");

		const result = await getContent(
			{ github, site: noSiteAccess },
			{ kind: "writing", slug: "a-post", state: "draft" },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.metadata).toEqual(metadata);
		expect(result.body).toBe(body);
		expect(result.sha).toBe("def");
		expect(calls).toHaveLength(1);
	});

	test("T-22: a traversal slug is refused before the site is ever called, even for a published read", async () => {
		// The site fake throws on any call — an early call would fail this test
		// loudly rather than silently passing.
		const { site, calls } = siteThrowingOnFetchDocument(
			new Error("fetchDocument should not have been called"),
		);

		const result = await getContent(
			{ github: noGithubAccess, site },
			{
				kind: "writing",
				slug: "../../../../Portfolio-new/contents/package.json?",
				state: "published",
			},
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("slug");

		expect(calls).toHaveLength(0);
	});

	test("T-23: an unknown published slug refuses, naming the kind and slug", async () => {
		const { site, calls } = siteThrowingOnFetchDocument(
			new SiteNotFoundError("project", "no-such-project"),
		);

		const result = await getContent(
			{ github: noGithubAccess, site },
			{ kind: "project", slug: "no-such-project", state: "published" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("project");
		expect(result.error).toContain("no-such-project");

		expect(calls).toEqual([{ kind: "project", slug: "no-such-project" }]);
	});

	test("T-24: an unreachable site refuses, naming ashutoshverma.dev", async () => {
		const { site, calls } = siteThrowingOnFetchDocument(
			new Error("fetch failed"),
		);

		const result = await getContent(
			{ github: noGithubAccess, site },
			{ kind: "writing", slug: "a-post", state: "published" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("ashutoshverma.dev");

		expect(calls).toHaveLength(1);
	});

	test("T-23 vs T-24: a wrong slug and a dead host produce different messages", async () => {
		const notFound = siteThrowingOnFetchDocument(
			new SiteNotFoundError("writing", "no-such-post"),
		);
		const unreachable = siteThrowingOnFetchDocument(new Error("fetch failed"));

		const notFoundResult = await getContent(
			{ github: noGithubAccess, site: notFound.site },
			{ kind: "writing", slug: "no-such-post", state: "published" },
		);
		const unreachableResult = await getContent(
			{ github: noGithubAccess, site: unreachable.site },
			{ kind: "writing", slug: "no-such-post", state: "published" },
		);

		expect(notFoundResult.ok).toBe(false);
		expect(unreachableResult.ok).toBe(false);
		if (notFoundResult.ok || unreachableResult.ok) {
			throw new Error("expected both to be error results");
		}
		expect(notFoundResult.error).not.toBe(unreachableResult.error);
	});

	test("T-25: GitHub is never called for a published read", async () => {
		// github is `noGithubAccess` — every method throws. Reaching any of them
		// fails this test loudly instead of the call silently succeeding.
		const metadata = { title: "A Post" };
		const body = "Published body text.";
		const { site } = siteReturning(metadata, body);

		const result = await getContent(
			{ github: noGithubAccess, site },
			{ kind: "writing", slug: "a-post", state: "published" },
		);

		expect(result.ok).toBe(true);
	});

	// T-55 — added by review (not in design.md's original list). The reviewer
	// found `fetchDocument`'s `documentSchema.parse` failure falling to the
	// generic branch in `describePublishedReadFailure`, which dumped the raw
	// ZodError into the message AND claimed the site was "unreachable" — false,
	// the site answered, just in an unrecognised shape (specs/005-publish/
	// CLAUDE.md → Don't: never surface a raw JSON.parse/ZodError message).
	test("T-55: a shape error from the site is refused without the raw Zod dump or an 'unreachable' claim", async () => {
		const { site, calls } = siteThrowingOnFetchDocument(
			new SiteShapeError("writing", "a-post"),
		);

		const result = await getContent(
			{ github: noGithubAccess, site },
			{ kind: "writing", slug: "a-post", state: "published" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");

		// No raw Zod dump — a ZodError's message is a multi-line list of
		// issues, each naming "invalid_type" and "expected" internals a phone
		// reader cannot act on.
		expect(result.error).not.toContain("invalid_type");
		expect(result.error).not.toContain("expected");

		// The site answered — it is not unreachable. Sending the reader to
		// check DNS when the API route changed shape is the wrong direction.
		expect(result.error.toLowerCase()).not.toContain("unreachable");

		// Names the route or the shape, so a human knows where to look.
		expect(result.error).toContain("writing");
		expect(result.error).toContain("a-post");

		expect(calls).toHaveLength(1);
	});
});
