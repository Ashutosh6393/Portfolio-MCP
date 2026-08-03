import { draftPath, isSlug, readDraft } from "../lib/draft";
import { type Github, GithubNotFoundError } from "../lib/github";
import { type Site, SiteNotFoundError } from "../lib/site";

// design.md → Approach → `get_content` (lines 312–319), extended by
// specs/005-publish/design.md → `get_content` gains `state`.
//
// Purpose:            read one item back — a draft from `workshop` with its
//                     sha, or a published post from the live site — so it can
//                     be edited from a phone.
// Non-responsibilities: no writing, no validating the metadata, no surfacing
//                     the underlying JSON.parse error (ADR-004).
//
// The two states read from different places on purpose. A published file in
// `portfolio` is a hand-written JS object literal, so `readDraft` pointed at
// one returns null or plausible-looking wrong metadata. The site's API imports
// the real object (ADR-005 decision 7), so published reads go there and never
// through GitHub — T-25 holds that line.
//
// Only a draft carries a `sha`. There is no published file to overwrite, so
// there is nothing to hand back: the next step is `save_draft` with no sha at
// all, which is a create.
export type GetContentResult =
	| { ok: true; metadata: Record<string, unknown>; body: string; sha?: string }
	| { ok: false; error: string };

export async function getContent(
	deps: { github: Github; site: Site },
	args: {
		kind: "writing" | "project";
		slug: string;
		state: "published" | "draft";
	},
): Promise<GetContentResult> {
	// The slug becomes a path in a repo this server can read from — checked
	// before it is ever interpolated into draftPath or handed to GitHub
	// (mirrors save-draft.ts's guard; same trust boundary, T-32).
	if (!isSlug(args.slug)) {
		return {
			ok: false,
			error: `"${args.slug}" is not a valid slug. Use lowercase letters, numbers and hyphens only, e.g. "a-post".`,
		};
	}

	// The guard above runs for both states, so a traversal slug never reaches
	// the site either (T-22).
	if (args.state === "published") {
		try {
			const document = await deps.site.fetchDocument(args.kind, args.slug);
			return { ok: true, metadata: document.metadata, body: document.body };
		} catch (error) {
			return { ok: false, error: describePublishedReadFailure(error, args) };
		}
	}

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

// Unlike the GitHub case below, a 404 from the site IS a fact: the site is
// public, so no token scope can hide a post that exists. Saying so plainly is
// the useful answer — the slug is wrong, or the post was never published.
function describePublishedReadFailure(
	error: unknown,
	args: { kind: "writing" | "project"; slug: string },
): string {
	if (error instanceof SiteNotFoundError) {
		return `There is no published ${args.kind} at "${args.slug}". Check the slug with list_content.`;
	}
	const message = error instanceof Error ? error.message : "unknown error";
	return `ashutoshverma.dev is unreachable: ${message}`;
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
