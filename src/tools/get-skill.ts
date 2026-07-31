import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Github } from "../lib/github";
import { getSkill } from "../services/get-skill";

// design.md → Approach → The tool description: specified verbatim, not authored
// here. Never reword. The third paragraph is the load-bearing one — on mobile
// there is no skill system, so the model drafts in generic voice and never
// calls this tool unless the description tells it to. Only registered tools may
// be named here, which is why list_content appears and nothing else does.
const description = `Get a skill: the rules for drafting one kind of content, or the template
one kind of content goes into. Both come with the author's voice.

With no name, returns the available skills and templates.
With a name, returns that skill's rules or that template — always
together with the voice they are meant to be written in.

Call this before drafting anything. The voice is not otherwise in your
context, and drafting without it produces generic output that reads
nothing like the author.

Skills and templates are private. They are separate from the published
content that list_content returns.`;

const voiceHeading = "# The author's voice (be-human)";

export function registerGetSkill(
	server: McpServer,
	deps: { github: Github },
): void {
	server.registerTool(
		"get_skill",
		{
			description,
			// Optional, because calling it with no arguments is the mode that says
			// what exists. A required name would make that mode unreachable.
			inputSchema: z.object({ name: z.string().optional() }),
		},
		async ({ name }) => {
			const result = await getSkill(deps, { name });

			if (!result.ok) {
				return {
					isError: true,
					content: [{ type: "text", text: result.error }],
				};
			}

			if ("skills" in result) {
				// design.md → Edge cases: an empty workshop is a valid answer, not an
				// error — say so in words, the same way list_content does.
				if (result.skills.length === 0 && result.templates.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "No skills or templates found in the workshop repo.",
							},
						],
					};
				}
				const text = [
					`Skills: ${result.skills.join(", ") || "none"}`,
					`Templates: ${result.templates.join(", ") || "none"}`,
					"",
					"Call get_skill again with one of these names to get it, together with the voice.",
				].join("\n");
				return { content: [{ type: "text", text }] };
			}

			// The voice asked for by name — returned once, under its own heading.
			if (!("instructions" in result) && !("template" in result)) {
				return {
					content: [
						{ type: "text", text: `${voiceHeading}\n\n${result.voice}` },
					],
				};
			}

			const body =
				"instructions" in result
					? `# ${name} — how to write it\n\n${result.instructions}`
					: `# ${name} — the template to fill in\n\n${result.template}`;

			// Voice first: it applies to everything below it.
			return {
				content: [
					{
						type: "text",
						text: `${voiceHeading}\n\n${result.voice}\n\n${body}`,
					},
				],
			};
		},
	);
}
