import { beforeEach, describe, expect, test } from "bun:test";
import { renderDraft } from "../lib/draft";
import { type Github, GithubNotFoundError } from "../lib/github";
import type { SchemaEnvelope, Site } from "../lib/site";
import { createHandler } from "./index";

// T-10, T-15 — see specs/001-server-skeleton/design.md → Test cases, and →
// Approach → Seams: "Tools are exercised through the MCP handler, never by
// calling the tool function directly." So every request here goes through
// `createHandler({ site }).fetch`, a real JSON-RPC body over the SDK's
// stateless legacy fallback (no `initialize` handshake needed for a bare
// `tools/list` or `tools/call` POST — see feature CLAUDE.md and the SDK
// facts in the task brief).
//
// Empirically verified (not assumed): with
// `Accept: application/json, text/event-stream`, this SDK version answers a
// stateless POST as `text/event-stream`, one `event: message` frame whose
// `data:` line is the JSON-RPC response — never a bare JSON body. Both
// requests below come back HTTP 200, including the T-15 tool-argument
// rejection: the SDK folds a failed Zod parse into a normal `tools/call`
// result (`isError: true`, a `content` array), not a JSON-RPC error object
// and not an HTTP error.

// Test revision, 2026-08-03 — see Test revisions table in
// specs/005-publish/implementation.md. Task 4 widens `Site` with
// `fetchSchema`, so every fake must carry it to typecheck. No tool
// exercised here reaches the publish path, so this throws rather than
// return a plausible value: an accidental call fails loudly instead of
// passing silently.
// Test revision, 2026-08-03 (second) — see Test revisions table in
// specs/005-publish/implementation.md. Task 6 widens `Site` with
// `fetchDocument`, so every fake must carry it to typecheck. Same reasoning:
// throws rather than returning a plausible value.
const fakeSite: Site = {
	async fetchContent() {
		return [];
	},
	async fetchSchema(): Promise<never> {
		throw new Error("fetchSchema is not part of this test");
	},
	async fetchDocument(): Promise<never> {
		throw new Error("fetchDocument is not part of this test");
	},
};

// Test revision, 2026-07-31 — see Test revisions table in
// specs/002-github-access/implementation.md. Task 6 adds `github` to
// createHandler's deps, so the calls below pass both fakes. No assertion
// changed. The bodies below are what T-16 asserts travel through the handler.
const voiceBody = "Write like a person. Short sentences.";
const rulesBody = "Open with the problem. No hashtags.";

const workshopFiles: Record<string, string> = {
	"skills/be-human.md": voiceBody,
	"skills/linkedin-post.md": rulesBody,
	"templates/writing.md": "# {title}",
};

const fakeGithub: Github = {
	async listDirectory(_repo, path) {
		if (path !== "skills" && path !== "templates") {
			throw new GithubNotFoundError("workshop", path);
		}
		return Object.keys(workshopFiles)
			.filter((file) => file.startsWith(`${path}/`))
			.map((file) => ({ name: file.slice(path.length + 1), type: "file" }));
	},
	async readFile(_repo, path) {
		const body = workshopFiles[path];
		if (body === undefined) throw new GithubNotFoundError("workshop", path);
		return body;
	},
	// Test revision, 2026-08-02 — see Test revisions table in
	// specs/004-drafts/implementation.md. Spec 004 Task 2 widens `Github` with
	// these three, so the fake must carry them to typecheck. No tool exercised
	// here writes, so they throw rather than return a plausible value: an
	// accidental call fails loudly instead of passing silently.
	async readFileWithSha(): Promise<never> {
		throw new Error("readFileWithSha is not part of this test");
	},
	async writeFile(): Promise<never> {
		throw new Error("writeFile is not part of this test");
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of this test");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 11 widens `Github` with these
	// three, so every fake must carry them to typecheck. No tool exercised
	// here reaches the publish path, so these throw rather than return a
	// plausible value: an accidental call fails loudly instead of passing
	// silently.
	async getBranchHead(): Promise<never> {
		throw new Error("getBranchHead is not part of this test");
	},
	async createBranch(): Promise<never> {
		throw new Error("createBranch is not part of this test");
	},
	async createPullRequest(): Promise<never> {
		throw new Error("createPullRequest is not part of this test");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 15 adds `findPullRequest` to
	// `Github`, so every fake must carry it to typecheck. No tool exercised
	// here reaches the publish path, so this throws rather than returning
	// `null` — `null` is a meaningful answer here ("no PR exists for this
	// branch"), and a stub that returned it could let an idempotency test pass
	// without this code ever having called it.
	async findPullRequest(): Promise<never> {
		throw new Error("findPullRequest is not part of this test");
	},
};

async function postJsonRpc(body: unknown) {
	const handler = createHandler({ site: fakeSite, github: fakeGithub });
	const response = await handler.fetch(
		new Request("http://localhost/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify(body),
		}),
	);

	const text = await response.text();
	const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
	if (!dataLine) {
		throw new Error(`expected an SSE data frame, got: ${text}`);
	}
	const payload = JSON.parse(dataLine.slice("data:".length).trim());

	return { status: response.status, payload };
}

describe("tools/list", () => {
	test("T-10: advertises list_content with a non-empty description and the kind enum exactly writing, project", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
		});

		expect(status).toBe(200);

		const tools = payload.result.tools;
		const listContentTool = tools.find(
			(tool: { name: string }) => tool.name === "list_content",
		);
		expect(listContentTool).toBeDefined();
		expect(typeof listContentTool.description).toBe("string");
		expect(listContentTool.description.length).toBeGreaterThan(0);

		const kindEnum = listContentTool.inputSchema.properties.kind.enum;
		expect(kindEnum).toEqual(["writing", "project"]);
	});
});

