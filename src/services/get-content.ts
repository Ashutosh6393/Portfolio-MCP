import { draftPath, readDraft } from "../lib/draft";
import { type Github, GithubNotFoundError } from "../lib/github";

// design.md → Approach → `get_content` (lines 312–319).
//
// Purpose:            read a draft back from `workshop` and hand its sha to
//                     the model, which is the input the next `save_draft`
//                     needs to overwrite it.
// Non-responsibilities: no writing, no validating the metadata, no surfacing
//                     the underlying JSON.parse error (ADR-004).
export type GetContentResult =
	| { ok: true; metadata: Record<string, unknown>; body: string; sha: string }
	| { ok: false; error: string };

export async function getContent(
	deps: { github: Github },
	args: { kind: "writing" | "project"; slug: string },
): Promise<GetContentResult> {
	const path = draftPath(args.kind, args.slug);

	let content: string;
	let sha: string;
	try {
		({ content, sha } = await deps.github.readFileWithSha("workshop", path));
	} catch (error) {
		return { ok: false, error: describeReadFailure(error, args) };
	}

	const draft = readDraft(content);
	if (!draft) {
		return {
			ok: false,
			error: `The metadata block in ${path} is not in a shape this server can read. Fix it in GitHub and save the draft again.`,
		};
	}

	return { ok: true, metadata: draft.metadata, body: draft.body, sha };
}

// A 404 never says "it does not exist" as a fact. GitHub answers 404 rather
// than 403 for a private repo a token cannot see, so both causes look the
// same from here (CLAUDE.md → "A 404 might mean the token scope is wrong").
function describeReadFailure(
	error: unknown,
	args: { kind: "writing" | "project"; slug: string },
): string {
	if (error instanceof GithubNotFoundError) {
		return `GitHub could not read the draft at ${args.kind}/${args.slug}. Either it is not there or the token cannot see it.`;
	}
	const message = error instanceof Error ? error.message : "unknown error";
	return `GitHub is unreachable: ${message}`;
}
