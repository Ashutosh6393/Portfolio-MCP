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
	| { ok: true; voice: string; instructions: string }
	| { ok: true; voice: string; template: string }
	| { ok: true; voice: string }
	| { ok: false; error: string };

const skillsPath = "skills";
const templatesPath = "templates";

// be-human is the voice under everything else, so it rides along with every
// named answer (ADR-003). Its absence is a hard error, never a quiet fall-back:
// structure without voice is the one failure here that ships bad output and
// looks fine doing it.
const voiceName = "be-human";

// A name is the filename without its extension. The extension is a fact about
// the file, not about the skill — which is why nothing here ever builds a path
// by appending one. ADR-003 assumed `.mdx` for templates and they landed as
// `.md`; resolving from the listing is what made that a non-event.
const markdown = /\.mdx?$/;

type Entry = { name: string; file: string };

function entriesIn(raw: { name: string; type: string }[]): Entry[] {
	return raw
		.filter((entry) => entry.type === "file" && markdown.test(entry.name))
		.map((entry) => ({
			name: entry.name.replace(markdown, ""),
			file: entry.name,
		}));
}

function readEntries(
	raw: unknown,
	path: string,
): { ok: true; entries: Entry[] } | { ok: false; error: string } {
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
	return { ok: true, entries: entriesIn(parsed.data) };
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
	args: { name?: string },
): Promise<GetSkillResult> {
	// Round 1: both listings, in parallel. A named call resolves against these
	// rather than guessing a path, which is also what lets an unknown name
	// answer with the real lists already in hand — no extra call on the error
	// path (design.md → Approach → `get_skill`).
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

	const skills = readEntries(rawSkills, skillsPath);
	if (!skills.ok) return skills;

	const templates = readEntries(rawTemplates, templatesPath);
	if (!templates.ok) return templates;

	// design.md → Edge cases: nothing there yet is a valid answer, not an error.
	if (args.name === undefined) {
		return {
			ok: true,
			skills: skills.entries.map((entry) => entry.name),
			templates: templates.entries.map((entry) => entry.name),
		};
	}

	const voice = skills.entries.find((entry) => entry.name === voiceName);
	if (!voice) {
		return {
			ok: false,
			error: `The voice file ${skillsPath}/${voiceName} is missing from the workshop repo. Every skill and template is served with it, so nothing is returned without it.`,
		};
	}

	// `skills` is searched before `templates`. Only matters if one name is in
	// both, which is not defended against — see design.md → Edge cases.
	const skill = skills.entries.find((entry) => entry.name === args.name);
	const template = templates.entries.find((entry) => entry.name === args.name);
	const target = skill
		? { dir: skillsPath, entry: skill, isSkill: true as const }
		: template
			? { dir: templatesPath, entry: template, isSkill: false as const }
			: undefined;

	if (!target) {
		const available = [
			`Skills: ${skills.entries.map((entry) => entry.name).join(", ") || "none"}`,
			`Templates: ${templates.entries.map((entry) => entry.name).join(", ") || "none"}`,
		].join(". ");
		return {
			ok: false,
			error: `There is no skill or template named "${args.name}". ${available}.`,
		};
	}

	// Round 2. Asking for the voice itself reads one file, not two, and gets it
	// back once rather than under two keys.
	try {
		if (args.name === voiceName) {
			const body = await deps.github.readFile(
				"workshop",
				`${skillsPath}/${voice.file}`,
			);
			return { ok: true, voice: body };
		}

		const [voiceBody, targetBody] = await Promise.all([
			deps.github.readFile("workshop", `${skillsPath}/${voice.file}`),
			deps.github.readFile("workshop", `${target.dir}/${target.entry.file}`),
		]);

		return target.isSkill
			? { ok: true, voice: voiceBody, instructions: targetBody }
			: { ok: true, voice: voiceBody, template: targetBody };
	} catch (error) {
		return { ok: false, error: describeFailure(error) };
	}
}
