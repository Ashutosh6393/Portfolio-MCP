import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Github } from "../lib/github";
import type { Site } from "../lib/site";
import { publish } from "../services/publish";

// The sixth and last tool, and the only one that reaches the public repo.
//
// The description carries two things nothing in code can enforce: that the
// merge is still a human's, and that `show`/`order` are asked for rather than
// guessed. The server never sees the conversation, so it can never verify the
// question was put — the PR body is the backstop, not this text (ADR-005
// decision 4).
const description = `Publish a draft: open a pull request that adds it to the live site.

This does not make anything live. It opens a PR you merge yourself, and
the Vercel preview build on that PR is where you check the post renders.
Nothing here can merge.

kind:
  "writing"  a blog entry, live at /writing/{slug}
  "project"  a portfolio project page, live at /projects/{slug}

show and order are required for a project and refused for a writing.
They control the homepage and they are not computed — ask which the
project should have and pass the answer. list_content shows what the
live projects use today.

The draft's metadata is checked against the site's own schema first. If
a field is missing or wrong the whole list comes back at once and
nothing is written. readingTime is computed from the body — do not
supply it.

The slug becomes the permanent public URL after merge.`;

export function registerPublish(
	server: McpServer,
	deps: { site: Site; github: Github },
): void {
	server.registerTool(
		"publish",
		{
			description,
			inputSchema: z.object({
				kind: z.enum(["writing", "project"]),
				slug: z.string(),
				// Optional in the schema, required by the service for a project and
				// refused for a writing. The rule depends on `kind`, so the service
				// owns it and can say why — a Zod refusal here would only say the
				// shape was wrong.
				show: z.boolean().optional(),
				order: z.number().optional(),
			}),
		},
		async ({ kind, slug, show, order }) => {
			const result = await publish(deps, { kind, slug, show, order });

			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text", text: result.error }],
				};
			}

			// The URL leads. It is the thing to click, and the PR body behind it
			// is where the permanent URL and the supplied show/order are stated
			// for a human to check before merging.
			const text = [
				`Pull request #${result.number} opened: ${result.url}`,
				"",
				"Nothing is live until you merge it. The preview build on the PR is where to check it renders.",
			].join("\n");

			return { content: [{ type: "text", text }] };
		},
	);
}
