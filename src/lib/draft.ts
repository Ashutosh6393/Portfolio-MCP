// The draft format. Four pure functions, no network, no state.
//
// Purpose:            turn metadata plus a body into the MDX text stored in
//                     `workshop`, and read it back unchanged.
// Non-responsibilities: no validation (a draft with only a summary is a valid
//                     draft — validation belongs to publish), no GitHub, no
//                     error messages (the service owns the refusal text).
//
// The `2` in `JSON.stringify(metadata, null, 2)` is the format, not styling.
// It is what leaves the top-level `}` as the only brace at column 0 — every
// nested closer sits indented, so no nested object and no `}` line inside the
// body can forge the delimiter. Drop the indent and the whole block renders on
// one line with no `}` line at all: the reader then fails on the serializer's
// own output, silently, and only for files written after the change.
//
// This parser reads only blocks this server wrote. Pointed at a hand-written
// MDX file from `portfolio` it is the wrong tool and will look like the right
// one — those carry a JS object literal, so it returns `null` or, worse,
// plausible-looking wrong metadata (ADR-004 → Tradeoffs).

export function renderDraft(
	metadata: Record<string, unknown>,
	body: string,
): string {
	const json = JSON.stringify(metadata, null, 2);
	// The one hand-written guard: empty metadata stringifies to `{}` on a single
	// line, which has no closing line for the reader to find. `JSON.parse("{\n}")`
	// is `{}`, so the round trip holds (design.md → Open questions → G-1).
	const block = json === "{}" ? "{\n}" : json;
	return `export const metadata = ${block}\n\n${body}`;
}

export function readDraft(
	text: string,
): { metadata: Record<string, unknown>; body: string } | null {
	const start = text.indexOf("{");
	if (start === -1) return null;

	const lines = text.slice(start).split("\n");
	const end = lines.indexOf("}", 1);
	if (end === -1) return null;

	try {
		return {
			metadata: JSON.parse(lines.slice(0, end + 1).join("\n")),
			// Leading blank lines are not part of the body: they are the separator
			// this serializer writes, and mean nothing before the first MDX element.
			body: lines
				.slice(end + 1)
				.join("\n")
				.replace(/^\n+/, ""),
		};
	} catch {
		// No detail is carried on purpose. A character offset is useless to someone
		// on a phone, so ADR-004 forbids surfacing it and there is nothing to pass up.
		return null;
	}
}

export function draftPath(kind: "writing" | "project", slug: string): string {
	return `drafts/${kind}/${slug}.mdx`;
}

// A trust boundary, not a tidiness check: the slug becomes a path in a repo this
// server can now write to and delete from, so `../../../etc/passwd` has to fail here.
export function isSlug(value: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
