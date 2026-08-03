// The GitHub reader and writer. `site.ts` with a token and eight methods — if
// it starts looking like anything else, stop (specs/002-github-access/CLAUDE.md).
//
// Purpose:            read files and directory listings out of the two repos
//                     this server touches, and write to both.
// Constraints:        **This changed in ADR-005 decision 8.** The token used to
//                     be read-only on `portfolio`, and this header used to say
//                     a write aimed there was a bug. It is now `contents: write`
//                     on both repos, because GitHub grants committing to `main`
//                     and opening a pull request through the same permission and
//                     a fine-grained PAT cannot be scoped to a branch.
//
//                     So the guarantee moved out of the token and into two
//                     places: a ruleset on `portfolio`'s `main` that requires a
//                     pull request (proven to refuse this token by M-2,
//                     2026-08-03), and the rule that **every `portfolio` write
//                     names a branch**. Nothing here may target `main`. The
//                     ruleset would refuse it, but the code must never try.
// Non-responsibilities: no parsing (the service owns that), no caching, no
//                     retry, no rate limiting — ~15 calls a week against 5,000
//                     an hour. No merging, ever.

import { z } from "zod";

// A directory listing. Verified live 2026-07-31: an array whose entries carry
// `name` and `type`. Only those two are declared because only those two are
// used — zod strips the rest.
//
// `type` stays `z.string()` rather than an enum. The values seen are "file" and
// "dir", but GitHub also returns "symlink" and "submodule", and an enum would
// fail the whole listing over one odd entry. Same reasoning as `status` in
// site.ts. Callers filter on `type === "file"`, which is safe either way.
export const entryListSchema = z.array(
	z.object({ name: z.string(), type: z.string() }),
);

// A single file's JSON representation. Only `content` (base64) and `sha` are
// declared because only those two are used — zod strips the rest. The `sha` is
// the reason this response is fetched at all: the raw Accept header returns the
// bytes but not the sha, and without it there is no read-modify-write loop.
export const fileContentSchema = z.object({
	content: z.string(),
	sha: z.string(),
});

// `GET /git/ref/heads/{branch}` — the commit a branch points at, which is the
// base a new branch is cut from. Only `object.sha` is declared because only
// `object.sha` is used.
export const refSchema = z.object({ object: z.object({ sha: z.string() }) });

// `POST /pulls`. `html_url` is the browser URL, not the API one — it is what
// gets handed back to a human to click.
export const pullRequestSchema = z.object({
	number: z.number(),
	html_url: z.string(),
});

// `GET /pulls?head=...&state=all`. `merged_at` is how a merged PR is told
// apart from one that was simply closed — `state` is `"closed"` for both, and
// the two need opposite treatment: a merged post is live and must not be
// quietly republished, a closed one was abandoned and can be reopened.
export const pullRequestListSchema = z.array(
	z.object({
		number: z.number(),
		html_url: z.string(),
		state: z.string(),
		merged_at: z.string().nullable(),
	}),
);

// The domain word and the GitHub name are not the same thing. `portfolio` is
// CONTEXT.md vocabulary and is what every doc, error message, and health check
// says; `repoNames` is the single place it becomes a real path. Verified
// 2026-07-31: the site is `Portfolio-new`, not `Portfolio` — the account holds
// three other Portfolio* repos and guessing would point at a 2025 GSAP site.
export type Repo = "portfolio" | "workshop";

const owner = "Ashutosh6393";
const repoNames = { portfolio: "Portfolio-new", workshop: "workshop" } as const;

// Three statuses are worth telling apart, because they are the only ones that
// change what the caller should do next. The service branches on `instanceof`,
// never on the message text (errors-and-validation.md).
//
// The message never claims the path does not exist. GitHub answers 404 rather
// than 403 for a private repo a token cannot see — and, on the write path, for
// a write the token may not make (design.md → Risk 5). So "missing file" and
// "mis-scoped token" are the same response, and stating either as fact would
// send the reader the wrong way half the time.
export class GithubNotFoundError extends Error {
	constructor(
		readonly repo: Repo,
		readonly path: string,
	) {
		super(`Could not read or write ${path} in the ${repo} repo.`);
		this.name = "GithubNotFoundError";
	}
}

