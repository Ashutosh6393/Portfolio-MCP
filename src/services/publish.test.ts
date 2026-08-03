import { describe, expect, test } from "bun:test";
import { renderDraft } from "../lib/draft";
import {
	type Github,
	GithubAlreadyExistsError,
	GithubForbiddenError,
	GithubNotFoundError,
} from "../lib/github";
import type { Project, SchemaEnvelope, Site, Writing } from "../lib/site";
import { publish } from "./publish";

// T-28 … T-38, T-41, T-43 — see specs/005-publish/design.md → Test cases →
// Slice 3.
//
// Signature under test, decided here because design.md leaves the exact
// success shape to the implementer:
//
//   publish(
//     deps: { github: Github; site: Site },
//     args: { kind: "writing" | "project"; slug: string; show?: boolean; order?: number },
//   ): Promise<
//     | { ok: true; url: string; number: number }
//     | { ok: false; error: string }
//   >
//
// `url` is the PR's `html_url` (the thing a human clicks), `number` is the PR
// number — both come straight back from `github.createPullRequest`, the same
// convention `createPullRequest`'s own return type already uses.
//
// The seam is `deps.site` and `deps.github`, both plain object literals. No
// mocking framework, no `mock.module()`, no `as any`.

// The real live schema shapes, mirrored verbatim from src/lib/validate.test.ts
// (design.md → Live facts: `$schema` and `stack.items.minLength` are both load
// -bearing — a hand-written approximation missing either previously shipped a
// validator that refused every real document).
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

// `additionalProperties: false` and no `show`/`order` key — exactly why T-31
// exists. Attach `show`/`order` before this runs and the publish would refuse
// on `show` (and `order`) as unrecognised keys.
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

const liveSchema: SchemaEnvelope = {
	writing: liveWritingSchema,
	project: liveProjectSchema,
};

// Draft metadata as it actually arrives from `workshop`: never a `readingTime`
// (save_draft strips it) and never `show`/`order` for a writing.
function validWritingDraftMetadata(): Record<string, unknown> {
	return {
		title: "What CRDTs taught me",
		date: "2026-08-03",
		summary: "A short summary.",
	};
}

function validProjectDraftMetadata(): Record<string, unknown> {
	return {
		title: "Scaffold AI",
		summary: "A project that scaffolds things.",
		stack: ["TypeScript"],
		status: "wip",
		repo: "https://github.com/example/scaffold-ai",
	};
}

// A body short enough to always read back "1 min" (well under 200 words), so
// tests that don't care about the exact reading time don't have to compute one.
const shortBody = "Hello world. This is the body of the post.";

function draftFile(
	metadata: Record<string, unknown>,
	body: string,
): { content: string; sha: string } {
	return { content: renderDraft(metadata, body), sha: "draft-sha" };
}

type Calls = {
	writeFile: Array<{
		repo: string;
		path: string;
		content: string;
		options: { message: string; sha?: string; branch?: string };
	}>;
	createBranch: Array<{ repo: string; branch: string; fromSha: string }>;
	createPullRequest: Array<{
		repo: string;
		options: { title: string; body: string; head: string; base: string };
	}>;
	getBranchHead: Array<{ repo: string; branch: string }>;
	findPullRequest: Array<{ repo: string; branch: string }>;
};

function emptyCalls(): Calls {
	return {
		writeFile: [],
		createBranch: [],
		createPullRequest: [],
		getBranchHead: [],
		findPullRequest: [],
	};
}

