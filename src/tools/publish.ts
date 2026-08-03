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

revise: pass true to publish changes to something already live, or to
a post whose pull request has already been merged. Without it those
are refused, because changing a live post is deliberate. It is not
needed for an open pull request — publishing the same slug again just
updates it, and leaves one PR rather than two.

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
				// The one argument that lets a live post be changed. Optional and
				// never defaulted: the default has to be the safe one.
				revise: z.boolean().optional(),
			}),
		},
		async ({ kind, slug, show, order, revise }) => {
			const result = await publish(deps, { kind, slug, show, order, revise });

			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text", text: result.error }],
				};
			}

			// The URL leads. It is the thing to click, and the PR body behind it
			// is where the permanent URL and the supplied show/order are stated
			// for a human to check before merging.
			//
			// Which of the three happened has to be said. "Opened" after a second
			// publish is simply false — nothing was opened — and it hides the one
			// fact slice 4 exists to deliver: that there is still only one pull
			// request.
			const opening = {
				created: `Pull request #${result.number} opened: ${result.url}`,
				updated: `Pull request #${result.number} updated: ${result.url}\nThe same pull request now carries this change — publishing again does not open a second one.`,
				recreated: `Pull request #${result.number} opened: ${result.url}\nThe previous pull request for this branch had been closed without merging.`,
			}[result.status];

			// On an update the PR body still describes the FIRST publish, because
			// GitHub does not rewrite it when a branch gains a commit. That body
			// is the only mitigation the design has for a wrong `show`/`order`
			// (design.md → Risks), so the current values are restated here rather
			// than left to a human reading a stale paragraph.
			const supersededBody =
				result.status === "updated"
					? [
							"",
							"The pull request description still describes the first publish. These are the values just written:",
							...(show !== undefined || order !== undefined
								? [`  show: ${show}, order: ${order}`]
								: []),
							"  Check them in the diff before merging.",
						]
					: [];

			const text = [
				opening,
				...supersededBody,
				"",
				"Nothing is live until you merge it. The preview build on the PR is where to check it renders.",
			].join("\n");

			return { content: [{ type: "text", text }] };
		},
	);
}
