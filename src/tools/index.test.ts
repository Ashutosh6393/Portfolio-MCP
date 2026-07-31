import { describe, expect, test } from "bun:test";
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

async function postJsonRpc(body: unknown) {
	const handler = createHandler({ site: fakeSite });
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