// The `sha` sent did not match the file's — it changed underneath us. Not
// retried here: re-reading and re-applying is the caller's decision.
export class GithubConflictError extends Error {
	constructor(
		readonly repo: Repo,
		readonly path: string,
	) {
		super(`${path} in the ${repo} repo changed since it was read.`);
		this.name = "GithubConflictError";
	}
}

// A create — a write with no `sha` — aimed at a path that already holds a file.
export class GithubAlreadyExistsError extends Error {
	constructor(
		readonly repo: Repo,
		readonly path: string,
	) {
		super(`${path} already exists in the ${repo} repo.`);
		this.name = "GithubAlreadyExistsError";
	}
}

export type Github = {
	listDirectory(repo: Repo, path: string): Promise<unknown>;
	readFile(repo: Repo, path: string): Promise<string>;
	// `ref` names a branch to read from. Omitted, GitHub reads the default
	// branch. `publish` needs it to ask whether the file already exists on the
	// publish branch, which decides create versus update.
	readFileWithSha(
		repo: Repo,
		path: string,
		ref?: string,
	): Promise<{ content: string; sha: string }>;
	// `branch` is what keeps a publish off `main`. Omitted, GitHub commits to
	// the repo's default branch — which on `portfolio` is exactly the thing
	// ADR-005 decision 8 exists to prevent.
	//
	// So it is not optional there. The overload makes `branch` **required** for
	// a `portfolio` write and absent from a `workshop` one, which turns "the
	// code must never try" from a convention somebody has to remember into a
	// compile error. The ruleset is the real guarantee; this is the guard that
	// stops a future caller ever reaching it by accident.
	writeFile(
		...args:
			| [
					repo: "workshop",
					path: string,
					content: string,
					options: { message: string; sha?: string },
			  ]
			| [
					repo: "portfolio",
					path: string,
					content: string,
					options: { message: string; sha?: string; branch: string },
			  ]
	): Promise<void>;
	// Narrowed to `workshop`. Nothing deletes from `portfolio` — unpublishing
	// is by hand, with a redirect (design.md → Out of scope) — and now that the
	// token can write there, the type is what says so.
	deleteFile(
		repo: "workshop",
		path: string,
		options: { message: string; sha: string },
	): Promise<void>;

	// The three publish endpoints. All pinned to `portfolio`: there is no
	// branch or pull request on `workshop`, so a `Repo` here would be a
	// parameter with exactly one legal value and one way to get it wrong.
	getBranchHead(repo: "portfolio", branch: string): Promise<string>;
	createBranch(
		repo: "portfolio",
		branch: string,
		fromSha: string,
	): Promise<void>;
	createPullRequest(
		repo: "portfolio",
		options: { title: string; body: string; head: string; base: string },
	): Promise<{ number: number; url: string }>;
	// Found by head branch, never by a number recorded anywhere. The branch
	// name is deterministic — `publish/{kind}/{slug}`, no timestamps — so
	// GitHub can simply be asked. ADR-005 decision 5 rejected writing the
	// number back into the draft: it would invalidate the sha the model is
	// holding, which is a bug, not merely redundant.
	//
	// `null` means no pull request has ever been opened for that branch.
	findPullRequest(
		repo: "portfolio",
		branch: string,
	): Promise<{
		number: number;
		url: string;
		state: string;
		merged: boolean;
	} | null>;
};

