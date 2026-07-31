import { z } from "zod";

// MCP_SECRET_PATH gates every real route (see design.md → The secret path). A short
// secret is the only failure mode of that auth model, so it must fail loudly at boot.
// GITHUB_TOKEN's prefix is checked, not just its presence (design.md → Env
// validation). GitHub answers 404, not 403, for a private repo a token cannot
// see, so a classic token or a truncated paste arrives later disguised as
// "no such skill". Failing at boot with the variable's name is worth one line.
// The cost, stated: if GitHub ever changes the fine-grained prefix, the server
// refuses to start — loud, immediate, and a one-line fix.
export const envSchema = z.object({
	MCP_SECRET_PATH: z.string().min(32),
	GITHUB_TOKEN: z.string().startsWith("github_pat_"),
	PORT: z.coerce.number().optional().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(
	source: Record<string, string | undefined> = process.env,
): Env {
	return envSchema.parse(source);
}