describe("tools/call list_content", () => {
	test("T-15: an unknown kind is refused with the allowed values, HTTP status still 200", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 2,
			method: "tools/call",
			params: { name: "list_content", arguments: { kind: "post" } },
		});

		// design.md → Approach → Errors: "The HTTP status for a tool that
		// failed is still 200. That is not a bug; it is the protocol."
		expect(status).toBe(200);

		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBe(true);
		const errorText = payload.result.content
			.map((block: { text?: string }) => block.text ?? "")
			.join(" ");
		expect(errorText).toContain("writing");
		expect(errorText).toContain("project");
	});
});

// 002-T-15, 002-T-16, 002-T-17 — see specs/002-github-access/design.md → Test
// cases. Prefixed because spec 001 already owns T-10 and T-15 in this file.
//
// design.md → Seams: "The tool is exercised through the MCP handler, never by
// calling the tool function." Every request below is a real JSON-RPC body.

describe("tools/list — get_skill", () => {
	test("002-T-15: advertises get_skill with a description and an optional name, and list_content is still there", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/list",
		});

		expect(status).toBe(200);

		const tools = payload.result.tools;
		const getSkillTool = tools.find(
			(tool: { name: string }) => tool.name === "get_skill",
		);
		expect(getSkillTool).toBeDefined();
		expect(typeof getSkillTool.description).toBe("string");
		expect(getSkillTool.description.length).toBeGreaterThan(0);

		// Optional means callable with no arguments at all — that is the mode
		// that lists what exists, and a required `name` would make it
		// unreachable.
		expect(getSkillTool.inputSchema.properties.name).toBeDefined();
		expect(getSkillTool.inputSchema.required ?? []).not.toContain("name");

		// Registering a second tool must not drop the first.
		expect(
			tools.find((tool: { name: string }) => tool.name === "list_content"),
		).toBeDefined();
	});
});

function textOf(payload: { result: { content: { text?: string }[] } }) {
	return payload.result.content.map((block) => block.text ?? "").join("\n");
}

describe("tools/call get_skill", () => {
	test("002-T-16: a named skill comes back through the handler with its rules and the voice", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 4,
			method: "tools/call",
			params: { name: "get_skill", arguments: { name: "linkedin-post" } },
		});

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBeFalsy();

		const text = textOf(payload);
		expect(text).toContain(rulesBody);
		expect(text).toContain(voiceBody);
	});

	test("002-T-16: with no arguments it lists the skills and the templates", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 5,
			method: "tools/call",
			params: { name: "get_skill", arguments: {} },
		});

		expect(status).toBe(200);
		expect(payload.result.isError).toBeFalsy();

		const text = textOf(payload);
		expect(text).toContain("be-human");
		expect(text).toContain("linkedin-post");
		expect(text).toContain("writing");
	});

	test("002-T-17: an unknown name is a tool result, not an HTTP error", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 6,
			method: "tools/call",
			params: { name: "get_skill", arguments: { name: "nope" } },
		});

		// design.md → Approach → Errors: a tool that failed still answers 200.
		// That is the protocol, not a bug.
		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBe(true);

		const text = textOf(payload);
		expect(text).toContain("nope");
		// Actionable in the same turn: it names what does exist.
		expect(text).toContain("linkedin-post");
	});
});

