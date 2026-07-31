import { Elysia } from "elysia";
import { type Env, parseEnv } from "./lib/env";
import { type Site, site } from "./lib/site";
import { createHandler } from "./tools";

// See design.md → Request flow / The secret path. The secret is a literal route
// prefix, not a value checked inside a handler — a wrong secret then matches no
// route at all and falls through to Elysia's own unmatched-route 404, which is
// byte-identical to any other unknown path (T-06, T-07). Never authored here.
// `deps` is required — a default would smuggle the real site singleton back in
// as a fallback, defeating the seam a test relies on to inject a fake (code-style.md
// → Layer discipline). Forgetting to inject is now a compile error, not a silent
// call to ashutoshverma.dev.
export function createApp(env: Env, deps: { site: Site }) {
	const handler = createHandler(deps);
	return new Elysia()
		.get("/health", () => new Response(null, { status: 200 }))
		.group(`/${env.MCP_SECRET_PATH}`, (app) =>
			app
				.get("/health", async () => {
					// Deep check: 200 all-pass / 503 any-fail (design.md → API surface).
					// Only the site check exists — the two GitHub checks can't exist
					// before the GitHub App does (design.md → Scope).
					const siteCheck = await deps.site
						.fetchContent("writing")
						.then(() => "ok" as const)
						.catch(() => "unreachable" as const);
					const checks = { site: siteCheck };
					const allPass = Object.values(checks).every(
						(check) => check === "ok",
					);
					return new Response(JSON.stringify({ checks }), {
						status: allPass ? 200 : 503,
						headers: { "Content-Type": "application/json" },
					});
				})
				.mount("/mcp", handler.fetch),
		);
}

// Boot is guarded so importing createApp in a test binds no port (see feature
// CLAUDE.md and design.md → Files touched).
if (import.meta.main) {
	const env = parseEnv();
	createApp(env, { site }).listen(env.PORT);
}
