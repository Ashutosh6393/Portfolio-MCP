import { describe, expect, test } from "bun:test";
import { type Github, GithubNotFoundError } from "../lib/github";
import { listDrafts } from "./list-drafts";

// T-22, T-23, T-23b — see specs/004-drafts/design.md → Test cases → list_content.
//
// The seam is `deps.github`, a plain object literal. No mocking framework, no
// `mock.module()`, no `as any`.
//
// listDrafts only ever lists — listDirectory is the one method exercised.
// Every fake wires the rest to throw loudly so an accidental call fails the
// test instead of passing silently.
const noOtherPath = {
	async readFile(): Promise<never> {
		throw new Error("readFile is not part of list_content(draft)");
	},
	async readFileWithSha(): Promise<never> {
		throw new Error("readFileWithSha is not part of list_content(draft)");
	},
	async writeFile(): Promise<never> {
		throw new Error("writeFile is not part of list_content(draft)");
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of list_content(draft)");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 11 widens `Github` with these
	// three, so every fake must carry them to typecheck. listDrafts never
	// touches the publish path, so these throw rather than return a plausible
	// value: an accidental call fails loudly instead of passing silently.
	async getBranchHead(): Promise<never> {
		throw new Error("getBranchHead is not part of list_content(draft)");
	},
	async createBranch(): Promise<never> {
		throw new Error("createBranch is not part of list_content(draft)");
	},
	async createPullRequest(): Promise<never> {
		throw new Error("createPullRequest is not part of list_content(draft)");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 15 adds `findPullRequest` to
	// `Github`, so every fake must carry it to typecheck. listDrafts never
	// touches the publish path, so this throws rather than returning `null` —
	// `null` is a meaningful answer here ("no PR exists for this branch"), and
	// a stub that returned it could let an idempotency test pass without
	// listDrafts ever having called it.
	async findPullRequest(): Promise<never> {
		throw new Error("findPullRequest is not part of list_content(draft)");
	},
};

type ListCall = { repo: string; path: string };

// A github whose listDirectory answers with the given raw entries and records
// every call.
function githubListing(entries: unknown): {
	github: Github;
	calls: ListCall[];
} {
	const calls: ListCall[] = [];
	const github: Github = {
		...noOtherPath,
		async listDirectory(repo, path) {
			calls.push({ repo, path });
			return entries;
		},
	};
	return { github, calls };
}

// A github whose listDirectory throws the given error.
function githubThrowingOnList(error: Error): {
	github: Github;
	calls: ListCall[];
} {
	const calls: ListCall[] = [];
	const github: Github = {
		...noOtherPath,
		async listDirectory(repo, path) {
			calls.push({ repo, path });
			throw error;
		},
	};
	return { github, calls };
}

describe("listDrafts — listing the drafts of a kind", () => {
	test("T-22: returns slugs for .mdx files only, stripping the extension and dropping non-mdx entries and directories", async () => {
		const { github, calls } = githubListing([
			{ name: "a.mdx", type: "file" },
			{ name: "b.mdx", type: "file" },
			{ name: ".DS_Store", type: "file" },
			{ name: "nested.mdx", type: "dir" },
		]);

		const result = await listDrafts({ github }, { kind: "writing" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.slugs).toEqual(["a", "b"]);

		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error("expected a listDirectory call");
		expect(call.repo).toBe("workshop");
		expect(call.path).toBe("drafts/writing");
	});
});

describe("listDrafts — the directory does not exist yet", () => {
	test("T-23: a GithubNotFoundError on drafts/project is an empty list, not an error", async () => {
		const { github, calls } = githubThrowingOnList(
			new GithubNotFoundError("workshop", "drafts/project"),
		);

		const result = await listDrafts({ github }, { kind: "project" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.slugs).toEqual([]);

		expect(calls).toHaveLength(1);
		const call = calls[0];
		if (!call) throw new Error("expected a listDirectory call");
		expect(call.path).toBe("drafts/project");
	});
});

describe("listDrafts — GitHub is unreachable", () => {
	test("T-23b: a plain Error is returned as a failure naming GitHub, nothing thrown", async () => {
		const { github } = githubThrowingOnList(new Error("network down"));

		const result = await listDrafts({ github }, { kind: "writing" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("GitHub");
	});
});
