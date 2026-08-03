import { describe, expect, test } from "bun:test";
import { renderDraft } from "../lib/draft";
import {
	type Github,
	GithubAlreadyExistsError,
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
};

function emptyCalls(): Calls {
	return {
		writeFile: [],
		createBranch: [],
		createPullRequest: [],
		getBranchHead: [],
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
}): { github: Github; calls: Calls } {
	const calls = emptyCalls();
	const github: Github = {
		async listDirectory(): Promise<never> {
			throw new Error("listDirectory is not part of publish");
		},
		async readFile(): Promise<never> {
			throw new Error("readFile is not part of publish");
		},
		async readFileWithSha() {
			if (options.draft instanceof Error) throw options.draft;
			if (!options.draft) {
				throw new Error("no draft configured for this fake");
			}
			return options.draft;
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

	test("T-41: an existing branch refuses cleanly, naming it, not a crash and not a silent overwrite", async () => {
		const { github, calls } = githubFake({
			draft: draftFile(validWritingDraftMetadata(), shortBody),
			createBranchThrows: new GithubAlreadyExistsError(
				"portfolio",
				"publish/writing/crdts",
			),
		});
		const site = siteFake({});

		const result = await publish(
			{ github, site },
			{ kind: "writing", slug: "crdts" },
		);

		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected an error result");
		expect(result.error).toContain("publish/writing/crdts");

		expect(calls.createBranch).toHaveLength(1);
		expect(calls.writeFile).toHaveLength(0);
		expect(calls.createPullRequest).toHaveLength(0);
	});
});

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
		// T-41 forces createBranch to be called once on this path — it's the only way
		// GitHub reveals the branch already exists. The call throws and creates nothing,
		// so it's still zero *writes* per T-43, just not zero *calls*.
		expectedCreateBranchCalls?: number;
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
		{
			name: "an existing branch",
			args: { kind: "writing", slug: "crdts" },
			github: () =>
				githubFake({
					draft: draftFile(validWritingDraftMetadata(), shortBody),
					createBranchThrows: new GithubAlreadyExistsError(
						"portfolio",
						"publish/writing/crdts",
					),
				}),
			site: () => siteFake({}),
			expectedCreateBranchCalls: 1,
		},
	];

	for (const scenario of scenarios) {
		test(`refuses "${scenario.name}" with zero writes to portfolio`, async () => {
			const { github, calls } = scenario.github();
			const site = scenario.site();

			const result = await publish({ github, site }, scenario.args);

			expect(result.ok).toBe(false);
			expect(calls.writeFile).toHaveLength(0);
			expect(calls.createBranch).toHaveLength(
				scenario.expectedCreateBranchCalls ?? 0,
			);
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
