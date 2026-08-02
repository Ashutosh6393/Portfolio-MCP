import { describe, expect, test } from "bun:test";
import { renderDraft } from "../lib/draft";
import { type Github, GithubNotFoundError } from "../lib/github";
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
			{ github },
			{ kind: "writing", slug: "a-post" },
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
			{ github },
			{ kind: "project", slug: "a-thing" },
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
			{ github },
			{ kind: "writing", slug: "a-post" },
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
			{ github },
			{ kind: "writing", slug: "a-post" },
		);

		expect(result.ok).toBe(false);
		// A result that is `ok: false` has no `metadata`, `body` or `sha` fields
		// to accidentally read — this is the type-level guarantee that nothing
		// partial is returned.
		expect((result as { metadata?: unknown }).metadata).toBeUndefined();
		expect((result as { body?: unknown }).body).toBeUndefined();
	});
});
