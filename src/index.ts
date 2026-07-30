import { Elysia } from "elysia";
import { type Env, parseEnv } from "./lib/env";

// See design.md → Request flow / The secret path. The secret is a literal route
// prefix, not a value checked inside a handler — a wrong secret then matches no
// route at all and falls through to Elysia's own unmatched-route 404, which is
// byte-identical to any other unknown path (T-06, T-07). Never authored here.
export function createApp(env: Env) {
	return new Elysia()
		.get("/health", () => new Response(null, { status: 200 }))
		.group(`/${env.MCP_SECRET_PATH}`, (app) =>
			app.get("/health", () => ({ checks: {} })),
		);
}

// Boot is guarded so importing createApp in a test binds no port (see feature
// CLAUDE.md and design.md → Files touched).
if (import.meta.main) {
	const env = parseEnv();
	createApp(env).listen(env.PORT);
}