// One configurable Github fake for every scenario below. Each configurable
// piece defaults to "well-behaved create path"; passing an `Error` for any of
// them makes that step throw instead. `writeFile`/`createBranch`/
// `createPullRequest` are always recorded, win or throw, so a test can prove
// zero writes happened on a refusal (T-43).
function githubFake(options: {
	draft?: { content: string; sha: string } | Error;
	branchHeadSha?: string | Error;
	createBranchThrows?: Error;
	createPullRequestResult?: { number: number; url: string };
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. `publish` now calls
	// `findPullRequest` on every run (Task 16), so a stub that throws
	// unconditionally would fail every slice-3 test before it reaches what it
	// asserts. `null` — no pull request has ever existed for this branch — is
	// the truthful default for these fixtures, which all describe a slug that
	// has never been published. Configurable so a scenario can supply one.
	findPullRequestResult?:
		| { number: number; url: string; state: string; merged: boolean }
		| null
		| Error;
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. `publish` also calls
	// `readFileWithSha("portfolio", destination, branch)` to decide create vs.
	// update (Task 16). Left unconfigured, `undefined` is the truthful
	// default for every fixture below: all of them describe a slug that has
	// never been published, so the destination path does not exist on the
	// branch yet. Configurable so a scenario can supply the file-already-
	// present case instead.
	fileOnBranch?: { content: string; sha: string };
}): { github: Github; calls: Calls } {
	const calls = emptyCalls();
	const github: Github = {
		async listDirectory(): Promise<never> {
			throw new Error("listDirectory is not part of publish");
		},
		async readFile(): Promise<never> {
			throw new Error("readFile is not part of publish");
		},
		async readFileWithSha(repo, path) {
			if (repo === "workshop") {
				if (options.draft instanceof Error) throw options.draft;
				if (!options.draft) {
					throw new Error("no draft configured for this fake");
				}
				return options.draft;
			}
			// repo === "portfolio": the create-vs-update read. No file on the
			// branch yet, for every fixture here, unless a scenario opts in.
			if (!options.fileOnBranch) throw new GithubNotFoundError(repo, path);
			return options.fileOnBranch;
		},
		async writeFile(repo, path, content, writeOptions) {
			calls.writeFile.push({ repo, path, content, options: writeOptions });
		},
		async deleteFile(): Promise<never> {
			throw new Error("deleteFile is not part of publish");
		},
		async getBranchHead(repo, branch) {
			calls.getBranchHead.push({ repo, branch });
			if (options.branchHeadSha instanceof Error) throw options.branchHeadSha;
			return options.branchHeadSha ?? "main-head-sha";
		},
		async createBranch(repo, branch, fromSha) {
			calls.createBranch.push({ repo, branch, fromSha });
			if (options.createBranchThrows) throw options.createBranchThrows;
		},
		async createPullRequest(repo, prOptions) {
			calls.createPullRequest.push({ repo, options: prOptions });
			return (
				options.createPullRequestResult ?? {
					number: 7,
					url: "https://github.com/example/portfolio/pull/7",
				}
			);
		},
		async findPullRequest(repo, branch) {
			calls.findPullRequest.push({ repo, branch });
			if (options.findPullRequestResult instanceof Error) {
				throw options.findPullRequestResult;
			}
			return options.findPullRequestResult ?? null;
		},
	};
	return { github, calls };
}

// A Github fake where every method throws loudly on touch, for T-38: proving
// the slug guard runs before any of them are called.
function githubThatMustNotBeTouched(): Github {
	const boom = () => {
		throw new Error("github must not be touched before the slug guard");
	};
	return {
		listDirectory: boom,
		readFile: boom,
		readFileWithSha: boom,
		writeFile: boom,
		deleteFile: boom,
		getBranchHead: boom,
		createBranch: boom,
		createPullRequest: boom,
	} as unknown as Github;
}

function siteFake(options: {
	schema?: SchemaEnvelope | Error;
	content?: (Writing | Project)[] | Error;
}): Site {
	return {
		async fetchContent() {
			if (options.content instanceof Error) throw options.content;
			return options.content ?? [];
		},
		async fetchSchema() {
			if (options.schema instanceof Error) throw options.schema;
			return options.schema ?? liveSchema;
		},
		async fetchDocument(): Promise<never> {
			throw new Error("fetchDocument is not part of publish");
		},
	};
}

// A Site fake where every method throws loudly on touch, for T-38.
function siteThatMustNotBeTouched(): Site {
	const boom = () => {
		throw new Error("site must not be touched before the slug guard");
	};
	return {
		fetchContent: boom,
		fetchSchema: boom,
		fetchDocument: boom,
	} as unknown as Site;
}

