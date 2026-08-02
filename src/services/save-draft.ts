import { draftPath, isSlug, renderDraft } from "../lib/draft";
import type { Github } from "../lib/github";
import type { Site } from "../lib/site";
import { listContent } from "./list-content";

// design.md → Approach → `save_draft` (lines 274–311). This task is the
// create path only: no `sha`, no `GithubConflictError` /
// `GithubAlreadyExistsError` handling — those arrive with the update path.
//
// Purpose:            write a draft into `workshop`, refusing to shadow a
//                     published slug or accept a slug that is not a safe path
//                     segment.
// Non-responsibilities: no metadata validation (never — see CLAUDE.md → Don't),
//                     no writes to `portfolio`, no reading a draft back.
export type SaveDraftResult =
	| { ok: true; path: string }
	| { ok: false; error: string };

// Keys the server derives itself and never accepts from a caller: `show` and
// `order` are curation the site's admin owns, `readingTime` is computed from
// the body. Dropped silently — this is not validation and it never refuses
// (CLAUDE.md → Don't validate metadata at save).
const reservedKeys = new Set(["show", "order", "readingTime"]);

function withoutReservedKeys(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(metadata).filter(([key]) => !reservedKeys.has(key)),
	);
}

export async function saveDraft(
	deps: { site: Site; github: Github },
	args: {
		kind: "writing" | "project";
		slug: string;
		metadata: Record<string, unknown>;
		body: string;
		sha?: string;
	},
): Promise<SaveDraftResult> {
	// The slug becomes a path in a repo this server can write to and delete
	// from — checked before anything that would name the site, so a bad slug
	// never leaks which check ran first (T-32).
	if (!isSlug(args.slug)) {
		return {
			ok: false,
			error: `"${args.slug}" is not a valid slug. Use lowercase letters, numbers and hyphens only, e.g. "a-post".`,
		};
	}

	const published = await listContent(deps, { kind: args.kind });
	if (!published.ok) return published;

	const shadowed = published.items.some((item) => item.slug === args.slug);
	if (shadowed) {
		return {
			ok: false,
			error: `A published ${args.kind} with the slug "${args.slug}" already exists. Choose a different slug or edit the published item instead.`,
		};
	}

	const metadata = withoutReservedKeys(args.metadata);
	const text = renderDraft(metadata, args.body);
	const path = draftPath(args.kind, args.slug);

	await deps.github.writeFile("workshop", path, text, {
		message: `save draft: ${args.kind}/${args.slug}`,
		sha: args.sha,
	});

	return { ok: true, path };
}
