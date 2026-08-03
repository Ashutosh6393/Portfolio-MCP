import { Elysia } from "elysia";
import { type Env, parseEnv } from "./lib/env";
import { createGithub, type Github } from "./lib/github";
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
export function createApp(env: Env, deps: { site: Site; github: Github }) {
	const handler = createHandler(deps);
	return new Elysia()
		.get("/health", () => new Response(null, { status: 200 }))
		.group(`/${env.MCP_SECRET_PATH}`, (app) =>
			app
				.get("/health", async () => {
					// Deep check: 200 all-pass / 503 any-fail (design.md → API surface).
					// All three outbound calls run in parallel, so adding GitHub cost
					// this route nothing in wall time and no tool path at all.
					//
					// `github` is one entry covering both repos, not two: one URL should
					// say which *layer* is dead, and two repos are not two layers.
					// portfolio is checked even though no tool reads it yet — a token
					// scoped to only one repo is the likeliest setup mistake, and this
					// is the only thing that would ever catch it.
					//
					// `schema` is its own entry rather than folded into `site` because
					// it fails for a different reason and wants a different fix. `site`
					// down means the host is down; `schema` down with `site` up means
					// the api/schema.json route broke or changed shape — and publish
					// refuses to validate anything until it is back.
					const [siteCheck, githubCheck, schemaCheck] = await Promise.all([
						deps.site
							.fetchContent("writing")
							.then(() => "ok" as const)
							.catch(() => "unreachable" as const),
						Promise.all([
							deps.github.listDirectory("portfolio", ""),
							deps.github.listDirectory("workshop", ""),
						])
							.then(() => "ok" as const)
							.catch(() => "unreachable" as const),
						deps.site
							.fetchSchema()
							.then(() => "ok" as const)
							.catch(() => "unreachable" as const),
					]);
					const checks = {
						site: siteCheck,
						github: githubCheck,
						schema: schemaCheck,
					};
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
	const github = createGithub(env.GITHUB_TOKEN);
	createApp(env, { site, github }).listen(env.PORT);
}