describe("publish — a writing", () => {
	test("T-28: a writing publishes — branch cut from main, file at content/writing/{slug}.mdx, PR opened, URL returned", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts", show: undefined, order: undefined },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.url).toBe("https://github.com/example/portfolio/pull/7");
		expect(result.number).toBe(7);

		expect(calls.getBranchHead).toEqual([
			{ repo: "portfolio", branch: "main" },
		]);
		expect(calls.createBranch).toHaveLength(1);
		expect(calls.createBranch[0]).toEqual({
			repo: "portfolio",
			branch: "publish/writing/crdts",
			fromSha: "main-head-sha",
		});

		expect(calls.writeFile).toHaveLength(1);
		const write = calls.writeFile[0];
		if (!write) throw new Error("expected a write call");
		expect(write.repo).toBe("portfolio");
		expect(write.path).toBe("content/writing/crdts.mdx");
		expect(write.options.branch).toBe("publish/writing/crdts");

		expect(calls.createPullRequest).toHaveLength(1);
	});

	test("T-30: readingTime is computed and injected — a draft with none carries {n} min in the written file", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(true);
		const write = calls.writeFile[0];
		if (!write) throw new Error("expected a write call");
		// shortBody is far under 200 words, so this rounds up to the floor of
		// one minute — see lib/reading-time.ts.
		expect(write.content).toContain('"readingTime": "1 min"');
	});

	test("T-32: a writing refuses show/order — refused, nothing written", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts", show: true, order: 1 },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(calls.writeFile).toHaveLength(0);
		expect(calls.createBranch).toHaveLength(0);
		expect(calls.createPullRequest).toHaveLength(0);
	});
});

describe("publish — a project", () => {
	test("T-29: a project publishes to content/projects/ — plural", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validProjectDraftMetadata(), shortBody),
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "project", slug: "scaffold-ai", show: true, order: 1 },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");

		expect(calls.createBranch).toHaveLength(1);
		// The branch is singular — the domain word, not the directory.
		expect(calls.createBranch[0]?.branch).toBe("publish/project/scaffold-ai");

		expect(calls.writeFile).toHaveLength(1);
		const write = calls.writeFile[0];
		if (!write) throw new Error("expected a write call");
		expect(write.path).toBe("content/projects/scaffold-ai.mdx");
	});

	test("T-31: show/order are attached after validation — the file carries both, and validation saw neither", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validProjectDraftMetadata(), shortBody),
		});
		// liveProjectSchema is additionalProperties: false and has no `show` or
		// `order` key. If the service attached them before calling validate,
		// this schema would refuse the publish outright — so an `ok: true`
		// result here is itself proof validation ran against metadata that did
		// not yet carry them.
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "project", slug: "scaffold-ai", show: true, order: 2 },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");

		const write = calls.writeFile[0];
		if (!write) throw new Error("expected a write call");
		expect(write.content).toContain('"show": true');
		expect(write.content).toContain('"order": 2');
	});
});

