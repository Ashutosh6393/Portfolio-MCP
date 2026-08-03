import { draftPath, isSlug, readDraft, renderDraft } from "../lib/draft";
import {
	type Github,
	GithubAlreadyExistsError,
	GithubNotFoundError,
} from "../lib/github";
import {
	branchName,
	publicUrl,
	publishedPath,
	pullRequestTitle,
	renderPrBody,
} from "../lib/publish";
import { readingTime } from "../lib/reading-time";
import type { Site } from "../lib/site";
import { validate } from "../lib/validate";
import { listContent } from "./list-content";

// The sixth tool's service, and the only one that writes to the public repo.
//
// Purpose:            take a draft out of `workshop`, check it against the
//                     site's own live schema, and offer it as a pull request.
// Non-responsibilities: no merging, ever (no tool in this repo touches the
//                     merge button), no MDX parse (ADR-005 decision 2 — the
//                     Vercel preview build is the check), no second
//                     serializer, no writing to `main`.
//
// Four steps and no branching until the last one. Every step returns a refusal
// rather than throwing, in the union every service here uses.
export type PublishResult =
	| { ok: true; url: string; number: number }
	| { ok: false; error: string };

export async function publish(
	deps: { github: Github; site: Site },
	args: {
		kind: "writing" | "project";
		slug: string;
		show?: boolean;
		order?: number;
	},
): Promise<PublishResult> {
	// First, before anything names the site or GitHub. The slug becomes a path
	// in the public repo and a branch name, so a traversal slug has to fail
	// here and nowhere later (T-38).
	if (!isSlug(args.slug)) {
		return {
			ok: false,
			error: `"${args.slug}" is not a valid slug. Use lowercase letters, numbers and hyphens only, e.g. "a-post".`,
		};
	}

	// `show` and `order` are curation the site owns and the writing schema has
	// neither key, so `additionalProperties: false` would reject them anyway.
	// Refusing here says why, instead of surfacing a schema error about a field
	// the caller was never allowed to send.
	if (
		args.kind === "writing" &&
		(args.show !== undefined || args.order !== undefined)
	) {
		return {
			ok: false,
			error:
				"show and order apply to projects only. A writing has neither — remove them and publish again.",
		};
	}

	if (
		args.kind === "project" &&
		(args.show === undefined || args.order === undefined)
	) {
		return {
			ok: false,
			error: `Publishing a project needs show and order. They are not computed — ask which the project should have, then pass both. The current values are in list_content.`,
		};
	}

	const published = await listContent(deps, { kind: args.kind });
	if (!published.ok) return published;

	if (published.items.some((item) => item.slug === args.slug)) {
		return {
			ok: false,
			error: `${args.kind}/${args.slug} is already published. Editing a live post is not built yet — change it on the site by hand.`,
		};
	}

	const source = draftPath(args.kind, args.slug);
	let draftText: string;
	try {
		({ content: draftText } = await deps.github.readFileWithSha(
			"workshop",
			source,
		));
	} catch (error) {
		if (error instanceof GithubNotFoundError) {
			return {
				ok: false,
				error: `There is no draft at ${args.kind}/${args.slug}, or the token cannot see it. Check the slug with list_content.`,
			};
		}
		return { ok: false, error: describeGithubFailure(error) };
	}

	const draft = readDraft(draftText);
	if (!draft) {
		return {
			ok: false,
			error: `The metadata block in ${source} is not in a shape this server can read. Fix it in GitHub and save the draft again.`,
		};
	}

	let schema: Record<string, unknown>;
	try {
		schema = (await deps.site.fetchSchema())[args.kind];
	} catch {
		// No detail carried: the message is a Zod dump or a network error and
		// neither helps on a phone. What matters is that publish refuses rather
		// than guessing at what valid means (CLAUDE.md → Don't).
		return {
			ok: false,
			error:
				"The site's schema could not be fetched, so this draft cannot be validated. Nothing was written. Try again when ashutoshverma.dev is reachable.",
		};
	}

	// `readingTime` is computed, never taken from the draft — `save_draft`
	// strips it, so a draft carrying one is a bug elsewhere. It goes in BEFORE
	// validation because the schema requires it.
	const validated: Record<string, unknown> = {
		...draft.metadata,
		...(args.kind === "writing"
			? { readingTime: readingTime(draft.body) }
			: {}),
	};

	const errors = validate(schema, validated);
	if (errors.length > 0) {
		// Every error at once. One field per turn costs four round trips on a
		// new writing.
		return {
			ok: false,
			error: `This draft is not ready to publish:\n${errors.map((error) => `- ${error}`).join("\n")}`,
		};
	}

	// **After validation, never before.** The write schema is
	// `additionalProperties: false` and omits both keys, so attaching first
	// fails every project publish; skipping the attach drops a featured project
	// off the homepage. T-31 asserts the ordering, not just the result.
	const metadata: Record<string, unknown> =
		args.kind === "project"
			? { ...validated, show: args.show, order: args.order }
			: validated;

	const branch = branchName(args.kind, args.slug);
	const destination = publishedPath(args.kind, args.slug);

	let base: string;
	try {
		base = await deps.github.getBranchHead("portfolio", "main");
	} catch (error) {
		return { ok: false, error: describeGithubFailure(error) };
	}

	try {
		await deps.github.createBranch("portfolio", branch, base);
	} catch (error) {
		// A clean refusal, not a crash and not a silent overwrite. Slice 4 turns
		// this into an update of the existing branch.
		if (error instanceof GithubAlreadyExistsError) {
			return {
				ok: false,
				error: `The branch ${branch} already exists, so this may have been published before. Open or close its pull request on GitHub, then try again.`,
			};
		}
		return { ok: false, error: describeGithubFailure(error) };
	}

	try {
		// `renderDraft` is reused unchanged — no second serializer, no
		// hand-rolled JS string escaping (design.md → The published file format).
		await deps.github.writeFile(
			"portfolio",
			destination,
			renderDraft(metadata, draft.body),
			{
				message: `publish ${args.kind}: ${args.slug}`,
				// Never omitted. Without it GitHub commits to the default branch,
				// which is the one thing this whole design exists to prevent.
				branch,
			},
		);

		const pull = await deps.github.createPullRequest("portfolio", {
			title: pullRequestTitle(args.kind, args.slug),
			body:
				args.kind === "writing"
					? renderPrBody({
							kind: "writing",
							slug: args.slug,
							readingTime: String(validated.readingTime),
						})
					: renderPrBody({
							kind: "project",
							slug: args.slug,
							show: args.show as boolean,
							order: args.order as number,
						}),
			head: branch,
			base: "main",
		});

		return { ok: true, url: pull.url, number: pull.number };
	} catch (error) {
		// The branch survives a failure here on purpose. Deleting it would throw
		// away the commit, and the branch name is deterministic, so a retry
		// finds it rather than duplicating work.
		return {
			ok: false,
			error: `${describeGithubFailure(error)} The branch ${branch} may exist — check ${publicUrl(args.kind, args.slug)} has no open pull request before retrying.`,
		};
	}
}

// A 404 never claims the path is absent. GitHub answers 404, not 403, for a
// write the token may not make, so "missing" and "mis-scoped token" are the
// same response from here.
function describeGithubFailure(error: unknown): string {
	if (error instanceof GithubNotFoundError) {
		return "GitHub refused the request. Either the path is not there or the token cannot reach it.";
	}
	const message = error instanceof Error ? error.message : "unknown error";
	return `GitHub is unreachable: ${message}`;
}
