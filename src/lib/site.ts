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

// One published item, from `api/{kind}/{slug}`. `body` is raw MDX **without**
// the metadata block — the route imports the real object and hands it back
// separately, which is why published content is read here and never through
// GitHub. `readDraft` pointed at a `portfolio` file would return null or
// plausible-looking wrong metadata (ADR-005 decision 7).
//
// No `sha`: there is no draft to overwrite, so there is nothing to pass back.
export const documentSchema = z.object({
	metadata: z.record(z.string(), z.unknown()),
	body: z.string(),
});

export type SiteDocument = z.infer<typeof documentSchema>;

// The site answered, and said there is no such slug. Distinct from the site
// being unreachable: one means a wrong slug, the other means a dead host, and
// they send the reader in different directions (T-23 vs T-24). Follows the
// `GithubNotFoundError` precedent — callers branch on `instanceof`, never on
// a message string.
export class SiteNotFoundError extends Error {
	constructor(
		readonly kind: "writing" | "project",
		readonly slug: string,
	) {
		super(`No published ${kind} at "${slug}"`);
		this.name = "SiteNotFoundError";
	}
}

const contentUrl = {
	writing: "https://ashutoshverma.dev/api/writing/content.json",
	project: "https://ashutoshverma.dev/api/projects/content.json",
};

const schemaUrl = "https://ashutoshverma.dev/api/schema.json";

// The same singular/plural asymmetry as `contentUrl` above, and for the same
// reason: the site's routes are `/api/writing` and `/api/projects` while the
// domain word for the latter is singular. Both are correct in their own place.
// This map is the only place the two spellings meet, which is deliberate —
// interpolating the kind into a URL by hand is how the plural gets lost.
const documentUrl = {
	writing: (slug: string) => `https://ashutoshverma.dev/api/writing/${slug}`,
	project: (slug: string) => `https://ashutoshverma.dev/api/projects/${slug}`,
};

export type Site = {
	fetchContent(kind: "writing" | "project"): Promise<unknown>;
	fetchSchema(): Promise<SchemaEnvelope>;
	fetchDocument(
		kind: "writing" | "project",
		slug: string,
	): Promise<SiteDocument>;
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

	async fetchDocument(kind, slug) {
		const response = await fetch(documentUrl[kind](slug));
		// A 404 here is unambiguous, unlike GitHub's: the site is public, so
		// there is no token scope that could hide a post that exists.
		if (response.status === 404) {
			throw new SiteNotFoundError(kind, slug);
		}
		if (!response.ok) {
			throw new Error(`Failed to fetch ${kind}/${slug} from ashutoshverma.dev`);
		}
		return documentSchema.parse(await response.json());
	},
};