describe("publish — refusals before any write", () => {
	test("T-33: invalid metadata refuses before any write — no summary, naming summary, no GitHub write of any kind", async () => {
		const metadata = validWritingDraftMetadata();
		delete metadata.summary;
		const { github, calls } = githubFake({
			draft: draftFile(metadata, shortBody),
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("summary");

		expect(calls.writeFile).toHaveLength(0);
		expect(calls.createBranch).toHaveLength(0);
		expect(calls.createPullRequest).toHaveLength(0);
	});

	test("T-34: an already-published slug refuses — refusal, no branch created", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		const publishedWriting: Writing = {
			slug: "crdts",
			title: "What CRDTs taught me",
			date: "2026-01-01",
			readingTime: "3 min",
			summary: "Already live.",
		};
		const site = siteFake({ content: [publishedWriting] });

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("crdts");
		expect(calls.createBranch).toHaveLength(0);
	});

	test("T-35: a missing draft refuses, naming kind and slug", async () => {
		const { github, calls } = githubFake({
			draft: new GithubNotFoundError("workshop", "drafts/writing/crdts.mdx"),
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("writing");
		expect(result.error).toContain("crdts");
		expect(calls.writeFile).toHaveLength(0);
	});

	test("T-36: an unparseable draft refuses, nothing written", async () => {
		const { github, calls } = githubFake({
			draft: { content: "not a metadata block at all", sha: "draft-sha" },
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		expect(calls.writeFile).toHaveLength(0);
		expect(calls.createBranch).toHaveLength(0);
		expect(calls.createPullRequest).toHaveLength(0);
	});

	test("T-37: an unreachable schema refuses, saying it cannot validate, nothing written", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		const site = siteFake({
			schema: new Error("ashutoshverma.dev did not respond"),
		});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error.toLowerCase()).toContain("validat");

		expect(calls.writeFile).toHaveLength(0);
		expect(calls.createBranch).toHaveLength(0);
		expect(calls.createPullRequest).toHaveLength(0);
	});

	test("T-38: the slug guard runs first — refused before the site, the schema or GitHub is touched", async () => {
		const github = githubThatMustNotBeTouched();
		const site = siteThatMustNotBeTouched();

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "../../../etc/passwd" },
		);

		expect(result.ok).toBe(false);
	});
});

// T-41 superseded, 2026-08-03 — see Test revisions table in
// specs/005-publish/implementation.md and design.md → Test cases → Slice 3.
// The scenario this used to cover ("an existing branch") now lives below, in
// "publish — a leftover branch with no pull request (T-41, superseded by
// T-44)", pinned to what slice 4 actually guarantees instead of what slice 3
// used to.

describe("publish — nothing is ever written to portfolio on a refusal (T-43)", () => {
	const scenarios: Array<{
		name: string;
		args: {
			kind: "writing" | "project";
			slug: string;
			show?: boolean;
			order?: number;
		};
		github: () => { github: Github; calls: Calls };
		site: () => Site;
	}> = [
		{
			name: "invalid metadata (missing summary)",
			args: { kind: "writing", slug: "crdts" },
			github: () => {
				const metadata = validWritingDraftMetadata();
				delete metadata.summary;
				return githubFake({ draft: draftFile(metadata, shortBody) });
			},
			site: () => siteFake({}),
		},
		{
			name: "already-published slug",
			args: { kind: "writing", slug: "crdts" },
			github: () =>
				githubFake({
					draft: draftFile(validWritingDraftMetadata(), shortBody),
				}),
			site: () =>
				siteFake({
					content: [
						{
							slug: "crdts",
							title: "What CRDTs taught me",
							date: "2026-01-01",
							readingTime: "3 min",
							summary: "Already live.",
						},
					],
				}),
		},
		{
			name: "missing draft",
			args: { kind: "writing", slug: "crdts" },
			github: () =>
				githubFake({
					draft: new GithubNotFoundError(
						"workshop",
						"drafts/writing/crdts.mdx",
					),
				}),
			site: () => siteFake({}),
		},
		{
			name: "unparseable draft",
			args: { kind: "writing", slug: "crdts" },
			github: () =>
				githubFake({
					draft: { content: "not a metadata block at all", sha: "draft-sha" },
				}),
			site: () => siteFake({}),
		},
		{
			name: "unreachable schema",
			args: { kind: "writing", slug: "crdts" },
			github: () =>
				githubFake({
					draft: draftFile(validWritingDraftMetadata(), shortBody),
				}),
			site: () =>
				siteFake({ schema: new Error("ashutoshverma.dev did not respond") }),
		},
		{
			name: "writing carrying show/order",
			args: { kind: "writing", slug: "crdts", show: true, order: 1 },
			github: () =>
				githubFake({
					draft: draftFile(validWritingDraftMetadata(), shortBody),
				}),
			site: () => siteFake({}),
		},
	];

	for (const scenario of scenarios) {
		test(`refuses "${scenario.name}" with zero writes to portfolio`, async () => {
			const { github, calls } = scenario.github();
			const site = scenario.site();

			const result = await publish({ github, site }, scenario.args);

			expect(result.ok).toBe(false);
			expect(calls.writeFile).toHaveLength(0);
			expect(calls.createBranch).toHaveLength(0);
			expect(calls.createPullRequest).toHaveLength(0);
		});
	}

	test("the slug-guard refusal never touches github or site at all", async () => {
		const github = githubThatMustNotBeTouched();
		const site = siteThatMustNotBeTouched();

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "../../../etc/passwd" },
		);

		expect(result.ok).toBe(false);
	});
});