// T-25, T-26, T-27, T-28 — specs/004-drafts/design.md → Test cases, Task 6.
// Tools are exercised through the MCP handler, never by calling the tool
// function directly.
//
// The shared `fakeGithub` and `fakeSite` above are left untouched: their
// write/read-with-sha methods throw on purpose (specs/004-drafts CLAUDE.md's
// "Critical constraint"), and `fakeSite` returns `[]`. Everything below is an
// addition — new fakes for the draft tools, never a revision of the shared
// ones.

const seedDraftFiles = {
	"drafts/writing/a-post.mdx": {
		content:
			'export const metadata = {\n  "title": "Draft Title Two"\n}\n\n... draft body ...',
		sha: "draft-sha-1",
	},
};

// T-26 writes to this same path (fakeDraftGithub.writeFile mutates the
// object in place), so without a reset a later test reading it back — T-28 —
// would see T-26's write instead of the seed. Reset before every test rather
// than pointing T-28 at a slug T-26 never writes: it also protects any future
// test that reads "a-post.mdx" from the same contamination.
let draftFiles: Record<string, { content: string; sha: string }>;
beforeEach(() => {
	draftFiles = structuredClone(seedDraftFiles);
});

// save_draft writes; get_content reads with a sha. Neither ever calls
// listDirectory or the plain readFile, so those still throw — an
// accidental call fails loudly rather than passing silently. deleteFile
// is real (Task 9's T-29/T-30 need it to actually delete).
const fakeDraftGithub: Github = {
	async listDirectory(): Promise<never> {
		throw new Error("listDirectory is not part of this test");
	},
	async readFile(): Promise<never> {
		throw new Error("readFile is not part of this test");
	},
	async readFileWithSha(_repo, path) {
		const file = draftFiles[path];
		if (!file) throw new GithubNotFoundError("workshop", path);
		return file;
	},
	async writeFile(_repo, path, content, _options) {
		draftFiles[path] = { content, sha: "draft-sha-2" };
	},
	// Task 9 needs this to actually delete: discard_draft reads the sha via
	// readFileWithSha above, then calls deleteFile. structuredClone in the
	// beforeEach means this mutation never leaks into another test.
	async deleteFile(_repo, path) {
		delete draftFiles[path];
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 11 widens `Github` with these
	// three, so every fake must carry them to typecheck. No tool exercised
	// here reaches the publish path, so these throw rather than return a
	// plausible value: an accidental call fails loudly instead of passing
	// silently.
	async getBranchHead(): Promise<never> {
		throw new Error("getBranchHead is not part of this test");
	},
	async createBranch(): Promise<never> {
		throw new Error("createBranch is not part of this test");
	},
	async createPullRequest(): Promise<never> {
		throw new Error("createPullRequest is not part of this test");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 15 adds `findPullRequest` to
	// `Github`, so every fake must carry it to typecheck. No tool exercised
	// here reaches the publish path, so this throws rather than returning
	// `null` — `null` is a meaningful answer here ("no PR exists for this
	// branch"), and a stub that returned it could let an idempotency test pass
	// without this code ever having called it.
	async findPullRequest(): Promise<never> {
		throw new Error("findPullRequest is not part of this test");
	},
};

// A site that already publishes "a-post" as a writing — the shadowing case
// save_draft has to refuse (T-27). The shared `fakeSite` above stays
// untouched and keeps returning `[]`.
const fakeSiteWithPublishedPost: Site = {
	async fetchContent(kind) {
		if (kind !== "writing") return [];
		return [
			{
				slug: "a-post",
				title: "A Post",
				date: "2026-01-01",
				readingTime: "3 min",
				summary: "already live",
			},
		];
	},
	async fetchSchema(): Promise<never> {
		throw new Error("fetchSchema is not part of this test");
	},
	async fetchDocument(): Promise<never> {
		throw new Error("fetchDocument is not part of this test");
	},
};

async function postJsonRpcWithDeps(
	body: unknown,
	deps: { site: Site; github: Github },
) {
	const handler = createHandler(deps);
	const response = await handler.fetch(
		new Request("http://localhost/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream",
			},
			body: JSON.stringify(body),
		}),
	);

	const text = await response.text();
	const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
	if (!dataLine) {
		throw new Error(`expected an SSE data frame, got: ${text}`);
	}
	const payload = JSON.parse(dataLine.slice("data:".length).trim());

	return { status: response.status, payload };
}

