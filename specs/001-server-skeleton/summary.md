# Server Skeleton — Summary

Written for a **human**, at the point a PR slice is complete — before the PR is raised and
before any automated review has run. It must stand on its own.

Read this, then the diff, then approve the PR.

- **Slice:** 1 of 2 · **Branch:** `feat/server-skeleton`
- **Spec:** `design.md` · **ADR:** `docs/adr/001-server-runtime-and-shape.md`
- **Tasks:** 1–4 · **Tests:** 8 added, all passing
- **Size:** 12 files, 309 lines (limit: 5–7 files excl. tests, 500 lines) — **over the
  file limit.** `design.md` → Files touched already flagged this and asked the reviewer to
  accept or reject it here, not have it decided for them.

---

## TL;DR

There is a real server now, deployed and running, at
`https://ashutoshverma-mcp.fly.dev`. It answers a public health check even after sitting
idle and shutting itself down to save money. Every other route — the future MCP tool
endpoint included — lives behind a long, secret URL segment, and a wrong secret gets the
exact same "not found" response as a random typo, so guessing tells an attacker nothing.
There is no tool to call yet. This slice is the empty shell the actual feature (Slice 2)
gets mounted into.

---

## What changed

| File | Change | Why |
|---|---|---|
| `package.json` | new | Bun package, pinned to `bun@1.3.14`; three runtime deps only — Elysia, Zod, the MCP SDK — plus dev tooling (Biome, TypeScript, `@types/bun`). No Turborepo, no `octokit`, no `@mdx-js/mdx`: those belong to later slices. |
| `tsconfig.json` | new | Strict TypeScript with `noUncheckedIndexedAccess`. Names `"types": ["bun"]` explicitly — the `tsgo` compiler used here doesn't auto-find `@types/bun`, so without it `bun run typecheck` failed outright: it could not resolve `bun:test` or the global `process`. Found during Task 2 and fixed there. |
| `biome.json` | new | Lint/format rules (tabs, not spaces) — the reason the two whitespace-only diffs below exist. |
| `.env.example` | new | Documents the two env var **names** (`MCP_SECRET_PATH`, `PORT`) with no values, per `security.md`. |
| `src/lib/env.ts` | new | Parses and validates the environment with Zod at process start. `MCP_SECRET_PATH` must be at least 32 characters or the process refuses to boot — a short secret is the only way this server's entire auth model fails, so it fails at startup, loudly, not on the first request. |
| `src/index.ts` | new | The Elysia app. `GET /health` is public and does no I/O (Fly's liveness probe). Everything else lives under a `/{secret}/` prefix, implemented as a literal route group — a wrong secret matches no route at all, so it falls through to Elysia's own built-in 404 rather than a hand-written one that could leak information. |
| `Dockerfile` | new | Builds the runnable image. Pinned to `oven/bun:1.3.14-alpine` (tag confirmed to exist, not assumed). `--ignore-scripts` on install, because `package.json`'s `prepare` step shells out to `bash` and `.git`, neither of which exist in the image. |
| `.dockerignore` | new | Keeps `.env`, `.claude`, `docs`, `specs`, and dev-only config out of the built image. |
| `fly.toml` | new | Deploy config: region `bom`, `auto_stop_machines = "stop"` (the machine sleeps between the ~15 calls/week this server expects, which is what keeps the cost near zero), a public health check, 512MB of headroom. |
| `.claude/settings.json`, `example.package.json` | modified, **whitespace only** | Reformatted from 2-space to tab indentation so `bun run lint` (which enforces `biome.json`'s tab rule) actually passes on files that predate this scaffold. `git diff -w` on this commit is empty — nothing but whitespace moved. |
| `tech-stack.yaml` | modified | Records two facts about the MCP SDK that `design.md`'s own Risk list called "unverified" before this slice: `McpHttpHandler.fetch` is a plain property (safe to detach for `.mount()`), and `createMcpHandler` takes a **factory** function, not a server instance, called once per request. Also confirms `ajv` really is bundled into the SDK and does not need installing separately. |
| `docs/adr/mcp-design.md` | modified | Corrects two wrong assumptions the ADR made, found by checking the live site: `api/schema.json` is **two** schemas in one object (keyed `writing`/`project`), not one; and the site's schema requires `readingTime` on every writing, so the server — not a tool call — has to compute it. Both only affect the `publish` tool, which is Slice 4, not this one. |

### How it works now

A request to `GET /health` hits Elysia directly and returns 200 with no body and no
outbound calls — this is the route Fly's own health checker polls, and it has to stay
cheap because it runs every 30 seconds forever. Any other request is matched against the
`/{secret}/...` group: if the URL's first segment is exactly the 32+ character value of
`MCP_SECRET_PATH`, it reaches `GET /{secret}/health`, which currently returns
`{"checks":{}}` — there is nothing to check yet, that's correct for this slice, and
Slice 2 fills it in with a real site-reachability check. If the segment doesn't match —
wrong secret, a typo, or nothing at all — Elysia never finds a route, and its own default
404 handler responds. That default response is what makes a wrong guess and an honest
typo indistinguishable; nobody wrote a custom 404, on purpose.

At process start (`import.meta.main`), `parseEnv()` reads `process.env` through the Zod
schema in `src/lib/env.ts`. If `MCP_SECRET_PATH` is missing or short, `parseEnv` throws
before `createApp` is even called, so the process exits and Fly's deploy or restart fails
loudly instead of serving a broken app.

---

## QA

Questions a reviewer would actually ask, answered before they have to ask them.

**What does this let a user do that they couldn't before?**
Nothing new to a human user yet — there's no tool, no content, no MCP endpoint mounted.
What it proves is that a Bun process can run on Fly, wake from a full stop, and answer
correctly, which the actual feature (Slice 2) depends on existing first.

**What happens when it fails?**
Two different failure modes, both intentional:
- **Boot-time:** a missing or under-32-character `MCP_SECRET_PATH` makes the process exit
  immediately with Zod's own error, which names the variable and states the 32-character
  minimum. Nothing partial ever starts listening.
- **Request-time:** there is no custom error handling at all in this slice. A wrong
  secret or unknown path gets Elysia's built-in 404 — plain text, `NOT_FOUND`. Nothing is
  logged about the attempted path (the secret would be in it), and nothing is retried;
  there's no state to retry against.

**Does this touch existing behaviour?**
No — this is the first code in the repository. Everything before this slice was empty
scaffold (`example.package.json`, `.claude/settings.json`), so there is nothing this
could regress except itself.

**Any data migration?**
None. No database exists, per ADR-001.

**Any performance implications?**
Yes, one worth flagging directly: **cold start measured at 5.4–5.7 seconds**, across
four samples (three forced stops, one natural idle stop), warm requests at ~0.75s.
`design.md`'s Risk 3 assumed "around a second" and called the risk "expected to be a
non-issue" — **that assumption was wrong by roughly 5×.** Per that same risk entry,
nothing was built to address it; the mitigation on record is "note the number, and if it's
genuinely bad, `min_machines_running = 1` is a one-line config change that costs money,"
and that trade is explicitly the user's call, not something decided in this diff.

**Any security or auth implications?**
The entire auth model is new here and is the security-sensitive part of this slice. There
is no login, no token, no header — the credential is a 32+ character segment of the URL
path itself, and possession of the right URL is possession of access. The design
accepts a known cost from this: the secret ends up in Fly's own HTTP access logs (any URL
does). That tradeoff is recorded and accepted in `design.md` Risk 5, not re-decided here.
What this slice adds on top: a wrong secret must be **unrecoverable information** — it
can't tell an attacker "closer" or "further," it just looks identical to a typo. That's
verified in production, not just in tests (see Verify it yourself, below).

**What did we deliberately not do?**
The MCP handler, the `list_content` tool, the site fetch, and the deep health check's
real logic — all Slice 2, all listed in Deferred work below along with a few smaller
things that surfaced mid-build.

---

## Verify it yourself

```bash
git checkout feat/server-skeleton
bun install
bun test
```

Expect `8 pass, 0 fail`.

1. `curl -i https://ashutoshverma-mcp.fly.dev/health` → expect `200`, empty body, even if
   this is the first request in a while (the machine may need a few seconds to wake up —
   that's the cold start above, not a hang).
2. `curl -i https://ashutoshverma-mcp.fly.dev/` and
   `curl -i https://ashutoshverma-mcp.fly.dev/some-made-up-path` → expect both to return
   `404` with the same plain-text body. This is the failure case that matters: a wrong
   guess must look exactly like a typo.
3. To see the real deep-health route, read `MCP_SECRET_PATH` out of your own `.env` file
   (git-ignored, never printed here) and run:
   `curl -i https://ashutoshverma-mcp.fly.dev/$MCP_SECRET_PATH/health` → expect `200` and
   `{"checks":{}}`. Do not paste the secret into any file, chat, or log while doing this.

---

## Test coverage

| Test | Verifies | File |
|---|---|---|
| T-01 | Boot throws, naming `MCP_SECRET_PATH`, when it's missing | `src/lib/env.test.ts` |
| T-02 | Boot throws, stating the 32-char minimum, on a short secret | `src/lib/env.test.ts` |
| T-03 | Valid env parses to a typed object; `PORT` coerces and defaults to 3000 | `src/lib/env.test.ts` |
| T-04 | `GET /health` is 200 and public, and makes no outbound `fetch` call | `src/index.test.ts` |
| T-05 | `GET /{secret}/health` is reachable and returns an (empty, for now) `checks` object | `src/index.test.ts` |
| T-06 | A wrong secret returns a byte-identical 404 to an unknown route | `src/index.test.ts` |
| T-07 | `GET /` returns a byte-identical 404 to an unknown route | `src/index.test.ts` |

**Covered:** every acceptance criterion for this slice — env validation at both failure
edges, the public health route, the secret-gated route, and the two 404-equivalence
checks that are the actual security property being built.

**Not covered:** deployment itself, the three-client connection story, and cold-start
timing — `implementation.md` says outright not to invent a test to make the table look
uniform here. Those were verified by hand and are recorded in `implementation.md`'s
session notes, and the cold-start number is repeated in Risks below.

### Test revisions in this slice

**One revision, and it deserves a close look.** After the tests were written, the test
agent edited `src/index.test.ts` (T-04, T-05) to make the file typecheck, without changing
what either test asserts:

- **T-04:** replaced a double-cast (`as typeof fetch`) on the fake `fetch` stand-in with
  `Object.assign(spy, { preconnect: originalFetch.preconnect })`, so the stand-in
  structurally satisfies Bun's real `fetch` type (which carries a `preconnect` static
  method) instead of forcing an unchecked type past the compiler.
- **T-05:** added `typeof`/`null`/`in` narrowing guards before reading `.checks` off the
  response body, because `response.json()` types as `unknown` under this toolchain
  (`@types/bun`, no `dom` lib) — there was no shape to trust without a guard.

Same expected values, same pass/fail conditions in both cases — only the path to get
there changed, from an unchecked cast to a real guard. It's logged here and in
`implementation.md`'s Test revisions table because any test edit warrants a second look,
and the reviewer should be the one who decides that, not this document.

---

## Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| Cold start is ~5.4–5.7s, not the ~1s `design.md` assumed | Already observed, not speculative | If a client gives up mid-handshake in Slice 2's real usage, or if the user decides the wait is bad UX, `min_machines_running = 1` in `fly.toml` fixes it at a small monthly cost — a config change, not new code. |
| The secret lives in the URL path and lands in Fly's access logs | Accepted cost, recorded in `design.md` Risk 5 | Never let the app itself log the request path. Rotating the secret is an env var change plus redeploy. |
| `fly.toml`'s health-check `grace_period` may be adding to the 5.4s cold-start number | Unverified, low urgency | Untested hypothesis, logged in `implementation.md`. Cheapest next experiment if the cold-start number needs to come down: delete the `[[http_service.checks]]` block and re-measure. |
| The custom hostname `mcp.ashutoshverma.dev` isn't live yet — it still resolves to Vercel | Known, blocking acceptance criterion 1 on the intended domain | The server works identically on `ashutoshverma-mcp.fly.dev` today. Repointing DNS is the user's action at the registrar, then `fly certs add`. |

**Rollback:** No migration exists to complicate this. Revert the seven commits
(`4eaa2bf`…`0277d01`) or `fly deploy` a prior image; either stops the server or takes it
back to not existing. The live Fly app can also just be scaled to zero machines by hand
if an immediate stop is needed before a code rollback lands.

---

## Deferred work

Ideas surfaced during the build that were deliberately not done. This replaces a separate
future-work file — everything deferred lives here.

| Item | Why deferred | Worth doing? |
|---|---|---|
| Test whether `[[http_service.checks]]`'s `grace_period` delays routing to a freshly-woken machine, inflating the 5.4s cold start | Untested hypothesis from this slice; `design.md` Risk 3 says record the number, build nothing | maybe — cheap to test, only worth it if the cold-start number becomes an actual problem |
| Fix `.claude/agents/coder.md`, which still states the layer chain as `routes → controllers → services → repository` — ADR-001 made that false, and the coder prompt was corrected by hand both times this slice needed it | Outside this spec's blast radius | yes — small, low-risk fix, but belongs in its own tiny PR, not bundled here |
| Set up the custom hostname `mcp.ashutoshverma.dev` (CNAME + `fly certs add`) | Requires a change at the domain registrar, which is the user's action, not code | yes — needed before acceptance criterion 1 is fully met on the intended domain |
| Document that `fly deploy` needs `--ha=false`, or it tries to create a second machine and exits non-zero where the region has no spare capacity | Deploy-time gotcha, already worked around by hand this time | yes — cheap, prevents the next deploy from failing the same way; a one-line note in `fly.toml`'s comments or a deploy script would do it |

Nothing above needs its own ADR — none of it changes an architectural decision, they're
either DNS/ops follow-ups or a stale doc fix.

---

## Documentation updated

Docs are live — updated in the same commit as the change that made them stale.

- [x] `tech-stack.yaml` — records the two MCP SDK facts (`handler.fetch` shape,
      factory-first `createMcpHandler`) that were previously flagged "unverified"
- [x] `docs/adr/mcp-design.md` — corrects the schema.json shape (two schemas, not one)
      and adds the `readingTime` rule, both found by checking the live site
- [x] `tsconfig.json` — adds `"types": ["bun"]`, fixing a wrong claim from Task 1's own
      notes that typecheck would pass without it
- [x] `implementation.md` — every task's state, the test revision, and all session notes
      for Tasks 1–4 are current as of this slice