// Slice 3 review, 2026-08-03 — see Test revisions in
// specs/005-publish/implementation.md. T-32 already covers a writing
// carrying show/order; design.md → "show and order" states the rule in both
// directions and only one had a test.
// T-64, added by slice-4 review, 2026-08-03 — see Test revisions table in
// specs/005-publish/implementation.md and design.md → Test cases → Slice 4.
// `githubFake`'s `readFileWithSha` used to answer the create-vs-update read
// with the draft too, so every "first publish" test above asserted a world
// where the destination already carried the file. This is the assertion
// that was impossible while that lied: a fresh branch, no file on it yet,
// writeFile carries no sha at all.
describe("publish — a first publish sends no sha (T-64)", () => {
	test("T-64: a first publish — no file on the destination branch yet — writes with no sha", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			// fileOnBranch intentionally omitted — the destination does not
			// exist on this fresh branch yet.
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(calls.writeFile).toHaveLength(1);
		expect(calls.writeFile[0]?.options.sha).toBeUndefined();
	});
});

describe("publish — a project without show/order (T-61)", () => {
	test("T-61: a project published without show/order refuses, naming both, before any write", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validProjectDraftMetadata(), shortBody),
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "project", slug: "scaffold-ai", show: true, order: undefined },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("show");
		expect(result.error).toContain("order");

		expect(calls.createBranch).toHaveLength(0);
		expect(calls.writeFile).toHaveLength(0);
		expect(calls.createPullRequest).toHaveLength(0);
	});
});

// Slice 3 review, 2026-08-03 — the two paths that can leave `portfolio`
// half-written: a commit that never gets a PR, and a branch cut but never
// committed to. Both must point recovery at the GitHub branch URL, never the
// live site URL (a real bug the review caught: the post is not published, so
// its public URL is a 404 and knows nothing about pull requests).
describe("publish — half-written portfolio state (T-62, T-63)", () => {
	test("T-62: writeFile fails after the branch was cut — refusal names the branch and the GitHub branch URL, not the live site", async () => {
		const sentinel = "ZOD_ISSUE_DUMP_SENTINEL_DO_NOT_LEAK";
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		// writeFile throws after createBranch already recorded a call — the
		// commit step is the one that fails.
		github.writeFile = (async () => {
			throw new Error(sentinel);
		}) as typeof github.writeFile;
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("publish/writing/crdts");
		expect(result.error).toContain(
			"github.com/Ashutosh6393/Portfolio-new/tree/publish/writing/crdts",
		);
		expect(result.error).not.toContain("ashutoshverma.dev");
		expect(result.error).not.toContain(sentinel);

		expect(calls.createBranch).toHaveLength(1);
		expect(calls.createPullRequest).toHaveLength(0);
	});

	test("T-63: createPullRequest fails after the commit landed — refusal names the branch and the GitHub branch URL, and does not claim GitHub is unreachable", async () => {
		const sentinel = "ZOD_ISSUE_DUMP_SENTINEL_DO_NOT_LEAK";
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		github.createPullRequest = (async () => {
			throw new Error(sentinel);
		}) as typeof github.createPullRequest;
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("publish/writing/crdts");
		expect(result.error).toContain(
			"github.com/Ashutosh6393/Portfolio-new/tree/publish/writing/crdts",
		);
		expect(result.error.toLowerCase()).not.toContain("unreachable");
		expect(result.error).not.toContain(sentinel);

		expect(calls.createBranch).toHaveLength(1);
		expect(calls.writeFile).toHaveLength(1);
	});
});

