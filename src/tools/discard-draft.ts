import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Github } from "../lib/github";
import { discardDraft } from "../services/discard-draft";

// design.md → Approach → The tool descriptions → `discard_draft`: specified
// verbatim, not authored here. Never reword.
const description = `Delete a draft from the private workshop repo.

This cannot be undone from here. There is no trash and no restore, so if
there is any doubt about which draft this is, read it with get_content
first.

kind:
  "writing"  a blog entry
  "project"  a portfolio project page

It removes drafts only. Published content is not reachable from this
server.`;

export function registerDiscardDraft(
	server: McpServer,
	deps: { github: Github },
): void {
	server.registerTool(
		"discard_draft",
		{
			description,
			inputSchema: z.object({
				kind: z.enum(["writing", "project"]),
				slug: z.string(),
			}),
		},
		async ({ kind, slug }) => {
			const result = await discardDraft(deps, { kind, slug });

			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text", text: result.error }],
				};
			}

			return {
				content: [{ type: "text", text: `Removed ${result.path}.` }],
			};
		},
	);
}
