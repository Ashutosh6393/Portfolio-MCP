import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Site } from "../lib/site";
import { listContent } from "../services/list-content";

// design.md → Approach → The tool description: specified verbatim, not
// authored here. Never reword — "writing" and "post" are different things
// in CONTEXT.md and this text is what keeps a model from conflating them.
const description = `List the published content on ashutoshverma.dev.

Returns one entry per item with its slug, title and summary. This is the
catalogue, not the text — use it to see what exists and to get a slug.

kind:
  "writing"  a blog entry, live at /writing/{slug}
  "project"  a portfolio project page, live at /projects/{slug}

Only published content is reachable. Drafts and social posts are not
available from this server yet.`;

export function registerListContent(
	server: McpServer,
	deps: { site: Site },
): void {
	server.registerTool(
		"list_content",
		{
			description,
			inputSchema: z.object({ kind: z.enum(["writing", "project"]) }),
		},
		async ({ kind }) => {
			const result = await listContent(deps, { kind });

			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text", text: result.error }],
				};
			}

			// design.md → Edge cases: an empty catalogue is a valid answer, not
			// an error — say so in words rather than returning an empty blob.
			if (result.items.length === 0) {
				return {
					content: [{ type: "text", text: `No published ${kind} found.` }],
				};
			}

			const text = result.items
				.map((item) => `${item.slug} — ${item.title}\n${item.summary}`)
				.join("\n\n");
			return { content: [{ type: "text", text }] };
		},
	);
}