// T-41 superseded by T-44, 2026-08-03 — see Test revisions table in
// specs/005-publish/implementation.md and design.md → Test cases → Slice 3 /
// Edge cases and failure modes. Slice 3's T-41 pinned "an existing branch
// refuses cleanly", true only "until slice 4 ships" (design.md's own words).
// Slice 4 ships idempotency: a leftover branch is the expected case of a
// publish that didn't finish, or of publishing the same slug again, and it
// is handled rather than refused. What survives from T-41's intent — no
// crash, no silent overwrite — is pinned here instead: a branch with no
// tracked pull request proceeds, writes without a stale sha (a create, not
// an overwrite of someone else's content), and opens a fresh PR.
describe("publish — a leftover branch with no pull request (T-41, superseded by T-44)", () => {
	test("T-41: a leftover branch with no pull request proceeds — writes fresh (no sha) and opens a new PR, rather than refusing or silently overwriting", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			branchAlreadyExists: true,
			// No `initialPullRequest` (findPullRequest resolves null) and no
			// `fileOnBranch` — a branch survives from an earlier attempt that
			// died before any commit landed (T-62's scenario), and nothing has
			// ever opened a PR for it.
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.status).toBe("created");

		expect(calls.createBranch).toHaveLength(1);
		expect(calls.writeFile).toHaveLength(1);
		// No sha sent — this is a create, not an overwrite of an existing file.
		expect(calls.writeFile[0]?.options.sha).toBeUndefined();
		expect(calls.createPullRequest).toHaveLength(1);
	});
});

// T-44 … T-51 — see specs/005-publish/design.md → Test cases → Slice 4.
//
// Signature under test, extended here for the same reason the Slice 3 header
// comment above gives — design.md leaves the exact shape to the implementer:
//
//   publish(
//     deps,
//     args: { kind; slug; show?; order?; revise?: boolean },
//   ): Promise<
//     | { ok: true; url: string; number: number;
//         status: "created" | "updated" | "recreated" }
//     | { ok: false; error: string }
//   >
//
// `status` is new: "created" on a first publish (Slice 3's tests never check
// it and stay green either way), "updated" when an open PR's branch is
// amended in place (T-44), "recreated" when a closed-but-unmerged PR is
// replaced with a fresh one (T-48).

type StatefulCalls = Calls & {
	findPullRequest: Array<{ repo: string; branch: string }>;
};

function emptyStatefulCalls(): StatefulCalls {
	return { ...emptyCalls(), findPullRequest: [] };
}

type PrState = {
	number: number;
	url: string;
	state: string;
	merged: boolean;
} | null;

