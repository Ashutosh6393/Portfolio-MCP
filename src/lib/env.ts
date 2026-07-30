import { z } from "zod";

// MCP_SECRET_PATH gates every real route (see design.md → The secret path). A short
// secret is the only failure mode of that auth model, so it must fail loudly at boot.
export const envSchema = z.object({
	MCP_SECRET_PATH: z.string().min(32),
	PORT: z.coerce.number().optional().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(
	source: Record<string, string | undefined> = process.env,
): Env {
	return envSchema.parse(source);
}
