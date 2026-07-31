# Server Skeleton — Summary

Written for a **human**, at the point a PR slice is complete — before the PR is raised and
before any automated review has run. It must stand on its own.

Read this, then the diff, then approve the PR.

> Slice 1's summary is no longer here. It lives in git history at commit `f4d32fd`
> (`git show f4d32fd:specs/001-server-skeleton/summary.md`).

- **Slice:** 2 of 2 · **Branch:** `feat/list-content` (cut from `f4d32fd`, Slice 1's merge)
- **Spec:** `design.md` · **ADR:** `docs/adr/001-server-runtime-and-shape.md`
- **Tasks:** 5–9 done at the time of review. **Task 10 has since been done — read the
  postscript below before the rest of this file.**
- **Tests:** 8 → 26, all passing. `typecheck`, `lint`, `docs:check` all clean.

---

## Postscript — what happened after this was reviewed

**Everything below this block was true when it was written, at the PR gate. Three things
changed after the PR merged as #3 (`bc66cef`), and they contradict the body.** The body is
left as the record of what the reviewer actually saw; this block is the correction.

1. **Task 10 is done, and the answer is yes.** The connector was added in Claude Code,
   claude.ai **and the Claude mobile app**, and "list my published writing" returns the
   real posts on all three. The body repeatedly says this had not been tried — it has, and
   it works. That was the whole premise of the project (`design.md` Risk 4).
2. **The custom hostname is live.** `mcp.ashutoshverma.dev` now resolves to Fly via a
   CNAME in Vercel's DNS, with a verified Let's Encrypt certificate. The Risks and
   Deferred work tables below both list this as outstanding; it is not.
3. **Cold start is not a problem and nothing was built for it.** No client timed out on
   the ~5.7s wake. Both candidate fixes — dropping `fly.toml`'s health-check block, or
   `min_machines_running = 1` at ~$3/month — are **rejected, not deferred**, exactly as
   `design.md` Risk 3 said to do if the number never bit.

Full detail, including what this does *not* prove, is in `implementation.md`'s
2026-07-31 Task 10 session note. **The Deferred work table at the end of this file is
stale in four rows because of the above** — the still-live items are the tool-layer test
gap, the `.claude/agents/coder.md` fix, and documenting `fly deploy --ha=false`.
- **Size:** 5 files / 221 lines excluding tests and specs (10 files / 811 lines total).
  `design.md` predicted exactly 5 files for this slice, and that's what shipped — unlike
  Slice 1, this one is inside the 5–7 file / 500-line PR limit.

---

## TL;DR

The server can now actually answer the question it exists to answer: it fetches a real
person's published writings and projects from `ashutoshverma.dev` and hands them back
through a real MCP (Model Context Protocol — the way Claude talks to a tool server) tool
call. `list_content({ kind: "writing" })` returns real slugs, titles and summaries. If the
site is down or returns something unexpected, the tool says so in a sentence instead of
crashing, and the HTTP call still returns 200. The deep health check at `/{secret}/health`
now does a real network check instead of returning an empty object.

**What this slice does not do: prove any of that works from an actual client.** Task 10 —
connect from Claude Code, claude.ai, and the Claude mobile app, and read a real writing on
each — is not done. It needs a deployed machine and the production secret, which is human
work, not an agent's, for the same reason Task 4's deploy was in Slice 1. The whole point
of this project, per `design.md`, is finding out whether a custom connector works on
mobile — and a "no" there is still a successful result, because that's the answer the plan
was ordered to get first. This slice ships the code for that experiment. It has not been
run yet.

---

## What changed

| File | Change | Why |
|---|---|---|
| `src/lib/site.ts` | new | Fetches the two `content.json` routes on `ashutoshverma.dev` and defines the Zod schemas for what a writing and a project look like. `fetchContent` deliberately returns `unknown`, not a parsed type — see "The design ambiguity" below for why the parse moved out of this file. |
| `src/services/list-content.ts` | new | `listContent(deps, args)` — the business logic. Fetches through `deps.site`, parses the result, and turns a fetch failure or a bad shape into a returned `{ ok: false, error }` value, never a throw. |
| `src/tools/list-content.ts` | new | Registers `list_content` on the MCP server with the exact description text `design.md` specified. Turns the service's result into an MCP tool result: an error becomes `isError: true` with a sentence, an empty list becomes "No published X found", a real list becomes one line per item. |
| `src/tools/index.ts` | new | Builds the `McpServer` and the HTTP handler. The factory function it passes to `createMcpHandler` runs once per request — a fact about the SDK confirmed empirically this slice (see "Three SDK behaviours" below), not assumed from docs. |
| `src/index.ts` | modified | Mounts the MCP handler at `/{secret}/mcp`, and rewrites the deep health check to actually fetch the site instead of returning an empty object. `createApp` grows a required second argument, `deps: { site: Site }` — required, not defaulted, which is itself a small story (see "createApp's deps parameter" below). |

### How it works now

A `POST /{secret}/mcp` request with a `tools/call` body for `list_content` reaches the
mounted handler, which runs the factory, builds a fresh `McpServer`, and registers
`list_content` on it with the real `site` object. The tool calls `listContent`, which asks
`site.fetchContent(kind)` for the raw JSON, parses it against the writing or project
schema, and returns either the parsed items or a plain-English error. The tool turns that
into MCP content: a line per item, "No published X found" for an empty list, or an error
result the model can read and act on. None of this ever throws up through Elysia —
`onError` still only ever sees a genuine crash, exactly as `design.md` specifies.

`GET /{secret}/health` now actually calls `deps.site.fetchContent("writing")`. If it
resolves, `checks.site` is `"ok"` and the response is 200. If it rejects — the site is down
or returns a non-2xx — `checks.site` is `"unreachable"` and the response is 503. The public
`GET /health` route is untouched: still no I/O, still what Fly's probe hits.

### createApp's deps parameter, and the design ambiguity behind site.ts

**`createApp`'s second argument, `deps: { site: Site }`, is required — no default.** The
coder first defaulted it to the real site singleton (`deps = { site }`) so Slice 1's four
existing tests kept compiling with their old one-argument call, and flagged the shortcut
rather than hiding it. The test agent ruled against it: a default that falls back to a
module singleton smuggles the dependency back in through the seam, and from Task 9 on the
health route makes a real network call — a test that forgot to inject a fake would
silently hit `ashutoshverma.dev` and pass or fail on the weather. `deps` is now required;
forgetting to inject is a compile error, not a live network call in a test run. (Full
detail, with the two revised test files, is in Test revisions below.)

**`lib/site.ts` fetches; `services/list-content.ts` parses.** `design.md`'s own text reads
two ways here — it says "parse with Zod at the boundary" in `site.ts` — but T-14 hands the
service a fake site that returns `[{nope:1}]`. If `site.ts` parsed internally and returned
typed data, that fake would need a banned `as` cast to typecheck at all, and it would
bypass the real parse anyway — T-14 would end up asserting nothing. So `fetchContent`
returns `unknown`, the schemas still live in `site.ts` (it's still the boundary module),
and `listContent` runs the actual `safeParse`. This is the one place this slice departs
from a literal reading of `design.md`, and the reasoning is recorded in
`implementation.md`'s Task 5 session note.

### Three SDK behaviours, discovered empirically, undocumented anywhere before this slice

None of these were in any doc in this repo before Task 7. All three are load-bearing for
how the MCP handler is used from here on:

- **The handler answers a stateless POST as SSE (server-sent events), not plain JSON.**
  With `Accept: application/json, text/event-stream`, a bare `tools/list` call comes back
  as `text/event-stream` — one `event: message` frame whose `data:` line holds the actual
  JSON-RPC response. A test (or any future client code) that calls `response.json()`
  directly on this will fail; the `data:` line has to be parsed out first.
- **No `initialize` handshake is required for a bare `tools/list` / `tools/call` POST.**
  The SDK's `legacy` option defaults to `'stateless'`, which answers each request from a
  fresh factory instance with no session setup. Nothing is passed to `createMcpHandler`
  and nothing should be, without a test that fails without it.
- **The SDK validates tool arguments itself** and turns a Zod failure into a normal tool
  result — `isError: true`, the allowed values in the text, HTTP 200. T-15 needed no
  hand-rolled `kind` check, and none was written.

---

## QA

Questions a reviewer would actually ask, answered before they have to ask them.

**Does this let a real user do anything new?**
Not yet, and that's the honest answer. The tool works end to end inside the test suite and
against the real site (T-16/T-17 exercise the live site check). But nobody has connected a
real client — Claude Code, claude.ai, or the phone — to this server and asked it to list a
writing. That's Task 10, deliberately left undone in this slice. See the TL;DR above.

**What happens when the site is down or returns garbage?**
Two things are guaranteed, both tested at the service layer (T-13, T-14): the tool call
still returns HTTP 200, and the model gets a plain sentence naming the problem instead of a
crash or an `undefined` leaking through. Nothing is thrown across the MCP boundary.

**What happens when the tool is called with a bad argument, like `kind: "post"`?**
The SDK itself rejects it before the tool's own code runs — Zod validates the input schema,
folds the failure into a normal `isError: true` tool result with the allowed values in the
text, and the HTTP status is still 200 (T-15). No hand-written validation exists for this,
and none was needed.

**Any auth implication?**
No change to the auth model. The MCP endpoint sits behind the same `/{secret}/` prefix as
the health check; a wrong secret still gets Elysia's default 404, same as Slice 1. What's
new: the deep health check now makes a real outbound network call. That call happens only
when someone hits `/{secret}/health` by hand — it's not on the request path Fly's
30-second probe uses (see next answer).

**Does the deep health check's new network call put the auto-stop cost model at risk?**
No, and this is worth answering plainly because it's the obvious thing to worry about.
`fly.toml`'s health-check block points at the public `GET /health`, which does no I/O — the
same route as Slice 1. The site fetch only fires on `GET /{secret}/health`, a route Fly's
probe never calls. ADR-001's auto-stop cost model — the machine sleeps between the ~15
calls/week this server expects — is unaffected.

**Any test edits, and were any assertions weakened?**
Two, and neither weakened anything. Full detail in "Test revisions" below; the short
version: `createApp` needed a second, required argument for tests to keep injecting a
fake site instead of accidentally hitting the real one, and one assertion in T-05 changed
from "empty" to "contains `site`" because Task 9 put a real check where Slice 1 had left an
empty placeholder — exactly as `design.md`'s Slice 1 text always said would happen.

**What did we deliberately not build?**
Task 10 — deploy, connect from three clients, read a real writing on each. That's the
whole point of the project and it's human work: it needs a billable machine and the
production `MCP_SECRET_PATH`, same reasoning as Task 4's deploy in Slice 1. Also see
Deferred work below for smaller items and open items carried over from Slice 1.

---

## Verify it yourself

```bash
git checkout feat/list-content
bun install
bun test
```

Expect `26 pass, 0 fail`.

1. `bun run typecheck && bun run lint` → both clean, no output beyond success.
2. Read `src/services/list-content.test.ts` and `src/tools/index.test.ts` — the fake site
   objects there are the whole test seam. No network call happens in the suite; every test
   passes a literal object as `{ site }`.
3. To see the real thing against the live site (this does hit the network):
   ```bash
   bun -e '
   import { site } from "./src/lib/site";
   import { listContent } from "./src/services/list-content";
   listContent({ site }, { kind: "writing" }).then(console.log);
   '
   ```
   Expect `{ ok: true, items: [...] }` with real slugs and titles, or `{ ok: false, error:
   "ashutoshverma.dev is unreachable: ..." }` if the site happens to be down right now —
   both are correct behaviour, not a bug either way.
4. Failure case: temporarily point `contentUrl.writing` in `src/lib/site.ts` at a URL that
   404s, re-run step 3, and confirm you get `ok: false` with a readable error — not a
   thrown exception. Revert the change afterward; this is a local-only check, don't commit
   it.

This slice does not run on a deployed server yet (Task 10 is not done), so there is no
production URL to `curl` for the MCP endpoint specifically.
`https://ashutoshverma-mcp.fly.dev/health` still answers from Slice 1's deploy.

If you do have your own `MCP_SECRET_PATH` locally, **never paste it into a file, chat, or
log** while checking the deep health route — same warning as Slice 1.

---

## Test coverage

| Test | Verifies | File |
|---|---|---|
| T-08 | MCP endpoint handshakes behind the secret | `src/index.test.ts` |
| T-09 | MCP endpoint is behind the secret, wrong secret gets the same 404 | `src/index.test.ts` |
| T-10 | `list_content` is advertised with a non-empty description and the `writing`/`project` enum | `src/tools/index.test.ts` |
| T-11 | Listing writings returns slugs and titles from a fake site | `src/services/list-content.test.ts` |
| T-12 | Listing projects carries `stack` and `status` through | `src/services/list-content.test.ts` |
| T-13 | A throwing/non-200 fake site produces an error result naming the site, nothing thrown | `src/services/list-content.test.ts` |
| T-14 | An unexpected shape (`[{nope:1}]`) produces an error result, no crash, no `undefined` leaking through | `src/services/list-content.test.ts` |
| T-15 | `kind: "post"` is refused by the SDK's own Zod validation, HTTP still 200 | `src/tools/index.test.ts` |
| T-16 | Deep health passes when the site is reachable | `src/index.test.ts` |
| T-17 | Deep health returns 503 and names `site` when the site is unreachable | `src/index.test.ts` |

**Covered:** every acceptance criterion this slice can test without a deployed server or a
real client — the tool's happy path, both its error paths, argument validation, and both
branches of the deep health check.

**Not covered:** no test drives a *failing* site or a *non-empty* result set through the
actual MCP handler — `src/tools/index.test.ts`'s fake site returns an empty list, so only
the empty-catalogue branch runs end to end through `createHandler`. The error branch and
the real-listing branch are both covered, but one layer down, at the service (T-11…T-14),
not through the tool. `design.md`'s test list doesn't ask for more than that, so this is a
known, accepted gap rather than an oversight — flagged here in case a future slice needs
that extra coverage.

Also not covered, unchanged from Slice 1: deployment, the three-client connection story,
and cold-start timing under a real tool call. Task 10 is where all three get answered.

### Test revisions in this slice

**Two revisions, both in `implementation.md`'s Test revisions table, and both deserve a
close look — any test edit does.**

1. **`src/index.test.ts` (T-04, T-05, T-06, T-07) — `createApp` gained a required second
   argument.** Task 8 gave `createApp` a `deps` parameter. The first version defaulted it
   to the real `site` singleton (`deps = { site }`), purely so Slice 1's four existing
   tests kept compiling with their old one-argument call. The coder flagged this rather
   than quietly shipping it. The test agent ruled against the default: `code-style.md`
   already bans exactly this pattern — a default that falls back to a module singleton
   defeats the whole point of taking dependencies as an argument, because it lets a caller
   (including a test) skip injecting anything at all. From Task 9 onward the health route
   makes a real site call, so a test that forgot to inject a fake would silently hit
   `ashutoshverma.dev` and pass or fail depending on whether the site happened to be up.
   The fix: `deps` is required, with no default. All four Slice-1 tests were rewritten to
   call `createApp(testEnv, { site: fakeSite })` explicitly. **No assertion changed** —
   only how the app under test gets constructed.

2. **`src/index.test.ts` (T-05) — the final assertion changed from "empty" to "contains
   `site`".** T-05 originally asserted `Object.keys(body.checks)` equals `[]`, which was
   the correct answer for Slice 1: `design.md`'s Slice 1 acceptance criterion said an
   empty `checks` object was right, because there was nothing to check yet. Task 9 put a
   real site check on that same route. An empty object is no longer the right answer, so
   the assertion changed to `toContain("site")`. T-05 now only checks that the route is
   reachable and returns a `checks` object with the right key in it; whether that check
   *passes or fails* is T-16 and T-17's job, tested separately. This is not a weakened
   test — it's the same test, adjusted for a spec fact that changed on schedule between
   slices, exactly as `design.md`'s own text anticipated it would.

---

## Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| Task 10 (three-client connection, incl. mobile) is not done | Known, not speculative | The whole project's premise rests on this. Someone with the deployed machine and `MCP_SECRET_PATH` needs to run it and write the result down either way — a "no" on mobile is still a valid, useful answer per `design.md`'s own acceptance criterion 5. |
| Cold start (~5.4–5.7s, measured in Slice 1) has not been re-measured with a real tool call on top | Unmeasured, flagged in Slice 1's own notes | `implementation.md`'s Task 4 note explicitly asks for this re-measurement "from Slice 2, when a real tool call also pays a site fetch on top of this." Nobody has done it yet — it happens naturally once Task 10 runs. |
| The custom hostname `mcp.ashutoshverma.dev` still resolves to Vercel, not Fly | Known, carried over from Slice 1 | Blocking acceptance criterion 1 on the intended domain. Fixed by a DNS change at the registrar (the user's action) plus `fly certs add`. The server works identically on `ashutoshverma-mcp.fly.dev` today. |
| No test exercises a failing or non-empty site through the actual MCP handler, only through the service one layer down | Known, accepted gap — `design.md`'s test list doesn't ask for more | If a future slice adds tool-layer behaviour that depends on the shape of a real response (not just the service's), that gap should close first. |
| The deep health check's site fetch adds one outbound network call whenever `/{secret}/health` is hit by hand | Not on Fly's probe path, so no cost-model impact | Confirmed this slice: `fly.toml` probes the public `GET /health` only. See QA above. |

**Rollback:** No migration exists to complicate this. Revert the four commits
(`f733be3`, `0122ce9`, `d3930bf`, `052675b`) or `fly deploy` a prior image; either removes
the tool entirely and returns the deep health check to Slice 1's empty `{"checks":{}}`.

---

## Deferred work

Ideas surfaced during the build that were deliberately not done. This replaces a separate
future-work file — everything deferred lives here.

| Item | Why deferred | Worth doing? |
|---|---|---|
| Deploy and connect from Claude Code, claude.ai, and the mobile app (Task 10) | Human work — needs a billable machine and the production secret | yes — it's the point of the whole project; do it next |
| Re-measure cold start with a real tool call (site fetch) on top | `implementation.md`'s Task 4 note explicitly asked for this from Slice 2 onward; happens naturally when Task 10 runs | yes — cheap, and settles whether the earlier ~5.4s number still holds under real usage |
| Test whether `[[http_service.checks]]`'s `grace_period` inflates cold start | Carried over from Slice 1, still untested | maybe — only worth it if the cold-start number becomes an actual problem |
| Add tool-layer test coverage for a failing/non-empty site through `createHandler`, not just the service | `design.md`'s test list doesn't ask for it; noted as a gap, not built | maybe — low cost, closes a real (if narrow) blind spot |
| Set up the custom hostname `mcp.ashutoshverma.dev` (CNAME + `fly certs add`) | Requires a change at the domain registrar — the user's action, not code | yes — needed before acceptance criterion 1 is fully met on the intended domain |
| Fix `.claude/agents/coder.md`'s stale layer-chain description | Carried over from Slice 1, outside this spec's blast radius | yes — small, low-risk, belongs in its own tiny PR |
| Document that `fly deploy` needs `--ha=false` | Carried over from Slice 1, deploy-time gotcha already worked around by hand | yes — cheap, prevents the next deploy from failing the same way |

Nothing above needs its own ADR — none of it changes an architectural decision.

---

## Documentation updated

Docs are live — updated in the same commit as the change that made them stale.

- [x] `implementation.md` — every task's state, both test revisions, and all session notes
      for Tasks 5–9 are current as of this slice
- [x] This file, `summary.md` — replaced wholesale for Slice 2; Slice 1's version lives in
      git history at `f4d32fd`