// A second, stateful Github fake for Slice 4. Unlike `githubFake` above —
// built fresh for one call, then thrown away — this one carries branch/PR/
// file state *between* calls on the same instance. T-45 is the reason: it
// drives the same `publish` call twice and the second call has to see what
// the first one actually did, not a hand-faked idea of it.
function statefulGithubFake(options: {
	draft?: { content: string; sha: string } | Error;
	initialPullRequest?: PrState;
	fileOnBranch?: { content: string; sha: string };
	branchAlreadyExists?: boolean;
}): { github: Github; calls: StatefulCalls } {
	const calls = emptyStatefulCalls();
	let pr: PrState = options.initialPullRequest ?? null;
	let branchExists = options.branchAlreadyExists ?? false;
	let fileOnBranch = options.fileOnBranch;

	const github: Github = {
		async listDirectory(): Promise<never> {
			throw new Error("listDirectory is not part of publish");
		},
		async readFile(): Promise<never> {
			throw new Error("readFile is not part of publish");
		},
		async readFileWithSha(repo, path, _ref) {
			if (repo === "workshop") {
				if (options.draft instanceof Error) throw options.draft;
				if (!options.draft) {
					throw new Error("no draft configured for this fake");
				}
				return options.draft;
			}
			// repo === "portfolio": the branch read that decides create vs.
			// update — the same call T-50 pins the `sha` from.
			if (!fileOnBranch) throw new GithubNotFoundError("portfolio", path);
			return fileOnBranch;
		},
		async writeFile(repo, path, content, writeOptions) {
			calls.writeFile.push({ repo, path, content, options: writeOptions });
			fileOnBranch = { content, sha: "sha-after-write" };
		},
		async deleteFile(): Promise<never> {
			throw new Error("deleteFile is not part of publish");
		},
		async getBranchHead(repo, branch) {
			calls.getBranchHead.push({ repo, branch });
			return "main-head-sha";
		},
		async createBranch(repo, branch, fromSha) {
			calls.createBranch.push({ repo, branch, fromSha });
			if (branchExists) throw new GithubAlreadyExistsError(repo, branch);
			branchExists = true;
		},
		async createPullRequest(repo, prOptions) {
			calls.createPullRequest.push({ repo, options: prOptions });
			const number = 100 + calls.createPullRequest.length;
			const url = `https://github.com/example/portfolio/pull/${number}`;
			pr = { number, url, state: "open", merged: false };
			return { number, url };
		},
		async findPullRequest(repo, branch) {
			calls.findPullRequest.push({ repo, branch });
			return pr;
		},
	};

	return { github, calls };
}

describe("publish — branch and PR state (Slice 4, Task 16)", () => {
	test("T-44: branch exists with an open PR — updates the file and returns the same PR number, saying 'updated'", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			initialPullRequest: {
				number: 42,
				url: "https://github.com/example/portfolio/pull/42",
				state: "open",
				merged: false,
			},
			branchAlreadyExists: true,
			fileOnBranch: { content: "old content", sha: "existing-file-sha" },
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.number).toBe(42);
		expect(result.status).toBe("updated");

		// Same PR, so nothing new is opened.
		expect(calls.createPullRequest).toHaveLength(0);
		expect(calls.writeFile).toHaveLength(1);
		expect(calls.writeFile[0]?.options.sha).toBe("existing-file-sha");
	});

	test("T-45: publishing the same slug twice leaves exactly one PR", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		const site = siteFake({});
		const args = { kind: "writing" as const, slug: "crdts" };

		const first = await publish({ github, site }, args);
		expect(first.ok).toBe(true);

		// Same fake instance, so the second call genuinely sees the branch and
		// PR the first call created — not a hand-set-up "second world".
		const second = await publish({ github, site }, args);
		expect(second.ok).toBe(true);

		expect(calls.createPullRequest).toHaveLength(1);
	});

	test("T-46: a merged PR refuses without revise", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			initialPullRequest: {
				number: 42,
				url: "https://github.com/example/portfolio/pull/42",
				// GitHub reports "closed" for both a merged and an abandoned PR —
				// only `merged` may drive this refusal, not `state`. T-48 below
				// uses the identical `state`, differing only in `merged`.
				state: "closed",
				merged: true,
			},
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("revise");

		expect(calls.writeFile).toHaveLength(0);
		expect(calls.createBranch).toHaveLength(0);
		expect(calls.createPullRequest).toHaveLength(0);
	});

	test("T-48: a closed, unmerged PR is recreated and the result says so", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			initialPullRequest: {
				number: 42,
				url: "https://github.com/example/portfolio/pull/42",
				// Identical `state` to T-46, opposite `merged` — the two must be
				// told apart by `merged` alone.
				state: "closed",
				merged: false,
			},
			branchAlreadyExists: true,
			fileOnBranch: { content: "old content", sha: "existing-file-sha" },
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.status).toBe("recreated");

		expect(calls.createPullRequest).toHaveLength(1);
	});
});

