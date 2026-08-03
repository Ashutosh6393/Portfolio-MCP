import { z } from "zod";

// Shapes verified live and recorded in specs/001-server-skeleton/CLAUDE.md
// → "Live facts, already checked". `status` stays z.string(): the site's
// allowed values were never verified, so a z.enum would reject a valid
// entry the day the site adds one.
export const writingListSchema = z.array(
	z.object({
		slug: z.string(),
		title: z.string(),
		date: z.string(),
		readingTime: z.string(),
		summary: z.string(),
	}),
);

export const projectListSchema = z.array(
	z.object({
		slug: z.string(),
		title: z.string(),
		summary: z.string(),
		stack: z.array(z.string()),
		status: z.string(),
		repo: z.string(),
		demo: z.string().optional(),
		show: z.boolean().optional(),
		order: z.number().optional(),
	}),
);

// The write schema, served whole: `{ writing: {...}, project: {...} }`, two
// complete draft-2020-12 documents (specs/005-publish/design.md → Live facts).
//
// The envelope's only job is proving both keys arrived. What is *inside* them
// is not described here on purpose — `lib/validate.ts` is what interprets a
// schema document, and a Zod mirror of JSON Schema here would be a second
// definition of the same thing, drifting the day the site adds a keyword.
//
// A consumer selects `schema[kind]`. Never hand the envelope to a validator.
export const schemaEnvelopeSchema = z.object({
	writing: z.record(z.string(), z.unknown()),
	project: z.record(z.string(), z.unknown()),
});

export type SchemaEnvelope = z.infer<typeof schemaEnvelopeSchema>;

const contentUrl = {
	writing: "https://ashutoshverma.dev/api/writing/content.json",
	project: "https://ashutoshverma.dev/api/projects/content.json",
};

const schemaUrl = "https://ashutoshverma.dev/api/schema.json";

export type Site = {
	fetchContent(kind: "writing" | "project"): Promise<unknown>;
	fetchSchema(): Promise<SchemaEnvelope>;
};

// Types derived from the schemas above, for the service layer (Task 6) —
// never hand-write a type beside a schema (design.md → Validation).
export type Writing = z.infer<typeof writingListSchema>[number];
export type Project = z.infer<typeof projectListSchema>[number];

// The parse lives in the service (Task 6), not here — fetchContent stays
// `unknown` on purpose so a fake site can hand back garbage in tests.
export const site: Site = {
	async fetchContent(kind) {
		const response = await fetch(contentUrl[kind]);
		if (!response.ok) {
			throw new Error(`Failed to fetch ${kind} content from ashutoshverma.dev`);
		}
		return response.json();
	},

	// Unlike fetchContent, this one parses here rather than in a service.
	// It has two callers with nothing in common — the health check and the
	// publish service — so there is no single service to own the parse, and
	// both want the same guarantee: both keys arrived, or this throws.
	async fetchSchema() {
		const response = await fetch(schemaUrl);
		if (!response.ok) {
			throw new Error(
				"Failed to fetch the write schema from ashutoshverma.dev",
			);
		}
		return schemaEnvelopeSchema.parse(await response.json());
	},
};
