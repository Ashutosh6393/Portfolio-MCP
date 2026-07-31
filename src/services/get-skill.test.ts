import { describe, expect, test } from "bun:test";
import { type Github, GithubNotFoundError } from "../lib/github";
import { getSkill } from "./get-skill";

// T-07, T-08, T-09, T-14 — see specs/002-github-access/design.md → Test cases.
//
// The seam is `deps.github`: every fake below is a plain object literal
// satisfying `Github` from lib/github.ts. No mocking framework, no `as any`.
// `listDirectory` returns `unknown` on purpose, which is what lets a fake hand
// the service garbage (T-14) without a cast and still exercise the real schema.
//
// design.md → Approach → Errors: tool failures are returned, never thrown. That
// applies at this layer too — getSkill never throws and never rejects.
//
// Result shape for the no-name case — source of truth for Task 6:
//
//   { ok: true; skills: string[]; templates: string[] } | { ok: false; error: string }
//
// Names come back with the extension stripped, because the extension is a fact
// about the file and not about the skill.

type Listings = Record<string, unknown>;

// A fake whose listings are keyed by the path asked for. An unlisted path 404s,
// exactly as the real reader does — GithubNotFoundError is thrown by lib, not
// invented here.
function githubWith(listings: Listings): Github {
	return {
		async listDirectory(_repo, path) {
			if (!(path in listings)) {
				throw new GithubNotFoundError("workshop", path);
			}
			return listings[path];
		},
		async readFile() {
			throw new Error("readFile is not part of the no-name path");
		},
	};
}

const file = (name: string) => ({ name, type: "file" });
const dir = (name: string) => ({ name, type: "dir" });

describe("getSkill — listing what is available", () => {
	test("T-07: returns skills and templates as separate lists, extensions stripped", async () => {
		const github = githubWith({
			skills: [file("be-human.md"), file("linkedin-post.md")],
			templates: [file("writing.mdx")],
		});

		const result = await getSkill({ github }, {});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		if (!("skills" in result)) throw new Error("expected a listing result");

		expect(result.skills).toEqual(["be-human", "linkedin-post"]);
		expect(result.templates).toEqual(["writing"]);
	});

	test("T-08: skips directories and non-markdown files", async () => {
		const github = githubWith({
			skills: [file("linkedin-post.md"), file(".DS_Store"), dir("archive")],
			templates: [],
		});

		const result = await getSkill({ github }, {});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		if (!("skills" in result)) throw new Error("expected a listing result");

		expect(result.skills).toEqual(["linkedin-post"]);
		expect(result.skills).not.toContain(".DS_Store");
		expect(result.skills).not.toContain("archive");
	});

	test("T-09: nothing there yet is a valid answer, not an error", async () => {
		const github = githubWith({ skills: [], templates: [] });

		const result = await getSkill({ github }, {});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		if (!("skills" in result)) throw new Error("expected a listing result");

		expect(result.skills).toEqual([]);
		expect(result.templates).toEqual([]);
	});

	test("T-14: a listing in an unexpected shape is an error result, no undefined leaking in", async () => {
		const github = githubWith({
			skills: [{ nope: 1 }],
			templates: [],
		});

		let thrown: unknown;
		let result: Awaited<ReturnType<typeof getSkill>> | undefined;
		try {
			result = await getSkill({ github }, {});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeUndefined();
		expect(result).toBeDefined();
		if (!result || result.ok) throw new Error("expected an error result");
		expect(result.error).not.toContain("undefined");
		expect(result.error.length).toBeGreaterThan(0);
	});

	test("T-13: a GitHub failure is an error result naming GitHub, never thrown", async () => {
		const failingGithub: Github = {
			async listDirectory() {
				throw new Error("GitHub returned 500 reading the workshop repo.");
			},
			async readFile() {
				throw new Error("GitHub returned 500 reading the workshop repo.");
			},
		};

		let thrown: unknown;
		let result: Awaited<ReturnType<typeof getSkill>> | undefined;
		try {
			result = await getSkill({ github: failingGithub }, {});
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeUndefined();
		expect(result).toBeDefined();
		if (!result || result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("GitHub");
	});
});