// A factory, not a singleton like `site`: the token arrives from the parsed env
// at boot, so it never reaches module scope and a test can build a fake without
// one (design.md → The reader takes its token at construction).
export function createGithub(token: string): Github {
	// The auth header, the API version and the status mapping are built once
	// here and shared by every endpoint this file touches.
	//
	// `endpoint` is everything after `/repos/{owner}/{repo}/` — `contents/...`
	// for the five original methods, and `git/refs`, `git/ref/...` or `pulls`
	// for the publish path. It was hardcoded to `contents/{path}` until spec
	// 005 needed the three non-contents endpoints to share the same status
	// mapping and the same auth header.
	//
	// `subject` is what an error names, and it is deliberately not the
	// endpoint: the contents methods report the bare file path, so keeping it
	// separate is what makes this refactor invisible to their messages and to
	// the five services that read them.
	async function request(
		repo: Repo,
		endpoint: string,
		init: {
			method: string;
			accept: string;
			body?: Record<string, unknown>;
			// What a 422 means on this endpoint. The contents API infers it from
			// the body (a write with no `sha` is a create), but that inference is
			// wrong for `git/refs`, whose body always carries a `sha` — the commit
			// to branch from — and which answers 422 when the ref already exists.
			// So the caller can state it instead of having it guessed.
			alreadyExistsOn422?: boolean;
		},
		subject: string = endpoint,
	) {
		const response = await fetch(
			`https://api.github.com/repos/${owner}/${repoNames[repo]}/${endpoint}`,
			{
				method: init.method,
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: init.accept,
					"X-GitHub-Api-Version": "2022-11-28",
					// Set explicitly: fetch labels a string body `text/plain`, and
					// the write path is not exercised by any automated test, so a
					// body GitHub declines to parse would first surface in M-1.
					...(init.body ? { "Content-Type": "application/json" } : {}),
				},
				body: init.body ? JSON.stringify(init.body) : undefined,
			},
		);
		if (response.status === 404) {
			throw new GithubNotFoundError(repo, subject);
		}
		// 409 and 422 are verified, not assumed: M-1 made both rejections happen
		// against the real repo on 2026-08-02 and the live API returned exactly
		// these (specs/004-drafts/design.md). If a future GitHub change moves
		// them, correct them here — never by second-guessing in the service.
		if (response.status === 409) {
			throw new GithubConflictError(repo, subject);
		}
		// On the contents API, 422 only means "already exists" on a create — a
		// write that sent no `sha`. With a `sha` the same status means something
		// else entirely. Other endpoints say so explicitly instead.
		const alreadyExists =
			init.alreadyExistsOn422 ?? (!!init.body && !("sha" in init.body));
		if (response.status === 422 && alreadyExists) {
			throw new GithubAlreadyExistsError(repo, subject);
		}
		if (!response.ok) {
			throw new Error(
				`GitHub returned ${response.status} on the ${repo} repo.`,
			);
		}
		return response;
	}

	// The contents endpoint — what all five of the pre-spec-005 methods use.
	// It exists so the `contents/` prefix and the "errors name the bare path"
	// rule are written once rather than at every call site.
	function contents(
		repo: Repo,
		path: string,
		init: { method: string; accept: string; body?: Record<string, unknown> },
	) {
		return request(repo, `contents/${path}`, init, path);
	}

	return {
		// Returns `unknown` on purpose, same as site.fetchContent: the parse
		// belongs to the service, so a test can hand it garbage without a cast
		// and still exercise the real schema.
		async listDirectory(repo, path) {
			const response = await contents(repo, path, {
				method: "GET",
				accept: "application/vnd.github+json",
			});
			return response.json();
		},

		// Verified against the live API on 2026-07-31: the raw Accept header
		// returns the file's bytes as text, content-type
		// `application/vnd.github.raw`. That deletes both the base64 decode and
		// the 1 MB cliff where the default JSON response returns an empty
		// `content` field rather than erroring. No schema — `text()` is already
		// `string`, so there is nothing to validate.
		async readFile(repo, path) {
			const response = await contents(repo, path, {
				method: "GET",
				accept: "application/vnd.github.raw",
			});
			return response.text();
		},

		// The raw Accept header cannot be used here: it returns the bytes but not
		// the `sha`, and the sha is what closes the read-modify-write loop. So
		// this takes the JSON response and pays for it with a decode.
		async readFileWithSha(repo, path, ref) {
			// `request` directly rather than `contents`, so the `?ref=` query
			// stays out of the error subject — an error should name the file, not
			// the URL it was fetched with.
			const response = await request(
				repo,
				`contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`,
				{ method: "GET", accept: "application/vnd.github+json" },
				path,
			);
			const file = fileContentSchema.parse(await response.json());
			// ADR-002 said no base64 decoder was needed; ADR-004 amends it, and
			// this is the one line that came back. `Buffer`, never `atob`: GitHub
			// wraps its base64 at 60 characters and `atob` throws on the embedded
			// newlines.
			return {
				content: Buffer.from(file.content, "base64").toString("utf8"),
				sha: file.sha,
			};
		},

		// No `author` field is sent. A fine-grained PAT already is the user, so
		// GitHub attributes the commit correctly (design.md → Commit authorship).
		// Omitting `sha` means create; supplying it means update-if-unchanged.
		async writeFile(repo, path, content, options) {
			await contents(repo, path, {
				method: "PUT",
				accept: "application/vnd.github+json",
				body: {
					message: options.message,
					content: Buffer.from(content, "utf8").toString("base64"),
					...(options.sha ? { sha: options.sha } : {}),
					// Absent for a `workshop` draft, required for a `portfolio`
					// publish — the overload above is what enforces that. Without it
					// GitHub writes to the default branch.
					...("branch" in options ? { branch: options.branch } : {}),
				},
			});
		},

		async getBranchHead(repo, branch) {
			const response = await request(
				repo,
				`git/ref/heads/${branch}`,
				{ method: "GET", accept: "application/vnd.github+json" },
				branch,
			);
			return refSchema.parse(await response.json()).object.sha;
		},

		// A 422 here means the ref already exists, which is a clean refusal
		// rather than a crash: publishing the same slug twice must not silently
		// overwrite the branch (T-41). Slice 4 turns that into an update.
		//
		// `POST /git/refs` also answers 422 for a bad base sha and an invalid
		// ref name, which would both be reported as "already exists". Neither is
		// reachable from here — `fromSha` comes from `getBranchHead` and the
		// branch name is built from an `isSlug`-guarded slug — so the trade is
		// deliberate rather than overlooked.
		async createBranch(repo, branch, fromSha) {
			await request(
				repo,
				"git/refs",
				{
					method: "POST",
					accept: "application/vnd.github+json",
					body: { ref: `refs/heads/${branch}`, sha: fromSha },
					alreadyExistsOn422: true,
				},
				branch,
			);
		},

		// `html_url` is returned, not the API url — a human clicks this.
		async createPullRequest(repo, options) {
			const response = await request(
				repo,
				"pulls",
				{
					method: "POST",
					accept: "application/vnd.github+json",
					body: options,
					// A PR for this head already being open is not "already exists"
					// in the sense the contents API means. Slice 4 finds it by branch
					// name instead of guessing from a status code.
					alreadyExistsOn422: false,
				},
				options.head,
			);
			const pull = pullRequestSchema.parse(await response.json());
			return { number: pull.number, url: pull.html_url };
		},

		// `state=all` matters: the default is `open`, which would report a
		// merged or closed pull request as "never existed" and silently
		// republish something that was deliberately abandoned or already live.
		async findPullRequest(repo, branch) {
			const response = await request(
				repo,
				// `sort` and `direction` are stated rather than relied on. They
				// happen to be the endpoint's defaults, but a default is not a
				// contract, and which pull request is "latest" decides whether a
				// live post can be amended without `revise`.
				`pulls?head=${owner}:${branch}&state=all&sort=created&direction=desc`,
				{ method: "GET", accept: "application/vnd.github+json" },
				branch,
			);
			const pulls = pullRequestListSchema.parse(await response.json());
			const latest = pulls[0];
			if (!latest) return null;
			return {
				number: latest.number,
				url: latest.html_url,
				state: latest.state,
				// **Any** merge in this branch's history, not just the latest pull
				// request's. The question the caller is really asking is "has this
				// post ever gone live", and the answer has to survive a later
				// abandoned pull request on the same branch: merge #42, open and
				// close #57, and reading only #57 would say "never merged" and let
				// a live post be amended without `revise`.
				//
				// `state` is "closed" for a merged and an abandoned one alike, so
				// `merged_at` is the only field that can answer this.
				merged: pulls.some((pull) => pull.merged_at !== null),
			};
		},

		// `sha` is required: the contents API has no delete-by-path.
		async deleteFile(repo, path, options) {
			await contents(repo, path, {
				method: "DELETE",
				accept: "application/vnd.github+json",
				body: { message: options.message, sha: options.sha },
			});
		},
	};
}
