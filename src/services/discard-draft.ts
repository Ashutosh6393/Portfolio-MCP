import { draftPath, isSlug } from "../lib/draft";
import { type Github, GithubNotFoundError } from "../lib/github";

// design.md → Approach → `discard_draft` (lines 321–330).
//
// Purpose:            delete a draft from `workshop`.
// Non-responsibilities: no parsing (T-18 — a draft with a broken metadata
//                     block is exactly the one you most want to be able to
//                     throw away), no publishing, no writing.
// `path` rides out so the tool can name what it removed without importing
// `draftPath` itself — a tool may import `lib` only for a `type` (CLAUDE.md →
// Patterns). Same shape as saveDraft's result, for the same reason.
export type DiscardDraftResult =
	| { ok: true; path: string }
	| { ok: false; error: string };

export async function discardDraft(
	deps: { github: Github },
	args: { kind: "writing" | "project"; slug: string },
): Promise<DiscardDraftResult> {
	// The slug becomes a path in a repo this server can delete from — checked
	// before it is ever interpolated into draftPath or handed to GitHub
	// (mirrors save-draft.ts's and get-content.ts's guard; same trust
	// boundary, T-32/T-33, closed here too as T-34).
	if (!isSlug(args.slug)) {
		return {
			ok: false,
			error: `"${args.slug}" is not a valid slug. Use lowercase letters, numbers and hyphens only, e.g. "a-post".`,
		};
	}

	const path = draftPath(args.kind, args.slug);

	// The contents API has no delete-by-path: a delete needs the current sha,
	// so it is read first. Only the sha is used — the content itself is never
	// parsed (T-18).
	let sha: string;
	try {
		({ sha } = await deps.github.readFileWithSha("workshop", path));
	} catch (error) {
		if (error instanceof GithubNotFoundError) {
			// design.md line 326: this exact sentence has been confirmed by the
			// human as the text to ship, ahead of the general 404-ambiguity
			// wording in get-content.ts.
			return {
				ok: false,
				error: `There is no draft at ${args.kind}/${args.slug}.`,
			};
		}
		const message = error instanceof Error ? error.message : "unknown error";
		return { ok: false, error: `GitHub is unreachable: ${message}` };
	}

	// The delete is guarded too, not only the read (T-35). It throws on a 409 if
	// the sha went stale between the two calls, and on a 404 — which is what
	// GitHub answers for a DELETE the token may not make (design.md → Risk 5).
	// Unwrapped, this service rejected instead of returning its union, on the
	// one tool that destroys data. design.md specifies no refusal for a failed
	// delete, so this uses the same fallback as the read rather than inventing
	// a sentence: a stale-sha message would be useless advice for a discard.
	try {
		await deps.github.deleteFile("workshop", path, {
			message: `discard draft: ${args.kind}/${args.slug}`,
			sha,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		return { ok: false, error: `GitHub is unreachable: ${message}` };
	}

	return { ok: true, path };
}
