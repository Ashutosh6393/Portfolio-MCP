import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Github } from "../lib/github";
import { getContent } from "../services/get-content";

// design.md → Approach → The tool descriptions → `get_content`: specified
// verbatim, not authored here. Never reword.
const description = `Read one draft back out of the private workshop repo: its metadata, its
body, and its sha.

Call this before changing a draft. Editing is read, change, save: get the
draft here, edit the metadata or the body, then call save_draft with the
same kind and slug and the sha this returned. Pass the sha back unchanged
— it is how the server knows the draft has not moved underneath you.

kind:
  "writing"  a blog entry
  "project"  a portfolio project page

This reads drafts only. For published content, list_content returns the
catalogue.`;

export function registerGetContent(
	server: McpServer,
	deps: { github: Github },
): void {
	server.registerTool(
		"get_content",
		{
			description,
			inputSchema: z.object({
				kind: z.enum(["writing", "project"]),
				slug: z.string(),
			}),
		},
		async ({ kind, slug }) => {
			const result = await getContent(deps, { kind, slug });

			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text", text: result.error }],
				};
			}

			// The sha must be unmissable: it is the input the next save_draft
			// needs to close the read-modify-write loop.
			const text = [
				`sha: ${result.sha}`,
				"",
				JSON.stringify(result.metadata, null, 2),
				"",
				result.body,
			].join("\n");

			return { content: [{ type: "text", text }] };
		},
	);
}