describe("tools/list — save_draft, get_content", () => {
	test("T-25: advertises save_draft and get_content with non-empty descriptions and the kind enum exactly writing, project, and the earlier tools stay listed", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 7,
			method: "tools/list",
		});

		expect(status).toBe(200);

		const tools = payload.result.tools;

		const saveDraftTool = tools.find(
			(tool: { name: string }) => tool.name === "save_draft",
		);
		expect(saveDraftTool).toBeDefined();
		expect(typeof saveDraftTool.description).toBe("string");
		expect(saveDraftTool.description.length).toBeGreaterThan(0);
		expect(saveDraftTool.inputSchema.properties.kind.enum).toEqual([
			"writing",
			"project",
		]);

		const getContentTool = tools.find(
			(tool: { name: string }) => tool.name === "get_content",
		);
		expect(getContentTool).toBeDefined();
		expect(typeof getContentTool.description).toBe("string");
		expect(getContentTool.description.length).toBeGreaterThan(0);
		expect(getContentTool.inputSchema.properties.kind.enum).toEqual([
			"writing",
			"project",
		]);

		// Registering two more tools must not drop the earlier ones.
		expect(
			tools.find((tool: { name: string }) => tool.name === "list_content"),
		).toBeDefined();
		expect(
			tools.find((tool: { name: string }) => tool.name === "get_skill"),
		).toBeDefined();
	});
});

describe("tools/call save_draft", () => {
	test("T-26: saving a new draft succeeds and names the path it was saved to", async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 8,
				method: "tools/call",
				params: {
					name: "save_draft",
					arguments: {
						kind: "writing",
						slug: "a-post",
						metadata: { title: "x" },
						body: "some draft body",
					},
				},
			},
			{ site: fakeSite, github: fakeDraftGithub },
		);

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBeFalsy();

		const text = textOf(payload);
		expect(text).toContain("drafts/writing/a-post.mdx");
	});

	test("T-27: saving over an already-published slug is refused with an actionable sentence, HTTP status still 200", async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 9,
				method: "tools/call",
				params: {
					name: "save_draft",
					arguments: {
						kind: "writing",
						slug: "a-post",
						metadata: { title: "x" },
						body: "some draft body",
					},
				},
			},
			{ site: fakeSiteWithPublishedPost, github: fakeDraftGithub },
		);

		// design.md → Approach → Errors: a tool that failed still answers 200.
		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBe(true);

		const text = textOf(payload);
		expect(text).toContain("a-post");
		// Actionable: it says what to do instead of retrying blindly.
		expect(text).toMatch(/choose a different slug|edit the published/i);
	});
});

describe("tools/call get_content", () => {
	test("T-28: reading a draft back returns its metadata, its body and its sha", async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 10,
				method: "tools/call",
				params: {
					name: "get_content",
					arguments: { kind: "writing", slug: "a-post", state: "draft" },
				},
			},
			{ site: fakeSite, github: fakeDraftGithub },
		);

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBeFalsy();

		const text = textOf(payload);
		expect(text).toContain("Draft Title Two"); // the title from the stored metadata
		expect(text).toContain("... draft body ...");
		// Without the sha in the rendered text, save_draft has nothing to
		// close the read-modify-write loop with.
		expect(text).toContain("draft-sha-1");
	});
});

// T-29, T-30 — specs/004-drafts/design.md → Test cases, Task 9. Same fixtures
// as T-25 through T-28: `fakeDraftGithub` and `draftFiles`, reset by the
// `beforeEach` above before every test in this file, so a delete here can
// never leak into another test's read.

describe("tools/list — discard_draft", () => {
	test("T-29: advertises discard_draft with a non-empty description and the kind enum exactly writing, project, and the earlier tools stay listed", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 11,
			method: "tools/list",
		});

		expect(status).toBe(200);

		const tools = payload.result.tools;

		const discardDraftTool = tools.find(
			(tool: { name: string }) => tool.name === "discard_draft",
		);
		expect(discardDraftTool).toBeDefined();
		expect(typeof discardDraftTool.description).toBe("string");
		expect(discardDraftTool.description.length).toBeGreaterThan(0);
		expect(discardDraftTool.inputSchema.properties.kind.enum).toEqual([
			"writing",
			"project",
		]);

		// Registering a fourth tool must not drop the earlier ones.
		expect(
			tools.find((tool: { name: string }) => tool.name === "save_draft"),
		).toBeDefined();
		expect(
			tools.find((tool: { name: string }) => tool.name === "get_content"),
		).toBeDefined();
	});
});

