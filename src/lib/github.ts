// The GitHub reader. `site.ts` with a token and two methods — if it starts
// looking like anything else, stop (specs/002-github-access/CLAUDE.md).
//
// Purpose:            read files and directory listings out of the two repos
//                     this server touches.
// Non-responsibilities: no parsing (the service owns that), no writing (the
//                     token is read-only), no caching, no retry, no rate
//                     limiting — ~15 calls a week against 5,000 an hour.

// The domain word and the GitHub name are not the same thing. `portfolio` is
// CONTEXT.md vocabulary and is what every doc, error message, and health check
// says; `repoNames` is the single place it becomes a real path. Verified
// 2026-07-31: the site is `Portfolio-new`, not `Portfolio` — the account holds
// three other Portfolio* repos and guessing would point at a 2025 GSAP site.
export type Repo = "portfolio" | "workshop";

const owner = "Ashutosh6393";
const repoNames = { portfolio: "Portfolio-new", workshop: "workshop" } as const;

// 404 is the only status worth telling apart, because it is the only one that
// changes what the caller should do next. The service branches on `instanceof`,
// never on the message text (errors-and-validation.md).
//
// The message never claims the path does not exist. GitHub answers 404 rather
// than 403 for a private repo a token cannot see, so "missing file" and
// "mis-scoped token" are the same response, and stating either as fact would
// send the reader the wrong way half the time.
export class GithubNotFoundError extends Error {
	constructor(
		readonly repo: Repo,
		readonly path: string,
	) {
		super(`Could not read ${path} from the ${repo} repo.`);
		this.name = "GithubNotFoundError";
	}
}

export type Github = {
	listDirectory(repo: Repo, path: string): Promise<unknown>;
	readFile(repo: Repo, path: string): Promise<string>;
};

// A factory, not a singleton like `site`: the token arrives from the parsed env
// at boot, so it never reaches module scope and a test can build a fake without
// one (design.md → The reader takes its token at construction).
export function createGithub(token: string): Github {
	async function read(repo: Repo, path: string, accept: string) {
		const response = await fetch(
			`https://api.github.com/repos/${owner}/${repoNames[repo]}/contents/${path}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: accept,
					"X-GitHub-Api-Version": "2022-11-28",
				},
			},
		);
		if (response.status === 404) {
			throw new GithubNotFoundError(repo, path);
		}
		if (!response.ok) {
			throw new Error(
				`GitHub returned ${response.status} reading the ${repo} repo.`,
			);
		}
		return response;
	}

	return {
		// Returns `unknown` on purpose, same as site.fetchContent: the parse
		// belongs to the service, so a test can hand it garbage without a cast
		// and still exercise the real schema.
		async listDirectory(repo, path) {
			const response = await read(repo, path, "application/vnd.github+json");
			return response.json();
		},

		// Verified against the live API on 2026-07-31: the raw Accept header
		// returns the file's bytes as text, content-type
		// `application/vnd.github.raw`. That deletes both the base64 decode and
		// the 1 MB cliff where the default JSON response returns an empty
		// `content` field rather than erroring. No schema — `text()` is already
		// `string`, so there is nothing to validate.
		async readFile(repo, path) {
			const response = await read(repo, path, "application/vnd.github.raw");
			return response.text();
		},
	};
}
