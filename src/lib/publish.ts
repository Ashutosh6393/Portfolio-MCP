// Where a published post lives, what branch carries it, and what the pull
// request says. Four pure functions, no network, no state.
//
// Purpose:            hold the strings the publish path depends on being
//                     exactly right, in one place, under test.
// Non-responsibilities: no GitHub, no validation, no rendering of the MDX file
//                     itself — `renderDraft` in lib/draft.ts already does that
//                     and is reused unchanged for the published file.
//
// **The singular/plural asymmetry is the whole reason this module exists.**
// The site's directory and its route are `projects`; the domain word is
// `project`; and the branch uses the domain word. So of the three functions
// that take a `kind`, two go plural and one does not. Interpolating any of
// them by hand is how the `s` gets lost, and a file at `content/project/x.mdx`
// produces a PR that looks perfect and a post that never appears.

const kindDirectory = { writing: "writing", project: "projects" } as const;

export function publishedPath(
	kind: "writing" | "project",
	slug: string,
): string {
	return `content/${kindDirectory[kind]}/${slug}.mdx`;
}

// Singular — the branch names the domain concept, not the directory. This is
// the odd one out of the three and it is deliberate: `publish/project/x` reads
// as "publish the project x", which is what it is.
export function branchName(kind: "writing" | "project", slug: string): string {
	return `publish/${kind}/${slug}`;
}

// No scheme. This goes in front of a human in a PR body, where
// `ashutoshverma.dev/writing/x` is what they would type.
export function publicUrl(kind: "writing" | "project", slug: string): string {
	return `ashutoshverma.dev/${kindDirectory[kind]}/${slug}`;
}

export type RenderPrBodyArgs =
	| { kind: "writing"; slug: string; readingTime: string }
	| { kind: "project"; slug: string; show: boolean; order: number };

// Specified in design.md → The PR body. **Not the implementer's to invent, and
// not to be tidied into a summary.** T-39 and T-40 assert it verbatim.
//
// It is the last place a wrong slug or a wrong homepage value can be caught.
// Nothing in code can stop a model inventing `show`/`order` — the server never
// sees the conversation — so these two lines in front of a human are the only
// mitigation there is, and they only work if they stay blunt.
export function renderPrBody(args: RenderPrBodyArgs): string {
	const url = publicUrl(args.kind, args.slug);
	const opening = `-> ${url}\n   This URL is permanent after merge.`;
	const closing = `Publishing ${args.kind}/${args.slug} from the workshop draft.`;

	if (args.kind === "writing") {
		return `${opening}\n\n${closing}\nreadingTime: ${args.readingTime} — computed from the body, not supplied.`;
	}

	// `show` and `order` are printed straight, so `false` and `0` render as
	// themselves rather than vanishing — they are the values most worth
	// checking, and a dropped `show: false` would publish a project onto the
	// homepage nobody asked to put there.
	return `${opening}\n\n   Homepage: show: ${args.show}, order: ${args.order}\n   Supplied, not computed. Fix them in this diff before merging if wrong.\n\n${closing}`;
}

export function pullRequestTitle(
	kind: "writing" | "project",
	slug: string,
): string {
	return `Publish ${kind}: ${slug}`;
}