describe("tools/call discard_draft", () => {
	test("T-29: discarding an existing draft succeeds and names what was removed", async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 12,
				method: "tools/call",
				params: {
					name: "discard_draft",
					arguments: { kind: "writing", slug: "a-post" },
				},
			},
			{ site: fakeSite, github: fakeDraftGithub },
		);

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBeFalsy();

		const text = textOf(payload);
		expect(text).toContain("drafts/writing/a-post.mdx");
	});

	test("T-30: discarding a missing slug is a tool result, not an HTTP error", async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 13,
				method: "tools/call",
				params: {
					name: "discard_draft",
					arguments: { kind: "writing", slug: "no-such-draft" },
				},
			},
			{ site: fakeSite, github: fakeDraftGithub },
		);

		// design.md → Approach → Errors: a tool that failed still answers 200.
		// design.md line 660: asserted directly by T-30.
		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBe(true);

		const text = textOf(payload);
		expect(text).toContain("writing/no-such-draft");
	});
});

// T-24, T-31 — specs/004-drafts/design.md → Test cases, Task 12. `list_content`
// gains a required `state` argument: "published" routes to the existing,
// untouched `listContent` service (T-24, a regression pin — design.md says
// twice that this path must behave exactly as it does today); "draft" routes
// to the new `listDrafts` service (T-31).

// Derives from `draftFiles` (reset by the `beforeEach` above) rather than a
// separate fixture, so it can never drift out of sync with what
// `fakeDraftGithub` reads and writes elsewhere in this file.
const fakeDraftListingGithub: Github = {
	async listDirectory(_repo, path) {
		const prefix = `${path}/`;
		return Object.keys(draftFiles)
			.filter((file) => file.startsWith(prefix))
			.map((file) => ({ name: file.slice(prefix.length), type: "file" }));
	},
	async readFile(): Promise<never> {
		throw new Error("readFile is not part of this test");
	},
	async readFileWithSha(): Promise<never> {
		throw new Error("readFileWithSha is not part of this test");
	},
	async writeFile(): Promise<never> {
		throw new Error("writeFile is not part of this test");
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of this test");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 11 widens `Github` with these
	// three, so every fake must carry them to typecheck. No tool exercised
	// here reaches the publish path, so these throw rather than return a
	// plausible value: an accidental call fails loudly instead of passing
	// silently.
	async getBranchHead(): Promise<never> {
		throw new Error("getBranchHead is not part of this test");
	},
	async createBranch(): Promise<never> {
		throw new Error("createBranch is not part of this test");
	},
	async createPullRequest(): Promise<never> {
		throw new Error("createPullRequest is not part of this test");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 15 adds `findPullRequest` to
	// `Github`, so every fake must carry it to typecheck. No tool exercised
	// here reaches the publish path, so this throws rather than returning
	// `null` — `null` is a meaningful answer here ("no PR exists for this
	// branch"), and a stub that returned it could let an idempotency test pass
	// without this code ever having called it.
	async findPullRequest(): Promise<never> {
		throw new Error("findPullRequest is not part of this test");
	},
};

describe("tools/list — list_content state", () => {
	test("T-31: advertises state on list_content with the enum exactly published, draft", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 16,
			method: "tools/list",
		});

		expect(status).toBe(200);

		const tools = payload.result.tools;
		const listContentTool = tools.find(
			(tool: { name: string }) => tool.name === "list_content",
		);
		expect(listContentTool).toBeDefined();

		const stateEnum = listContentTool.inputSchema.properties.state?.enum;
		expect(stateEnum).toEqual(["published", "draft"]);
	});
});

// T-26, T-27 — specs/005-publish/design.md → Test cases, Slice 2. `get_content`
// gains a required `state`, mirroring `list_content` exactly (design.md →
// `get_content` gains `state`).