describe("publish — revise (Slice 4, Task 17)", () => {
	test("T-47: a merged PR + revise proceeds — a new branch and a new PR", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			initialPullRequest: {
				number: 42,
				url: "https://github.com/example/portfolio/pull/42",
				state: "closed",
				merged: true,
			},
			// GitHub deletes a branch on merge by default — nothing left to
			// update, so a fresh `createBranch` succeeds rather than throwing.
			branchAlreadyExists: false,
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts", revise: true },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");

		expect(calls.createBranch).toHaveLength(1);
		expect(calls.createPullRequest).toHaveLength(1);
	});

	test("T-49: a published slug + revise proceeds instead of refusing", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		const publishedWriting: Writing = {
			slug: "crdts",
			title: "What CRDTs taught me",
			date: "2026-01-01",
			readingTime: "3 min",
			summary: "Already live.",
		};
		const site = siteFake({ content: [publishedWriting] });

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts", revise: true },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(calls.createBranch).toHaveLength(1);
		expect(calls.createPullRequest).toHaveLength(1);
	});

	test("T-50: revise updates an existing file on the branch — the commit carries its sha", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			initialPullRequest: {
				number: 42,
				url: "https://github.com/example/portfolio/pull/42",
				state: "open",
				merged: false,
			},
			branchAlreadyExists: true,
			fileOnBranch: { content: "old content", sha: "existing-file-sha" },
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts", revise: true },
		);

		expect(result.ok).toBe(true);
		expect(calls.writeFile[0]?.options.sha).toBe("existing-file-sha");
	});

	test("T-50 (other direction): revise creates rather than updates when the branch carries no file yet — no sha is sent", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			initialPullRequest: {
				number: 42,
				url: "https://github.com/example/portfolio/pull/42",
				state: "open",
				merged: false,
			},
			branchAlreadyExists: true,
			// No `fileOnBranch` — the branch exists (an open PR) but never got a
			// commit, e.g. a prior attempt died between createBranch and
			// writeFile (T-62's scenario).
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts", revise: true },
		);

		expect(result.ok).toBe(true);
		expect(calls.writeFile[0]?.options.sha).toBeUndefined();
	});

	test("T-51: revise on a featured project keeps it featured — show and order both land in the written file", async () => {
		const { github, calls } = statefulGithubFake({
			draft: draftFile(validProjectDraftMetadata(), shortBody),
			initialPullRequest: {
				number: 42,
				url: "https://github.com/example/portfolio/pull/42",
				state: "open",
				merged: false,
			},
			branchAlreadyExists: true,
			fileOnBranch: { content: "old content", sha: "existing-file-sha" },
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "project", slug: "yapper", show: true, order: 2, revise: true },
		);

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");

		const write = calls.writeFile[0];
		if (!write) throw new Error("expected a write call");
		expect(write.content).toContain('"show": true');
		expect(write.content).toContain('"order": 2');
	});
});

// T-65, added after the live M-1 run, 2026-08-03 — see Test revisions table
// in specs/005-publish/implementation.md and design.md → Test cases →
// Slice 3. M-1 hit this for real: the token had `Contents: write` but not
// `Pull requests: write` on the portfolio repo, and before the fix in
// src/lib/github.ts and src/services/publish.ts (commit 3518ddd) this fell
// through to the generic branch, whose message reads like a network fault —
// exactly the wrong lead for the one failure a retry can never fix.
describe("publish — GitHub refuses for a missing token permission (T-65)", () => {
	test("T-65: createPullRequest rejects with GithubForbiddenError — publish refuses naming both Contents and Pull requests, not as an unreachable/retryable failure", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
		});
		github.createPullRequest = (async () => {
			throw new GithubForbiddenError("portfolio", "pulls");
		}) as typeof github.createPullRequest;
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		// Branch on the type, not the message: GithubForbiddenError is what
		// publish checks with `instanceof`, so the fixture throws the real
		// class rather than a lookalike Error with a matching string.
		expect(result.error).toContain("Contents");
		expect(result.error).toContain("Pull requests");
		expect(result.error.toLowerCase()).not.toContain("unreachable");
		// Not phrased as something a retry could fix — no "try again".
		expect(result.error.toLowerCase()).not.toContain("try again");

		expect(calls.createBranch).toHaveLength(1);
		expect(calls.writeFile).toHaveLength(1);
	});
});
