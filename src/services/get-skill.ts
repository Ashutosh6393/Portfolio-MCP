import type { Github } from "../lib/github";
import { entryListSchema, GithubNotFoundError } from "../lib/github";

// design.md → Approach → Errors: tool failures are returned as results, never
// thrown. That holds at this layer — nothing below throws or rejects.
//
// Purpose:            serve the drafting rules and templates out of `workshop`.
// Non-responsibilities: no fetching (lib does that), no formatting for the
//                     model (the tool does that), no writing.
export type GetSkillResult =
	| { ok: true; skills: string[]; templates: string[] }
	| { ok: false; error: string };

const skillsPath = "skills";
const templatesPath = "templates";

// A name is the filename without its extension. The extension is a fact about
// the file, not about the skill — which is also why nothing here ever builds a
// path by appending one (ADR-003, and the templates landed as .md not .mdx).
const markdown = /\.mdx?$/;

function namesIn(entries: { name: string; type: string }[]): string[] {
	return entries
		.filter((entry) => entry.type === "file" && markdown.test(entry.name))
		.map((entry) => entry.name.replace(markdown, ""));
}

function readNames(
	raw: unknown,
	path: string,
): { ok: true; names: string[] } | { ok: false; error: string } {
	const parsed = entryListSchema.safeParse(raw);
	if (!parsed.success) {
		// zod reports a missing field as "received undefined", which would put the
		// literal string "undefined" into a tool result — so name the failing
		// fields instead of quoting zod. Same treatment as list-content.ts.
		const fields = parsed.error.issues.map((issue) => issue.path.join("."));
		return {
			ok: false,
			error: `GitHub returned the ${path} listing in an unexpected shape (fields: ${fields.join(", ")})`,
		};
	}
	return { ok: true, names: namesIn(parsed.data) };
}

// A 404 never says "it does not exist" as a fact. GitHub answers 404 rather
// than 403 for a private repo a token cannot see, so both causes look the same
// from here and only one of them is about the file.
function describeFailure(error: unknown): string {
	if (error instanceof GithubNotFoundError) {
		return `GitHub could not read ${error.path} from the ${error.repo} repo. Either it is not there or the token cannot see it.`;
	}
	const message = error instanceof Error ? error.message : "unknown error";
	return `GitHub is unreachable: ${message}`;
}

export async function getSkill(
	deps: { github: Github },
	_args: { name?: string },
): Promise<GetSkillResult> {
	let rawSkills: unknown;
	let rawTemplates: unknown;
	try {
		[rawSkills, rawTemplates] = await Promise.all([
			deps.github.listDirectory("workshop", skillsPath),
			deps.github.listDirectory("workshop", templatesPath),
		]);
	} catch (error) {
		return { ok: false, error: describeFailure(error) };
	}

	const skills = readNames(rawSkills, skillsPath);
	if (!skills.ok) return skills;

	const templates = readNames(rawTemplates, templatesPath);
	if (!templates.ok) return templates;

	// design.md → Edge cases: nothing there yet is a valid answer, not an error.
	return { ok: true, skills: skills.names, templates: templates.names };
}