// A site returning a fixed document for a published read. New fake, not a
// revision of `fakeSite` or `fakeSiteWithPublishedPost` above: neither of
// those has a resolving `fetchDocument`, and T-26 needs one that does.
const fakeSiteWithPublishedDocument: Site = {
	async fetchContent(): Promise<never> {
		throw new Error("fetchContent is not part of this test");
	},
	async fetchSchema(): Promise<never> {
		throw new Error("fetchSchema is not part of this test");
	},
	async fetchDocument(_kind, slug) {
		return {
			metadata: { title: "Published Title" },
			body: `... published body for ${slug} ...`,
		};
	},
};

describe("tools/call get_content — state", () => {
	test('T-26: state "published" returns the body through the handler, isError unset', async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 20,
				method: "tools/call",
				params: {
					name: "get_content",
					arguments: { kind: "writing", slug: "a-post", state: "published" },
				},
			},
			{ site: fakeSiteWithPublishedDocument, github: fakeGithub },
		);

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBeFalsy();

		const text = textOf(payload);
		expect(text).toContain("Published Title");
		expect(text).toContain("... published body for a-post ...");
	});

	// design.md → `get_content` gains `state`: "Mirrors `list_content` exactly,
	// including that `state` is required, not defaulted." Follows T-36's
	// pattern above for list_content — the SDK folds a failed Zod parse into a
	// normal `tools/call` result (`isError: true`), not a JSON-RPC error, and
	// HTTP status stays 200.
	test("T-27: a get_content call with no state is refused, HTTP status still 200", async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 21,
				method: "tools/call",
				params: {
					name: "get_content",
					arguments: { kind: "writing", slug: "a-post" },
				},
			},
			{ site: fakeSite, github: fakeDraftGithub },
		);

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBe(true);
	});
});

describe("tools/call list_content — state", () => {
	test('T-24: state "published" returns the same catalogue text list_content returns today', async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 17,
				method: "tools/call",
				params: {
					name: "list_content",
					arguments: { kind: "writing", state: "published" },
				},
			},
			{ site: fakeSiteWithPublishedPost, github: fakeGithub },
		);

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBeFalsy();

		// Pinned from the tool's real output: run this exact request against
		// today's source (kind + state, before state exists in the schema) and
		// this is the text it returns — state is silently dropped and the
		// published path runs unchanged. Verified empirically, not paraphrased.
		expect(textOf(payload)).toBe("a-post — A Post\nalready live");
	});

	test('T-31: state "draft" lists the draft slugs instead of the published catalogue', async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 18,
				method: "tools/call",
				params: {
					name: "list_content",
					arguments: { kind: "writing", state: "draft" },
				},
			},
			{ site: fakeSite, github: fakeDraftListingGithub },
		);

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBeFalsy();
		expect(textOf(payload)).toContain("a-post");
	});

	// design.md → Open questions → A-3: `state` is required, not
	// optional-defaulting-to-published. Follows T-15's pattern above — the SDK
	// folds a failed Zod parse into a normal `tools/call` result (`isError:
	// true`), not a JSON-RPC error, and HTTP status stays 200.
	test("T-36: a list_content call with no state is refused, HTTP status still 200", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 19,
			method: "tools/call",
			params: { name: "list_content", arguments: { kind: "writing" } },
		});

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBe(true);
	});
});

// T-42, T-60 — specs/005-publish/design.md → Test cases, Slice 3, Task 14.
// `publish` is exercised through the MCP handler, never by calling the tool
// function directly.

// The live writing schema, mirrored from src/services/publish.test.ts — only
// the fields a writing publish actually needs.
const publishWritingSchema: SchemaEnvelope = {
	writing: {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		properties: {
			title: { type: "string", minLength: 1 },
			date: { type: "string", format: "date" },
			readingTime: { type: "string", minLength: 1 },
			summary: { type: "string", minLength: 1 },
		},
		required: ["title", "date", "readingTime", "summary"],
		additionalProperties: false,
	},
	project: {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		properties: {},
		required: [],
		additionalProperties: false,
	},
};

// A draft that already exists in workshop, saved without readingTime (as
// save_draft always leaves it) — exactly what publish reads before validating.
const publishDraftFile = renderDraft(
	{
		title: "What CRDTs taught me",
		date: "2026-08-03",
		summary: "A short summary.",
	},
	"Hello world. This is the body of the post.",
);

