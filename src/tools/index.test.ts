import { beforeEach, describe, expect, test } from "bun:test";
import { type Github, GithubNotFoundError } from "../lib/github";
import type { Site } from "../lib/site";
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

const fakeSite: Site = {
	async fetchContent() {
		return [];
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
// listDirectory or the plain readFile/deleteFile, so those still throw —
// an accidental call fails loudly rather than passing silently.
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
	async writeFile(_repo, path, content) {
		draftFiles[path] = { content, sha: "draft-sha-2" };
	},
	async deleteFile(): Promise<never> {
		throw new Error("deleteFile is not part of this test");
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
					arguments: { kind: "writing", slug: "a-post" },
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
