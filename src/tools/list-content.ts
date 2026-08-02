import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Github } from "../lib/github";
import type { Site } from "../lib/site";
import { listContent } from "../services/list-content";
import { listDrafts } from "../services/list-drafts";

// design.md → Approach → The tool descriptions → `list_content`: rewritten,
// not patched. Specified verbatim, not authored here. Never reword.
const description = `List content by kind and state.

state:
  "published"  live on ashutoshverma.dev. One entry per item with its
               slug, title and summary — the catalogue, not the text.
  "draft"      unpublished, in the private workshop repo. Slugs only.
               Call get_content to read one.

kind:
  "writing"  a blog entry, live at /writing/{slug}
  "project"  a portfolio project page, live at /projects/{slug}

Neither state returns the body of anything. Social posts are not stored
anywhere and are never listed.`;

export function registerListContent(
	server: McpServer,
	deps: { site: Site; github: Github },
): void {
	server.registerTool(
		"list_content",
		{
			description,
			inputSchema: z.object({
				kind: z.enum(["writing", "project"]),
				state: z.enum(["published", "draft"]),
			}),
		},
		async ({ kind, state }) => {
			if (state === "draft") {
				const result = await listDrafts(deps, { kind });

				if (!result.ok) {
					return {
						isError: true,
						content: [{ type: "text", text: result.error }],
					};
				}

				// An empty list is a valid answer, not an error — same treatment
				// as the published branch's empty catalogue.
				if (result.slugs.length === 0) {
					return {
						content: [{ type: "text", text: `No draft ${kind} found.` }],
					};
				}

				return { content: [{ type: "text", text: result.slugs.join("\n") }] };
			}

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