// A site that has never published "crdts" and answers the writing schema
// above. New fake, not a revision of `fakeSite`: neither `fakeSite` nor
// `fakeSiteWithPublishedPost` has a resolving `fetchSchema`, and a real
// publish needs one.
const fakeSiteForPublish: Site = {
	async fetchContent() {
		return [];
	},
	async fetchSchema() {
		return publishWritingSchema;
	},
	async fetchDocument(): Promise<never> {
		throw new Error("fetchDocument is not part of this test");
	},
};

// A Github fake that actually completes a publish: reads the draft, writes
// the published file, cuts the branch and opens the PR. New fake, not a
// revision of the shared `fakeGithub`: that one throws on every publish
// method on purpose, and this test needs the opposite.
const fakeGithubForPublish: Github = {
	async listDirectory(): Promise<never> {
		throw new Error("listDirectory is not part of this test");
	},
	async readFile(): Promise<never> {
		throw new Error("readFile is not part of this test");
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. `publish` calls `readFileWithSha`
	// twice: once for the workshop draft, once for the create-vs-update read
	// against `portfolio`. This used to answer both with the draft, which
	// made T-42's real publish look like an update (carrying `draft-sha`)
	// when a genuine first publish carries no sha at all. `portfolio` now
	// truthfully answers "no file here yet" — this fixture's slug has never
	// been published before.
	async readFileWithSha(repo, path) {
		if (repo === "workshop") {
			return { content: publishDraftFile, sha: "draft-sha" };
		}
		throw new GithubNotFoundError(repo, path);
	},
	async writeFile() {},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of this test");
	},
	async getBranchHead() {
		return "main-head-sha";
	},
	async createBranch() {},
	async createPullRequest() {
		return {
			number: 7,
			url: "https://github.com/example/portfolio/pull/7",
		};
	},
	// Test revision, 2026-08-03 — see Test revisions table in
	// specs/005-publish/implementation.md. Task 16 makes `publish` call
	// `findPullRequest` on every run, which expired the throwing stub this
	// comment used to describe (same situation as the Task 5 row in that
	// table): T-42 drives an actual successful publish through this fake, and
	// a throw here now fails that publish before it completes. `null` is the
	// truthful answer — this fixture's slug has never been published before.
	async findPullRequest() {
		return null;
	},
};

describe("tools/list — publish", () => {
	test("T-60: advertises publish with a non-empty description and the kind enum exactly writing, project, and the earlier tools stay listed", async () => {
		const { status, payload } = await postJsonRpc({
			jsonrpc: "2.0",
			id: 22,
			method: "tools/list",
		});

		expect(status).toBe(200);

		const tools = payload.result.tools;

		const publishTool = tools.find(
			(tool: { name: string }) => tool.name === "publish",
		);
		expect(publishTool).toBeDefined();
		expect(typeof publishTool.description).toBe("string");
		expect(publishTool.description.length).toBeGreaterThan(0);
		expect(publishTool.inputSchema.properties.kind.enum).toEqual([
			"writing",
			"project",
		]);

		// Registering a sixth tool must not drop any of the earlier five.
		for (const name of [
			"list_content",
			"get_skill",
			"save_draft",
			"get_content",
			"discard_draft",
		]) {
			expect(
				tools.find((tool: { name: string }) => tool.name === name),
			).toBeDefined();
		}
	});
});

describe("tools/call publish", () => {
	test("T-42: a successful publish returns the PR URL through the handler, isError unset", async () => {
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 23,
				method: "tools/call",
				params: {
					name: "publish",
					arguments: { kind: "writing", slug: "crdts" },
				},
			},
			{ site: fakeSiteForPublish, github: fakeGithubForPublish },
		);

		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBeFalsy();

		const text = textOf(payload);
		expect(text).toContain("https://github.com/example/portfolio/pull/7");
	});

	test("T-42: a refusal comes back as isError true, HTTP status still 200", async () => {
		// A traversal slug is refused before anything is touched (design.md →
		// Test cases T-38), so the shared throwing fakes are safe to reuse here.
		const { status, payload } = await postJsonRpcWithDeps(
			{
				jsonrpc: "2.0",
				id: 24,
				method: "tools/call",
				params: {
					name: "publish",
					arguments: { kind: "writing", slug: "../../../etc/passwd" },
				},
			},
			{ site: fakeSite, github: fakeGithub },
		);

		// design.md → Approach → Errors: a tool that failed still answers 200.
		expect(status).toBe(200);
		expect(payload.error).toBeUndefined();
		expect(payload.result.isError).toBe(true);
	});
});
