import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Github } from "../lib/github";
import type { Site } from "../lib/site";
import { getContent } from "../services/get-content";

// Rewritten for spec 005, not patched — `state` changes what this tool is,
// not just what it takes. The `state` block mirrors `list_content`'s wording
// deliberately: the two tools take the same argument and a model that has
// read one should not have to re-learn the other.
const description = `Read one item back: a draft from the private workshop repo, or a post
already live on the site.

state:
  "published"  live on ashutoshverma.dev. Returns its metadata and body.
               No sha — there is no draft to overwrite.
  "draft"      unpublished, in the private workshop repo. Returns its
               metadata, body and sha.

kind:
  "writing"  a blog entry
  "project"  a portfolio project page

Call this before changing a draft. Editing is read, change, save: get the
draft here, edit the metadata or the body, then call save_draft with the
same kind and slug and the sha this returned. Pass the sha back unchanged
— it is how the server knows the draft has not moved underneath you.

To revise something already published, read it with state "published",
then call save_draft with no sha at all — that is a create. If a draft
already exists at that slug the create is refused, and you should read
that draft instead.

For the catalogue rather than one item, use list_content.`;

export function registerGetContent(
	server: McpServer,
	deps: { github: Github; site: Site },
): void {
	server.registerTool(
		"get_content",
		{
			description,
			inputSchema: z.object({
				kind: z.enum(["writing", "project"]),
				slug: z.string(),
				// Required, not defaulted — mirrors `list_content`, which has shipped
				// that way since spec 004. A default on one but not the other is the
				// kind of asymmetry that costs a turn every time.
				state: z.enum(["published", "draft"]),
			}),
		},
		async ({ kind, slug, state }) => {
			const result = await getContent(deps, { kind, slug, state });

			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text", text: result.error }],
				};
			}

			// The sha must be unmissable: it is the input the next save_draft
			// needs to close the read-modify-write loop. A published read has
			// none, and printing `sha: undefined` would hand the model a string
			// to pass back — so the line is omitted entirely instead.
			const text = [
				...(result.sha ? [`sha: ${result.sha}`, ""] : []),
				JSON.stringify(result.metadata, null, 2),
				"",
				result.body,
			].join("\n");

			return { content: [{ type: "text", text }] };
		},
	);
}
