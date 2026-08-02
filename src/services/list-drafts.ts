import type { Github } from "../lib/github";
import { entryListSchema, GithubNotFoundError } from "../lib/github";

// design.md → Approach → `list_content`(draft) (lines 331–350).
//
// Purpose:            list the slugs of the drafts of a kind.
// Non-responsibilities: no reading, no parsing — slugs only, never a title,
//                     which would cost one API call per draft.
export type ListDraftsResult =
	| { ok: true; slugs: string[] }
	| { ok: false; error: string };

const mdx = /\.mdx$/;

export async function listDrafts(
	deps: { github: Github },
	args: { kind: "writing" | "project" },
): Promise<ListDraftsResult> {
	const path = `drafts/${args.kind}`;

	let raw: unknown;
	try {
		raw = await deps.github.listDirectory("workshop", path);
	} catch (error) {
		// drafts/{kind}/ does not exist until the first draft of that kind is
		// saved — a 404 here is an empty list, not an error (design.md: the
		// failure most likely to be mistaken for a bug).
		if (error instanceof GithubNotFoundError) {
			return { ok: true, slugs: [] };
		}
		const message = error instanceof Error ? error.message : "unknown error";
		return { ok: false, error: `GitHub is unreachable: ${message}` };
	}

	const parsed = entryListSchema.safeParse(raw);
	if (!parsed.success) {
		// zod reports a missing field as "received undefined", which would put
		// the literal string "undefined" into a tool result — so name the
		// failing fields instead of quoting zod. Same treatment as
		// get-skill.ts and list-content.ts.
		const fields = parsed.error.issues.map((issue) => issue.path.join("."));
		return {
			ok: false,
			error: `GitHub returned the ${path} listing in an unexpected shape (fields: ${fields.join(", ")})`,
		};
	}

	const slugs = parsed.data
		.filter((entry) => entry.type === "file" && mdx.test(entry.name))
		.map((entry) => entry.name.replace(mdx, ""));

	return { ok: true, slugs };
}
