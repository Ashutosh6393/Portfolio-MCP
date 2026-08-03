import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Github } from "../lib/github";
import type { Site } from "../lib/site";
import { saveDraft } from "../services/save-draft";

// The slug paragraph gained its second and third sentences in spec 005
// (ADR-005 decision 4b). Nothing else here changed, and `save_draft`'s
// behaviour is untouched — drafts are still not validated (ADR-004).
//
// The instruction has no enforcement and cannot have any: the server never
// sees the conversation, so it can never know whether the question was
// asked. Refusing a slug that matches the kebab-cased title was considered
// and rejected — that is very often the slug a human would genuinely choose,
// so it would refuse the correct answer most of the time. The backstop is
// the PR body, which leads with the permanent URL.
const description = `Save a draft of a writing or a project to the private workshop repo.

Drafts are not validated and they are not published. Any JSON object is
accepted as metadata — a draft with only a title is fine. Missing fields
are asked for when you publish, not here.

kind:
  "writing"  a blog entry
  "project"  a portfolio project page

slug is the kebab-case URL segment the draft is filed under. It must not
already be published. It becomes the permanent public URL once the post
is merged, so if the human has not named one, ask — do not derive it
from the title.

Saving without a sha creates a new draft, and fails if one already exists
at that slug. To change an existing draft, call get_content first, edit
what it returns, and pass its sha back here. That is the only way to
overwrite a draft: nothing can be replaced that was not read first.

Do not set show, order or readingTime. Those are not yours to choose and
they are dropped.`;

export function registerSaveDraft(
	server: McpServer,
	deps: { site: Site; github: Github },
): void {
	server.registerTool(
		"save_draft",
		{
			description,
			inputSchema: z.object({
				kind: z.enum(["writing", "project"]),
				slug: z.string(),
				metadata: z.record(z.string(), z.unknown()),
				body: z.string(),
				sha: z.string().optional(),
			}),
		},
		async ({ kind, slug, metadata, body, sha }) => {
			const result = await saveDraft(deps, { kind, slug, metadata, body, sha });

			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text", text: result.error }],
				};
			}

			return {
				content: [{ type: "text", text: `Saved to ${result.path}.` }],
			};
		},
	);
}
