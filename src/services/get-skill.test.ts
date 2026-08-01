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

// Test revision, 2026-08-02 — see Test revisions table in
// specs/004-drafts/implementation.md. Spec 004 Task 2 widens `Github` with
// readFileWithSha, writeFile and deleteFile, so every fake must carry them to
// typecheck. getSkill only reads, so these throw rather than return a plausible
// value: an accidental call fails loudly instead of passing silently.
const noWritePath = {
	async readFileWithSha(): Promise<never> {
		throw new Error("readFileWithSha is not part of this test");
	},
	async writeFile(): Promise<never> {
		throw new Error("writeFile is not part of this test");
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of this test");
	},
};

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
		...noWritePath,
	};
}

// The named path needs file bodies as well as listings, and T-10d needs to know
// how many times each path was read. `reads` records every readFile call in
// order, so a test can assert on the count without a mocking framework.
function githubServing(files: Record<string, string>) {
	const reads: string[] = [];
	const listingFor = (dir: string) =>
		Object.keys(files)
			.filter((path) => path.startsWith(`${dir}/`))
			.map((path) => ({ name: path.slice(dir.length + 1), type: "file" }));

	const github: Github = {
		async listDirectory(_repo, path) {
			if (path !== "skills" && path !== "templates") {
				throw new GithubNotFoundError("workshop", path);
			}
			return listingFor(path);
		},
		async readFile(_repo, path) {
			reads.push(path);
			const body = files[path];
			if (body === undefined) {
				throw new GithubNotFoundError("workshop", path);
			}
			return body;
		},
		...noWritePath,
	};

	return { github, reads };
}

const voiceBody = "Write like a person. Short sentences.";

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
			...noWritePath,
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

// T-10, T-10b, T-10c, T-10d, T-11, T-12 — the named mode.
//
// design.md → Approach → `get_skill`: the voice comes back with every named
// answer. A model handed structure and no voice writes something correctly
// shaped that sounds like nobody, and unlike a missing file nobody notices.
//
// Result shapes for a name — source of truth for Task 6:
//
//   { ok: true; voice: string; instructions: string }   a skill
//   { ok: true; voice: string; template: string }       a template
//   { ok: true; voice: string }                         be-human itself
//   { ok: false; error: string }

describe("getSkill — fetching one named thing", () => {
	test("T-10: a named skill comes back with its rules and the voice, not swapped", async () => {
		const rules = "Open with the problem. No hashtags.";
		const { github } = githubServing({
			"skills/be-human.md": voiceBody,
			"skills/linkedin-post.md": rules,
			"templates/writing.md": "# {title}",
		});

		const result = await getSkill({ github }, { name: "linkedin-post" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		if (!("instructions" in result)) {
			throw new Error("expected a skill result carrying instructions");
		}

		expect(result.instructions).toBe(rules);
		expect(result.voice).toBe(voiceBody);
		expect(result).not.toHaveProperty("template");
	});

	test("T-10b: a named template comes back with the template and the voice", async () => {
		const template = "# {title}\n\n{body}";
		const { github } = githubServing({
			"skills/be-human.md": voiceBody,
			"templates/writing.md": template,
		});

		const result = await getSkill({ github }, { name: "writing" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		if (!("template" in result)) {
			throw new Error("expected a template result");
		}

		expect(result.template).toBe(template);
		expect(result.voice).toBe(voiceBody);
		expect(result).not.toHaveProperty("instructions");
	});

	test("T-10c: the extension is never guessed — .md and .mdx both resolve", async () => {
		const template = "# {title}";
		const { github } = githubServing({
			"skills/be-human.md": voiceBody,
			// ADR-003 assumed .mdx; the files were pushed as .md. Neither is
			// written into the code, and this test is what holds that true.
			"templates/project.mdx": template,
		});

		const result = await getSkill({ github }, { name: "project" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		if (!("template" in result)) throw new Error("expected a template result");
		expect(result.template).toBe(template);
	});

	test("T-10d: asking for the voice returns it once and reads it once", async () => {
		const { github, reads } = githubServing({
			"skills/be-human.md": voiceBody,
			"skills/linkedin-post.md": "rules",
		});

		const result = await getSkill({ github }, { name: "be-human" });

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		if (!("voice" in result)) throw new Error("expected a voice result");
		expect(result.voice).toBe(voiceBody);
		expect(result).not.toHaveProperty("instructions");
		expect(result).not.toHaveProperty("template");

		expect(reads.filter((path) => path.includes("be-human"))).toHaveLength(1);
	});

	test("T-11: an unknown name names what does exist, in the same turn", async () => {
		const { github } = githubServing({
			"skills/be-human.md": voiceBody,
			"skills/linkedin-post.md": "rules",
			"templates/writing.md": "# {title}",
		});

		const result = await getSkill({ github }, { name: "lnkedin-post" });

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");

		expect(result.error).toContain("lnkedin-post");
		expect(result.error).toContain("linkedin-post");
		expect(result.error).toContain("writing");
	});

	test("T-12: a missing voice is an error, never structure on its own", async () => {
		const template = "# {title}";
		const { github } = githubServing({
			// no skills/be-human.md
			"templates/writing.md": template,
		});

		let thrown: unknown;
		let result: Awaited<ReturnType<typeof getSkill>> | undefined;
		try {
			result = await getSkill({ github }, { name: "writing" });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeUndefined();
		expect(result).toBeDefined();
		if (!result || result.ok) throw new Error("expected an error result");

		expect(result.error).toContain("be-human");
		// The whole point: the template must not come back without the voice.
		expect(result.error).not.toContain(template);
	});
});
