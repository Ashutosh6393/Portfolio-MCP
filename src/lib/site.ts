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

const contentUrl = {
	writing: "https://ashutoshverma.dev/api/writing/content.json",
	project: "https://ashutoshverma.dev/api/projects/content.json",
};

export type Site = {
	fetchContent(kind: "writing" | "project"): Promise<unknown>;
};

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
};
