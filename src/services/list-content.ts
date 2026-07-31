import type { Project, Site, Writing } from "../lib/site";
import { projectListSchema, writingListSchema } from "../lib/site";

// design.md → Approach → Errors: "Tool failures are returned as tool
// results, never thrown." Overloads (not a generic + cast) let the return
// type narrow on the literal `kind` without an `as` anywhere in this file.
export function listContent(
	deps: { site: Site },
	args: { kind: "writing" },
): Promise<{ ok: true; items: Writing[] } | { ok: false; error: string }>;
export function listContent(
	deps: { site: Site },
	args: { kind: "project" },
): Promise<{ ok: true; items: Project[] } | { ok: false; error: string }>;
// The union overload, last in the list, is what callers get back when they
// hold `args.kind` as the widened `"writing" | "project"` (the test file's
// `ReturnType<typeof listContent>` resolves to this one).
export function listContent(
	deps: { site: Site },
	args: { kind: "writing" | "project" },
): Promise<
	| { ok: true; items: Writing[] }
	| { ok: true; items: Project[] }
	| { ok: false; error: string }
>;
export async function listContent(
	deps: { site: Site },
	args: { kind: "writing" | "project" },
): Promise<
	| { ok: true; items: Writing[] }
	| { ok: true; items: Project[] }
	| { ok: false; error: string }
> {
	let raw: unknown;
	try {
		raw = await deps.site.fetchContent(args.kind);
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		return {
			ok: false,
			error: `ashutoshverma.dev is unreachable: ${message}`,
		};
	}

	if (args.kind === "writing") {
		const parsed = writingListSchema.safeParse(raw);
		if (!parsed.success) {
			// zod's issue messages report missing fields as "received undefined",
			// which would put the literal string "undefined" in the tool result —
			// so this names the failing fields instead of quoting zod directly.
			const fields = parsed.error.issues.map((issue) => issue.path.join("."));
			return {
				ok: false,
				error: `ashutoshverma.dev returned writing content in an unexpected shape (fields: ${fields.join(", ")})`,
			};
		}
		return { ok: true, items: parsed.data };
	}

	const parsed = projectListSchema.safeParse(raw);
	if (!parsed.success) {
		const fields = parsed.error.issues.map((issue) => issue.path.join("."));
		return {
			ok: false,
			error: `ashutoshverma.dev returned project content in an unexpected shape (fields: ${fields.join(", ")})`,
		};
	}
	return { ok: true, items: parsed.data };
}
