# Server Skeleton — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** complete. All 10 tasks done, both slices merged, every acceptance criterion
  in `design.md` met.
- **Branch:** both slices merged. Slice 1 on `feat/server-skeleton` → PR #2 (`f4d32fd`);
  Slice 2 on `feat/list-content` → PR #3 (`bc66cef`).
- **Spec:** `design.md` · **ADR:** `docs/adr/001-server-runtime-and-shape.md`
- **The question this spec existed to answer:** does a custom connector work in the Claude
  mobile app? **Yes.** Verified on Claude Code, claude.ai and mobile — see the 2026-07-31
  Task 10 session note.

---

## Task states

| State | Meaning |
|---|---|
| `pending` | Not started. Dependencies may not be met yet. |
| `red` | Failing test written and confirmed failing for the right reason. |
| `green` | Code passes the test. Not yet committed. |
| `done` | **Test agent confirmed all test cases pass**, committed. |
| `blocked` | Attempt budget exhausted. Work stops here. |

A task reaches `done` only on the test agent's confirmation. The coder agent never marks
its own task complete.

---

## Tasks

In dependency order. Each task must be independently testable and map to test IDs in
`design.md`.

| # | Task | Depends on | Tests | Slice | State | Attempts | Commit |
|---|---|---|---|---|---|---|---|
| 1 | Scaffold: Bun, TS strict, Biome, scripts, deps | — | — | 1 | `done` | 1/3 | (this commit) |
| 2 | `src/lib/env.ts` — Zod env schema, parsed at boot | 1 | T-01, T-02, T-03 | 1 | `done` | 1/3 | (this commit) |
| 3 | `src/index.ts` — Elysia, `GET /health`, secret prefix, `GET /{secret}/health` with empty checks, one 404 shape | 2 | T-04, T-05, T-06, T-07 | 1 | `done` | 1/3 | (this commit) |
| 4 | `Dockerfile`, `.dockerignore`, `fly.toml`, `.env.example`; deploy; measure cold start | 3 | — | 1 | `done` | 0/3 | `cf732e3`, `d0ebbfc`, `0277d01` |
| 5 | `src/lib/site.ts` — fetch the two `content.json` routes, parse with Zod at the boundary | 4 | T-14 | 2 | `done` | 1/3 | (this commit) |
| 6 | `src/services/list-content.ts` — `listContent(deps, args)`, error paths as return values | 5 | T-11, T-12, T-13, T-14 | 2 | `done` | 1/3 | (this commit) |
| 7 | `src/tools/list-content.ts` + `src/tools/index.ts` — build the `McpServer`, register the tool, `createMcpHandler` | 6 | T-10, T-15 | 2 | `done` | 1/3 | (this commit) |
| 8 | Mount the handler at `/{secret}/mcp` in `src/index.ts` | 7 | T-08, T-09 | 2 | `done` | 1/3 | (this commit) |
| 9 | Deep health runs the real site check; 503 on failure | 5, 8 | T-16, T-17 | 2 | `done` | 1/3 | (this commit) |
| 10 | Deploy; connect from Claude Code, claude.ai, and mobile; read a writing on each | 9 | — | 2 | `done` | 0/3 | deployed, no code |

### Notes on specific tasks

**Task 1 carries two verifications that everything downstream depends on.** Do them at
install time and record both answers in `summary.md`:

1. Read the installed `node_modules/@modelcontextprotocol/server/dist/index.d.mts` and
   confirm the exact type of `McpHttpHandler`. `tech-stack.yaml` says to mount it as
   `.mount('/mcp', handler.fetch)`. That expression is unverified. If it is wrong, fix the
   mount and correct `tech-stack.yaml` in the same commit.
2. Resolve `import { AjvJsonSchemaValidator } from "@modelcontextprotocol/server/validators/ajv"`
   once. Neither the SDK nor `@modelcontextprotocol/core` declares `ajv` as a dependency
   (checked against the npm registry), so it is presumed bundled. **Record the answer and
   move on — do not build anything on it.** Nothing in this spec validates JSON Schema.

**Tasks 4 and 10 have no automated test.** Deployment and three-client connection are
verified by hand and written into `summary.md`. Do not invent a test to make the table
look uniform.

**Task 3's 404 shape is the security-relevant part**, not the happy path. T-06 and T-07
compare bodies byte for byte. A helpful error message here defeats the entire auth model.

### Attempt budget

**3 code attempts per task.** Resets each task, never carries over.

Stop early — do not spend the remaining budget — if the **same failure signature appears
twice in a row**. An identical error twice means the problem is not understood, and
further attempts distort the implementation to satisfy an assertion nobody has understood.

Environmental failures (missing dependency, bad import, config, flake) do not consume an
attempt. Fix them and retry. **A first-run failure against `@modelcontextprotocol/server`
is very likely environmental** — it is a three-day-old major and this repo is its first
use here.

On exhaustion: mark `blocked`, fill in the record below, **stop**. Do not start the next
task — tasks are dependency-ordered.

---

## PR slices

Each slice ships independently: summary → human review → PR → CI review.

| Slice | Contains | Files | State | PR |
|---|---|---|---|---|
| 1 | Tasks 1–4 — deployed server, health routes, secret path | 10 | `merged` | #2 (`f4d32fd`) |
| 2 | Tasks 5–10 — MCP handler, `list_content`, deep health check | 5 | `merged` | #3 (`bc66cef`) |

**Slice 2 merged with Task 10 unfinished, deliberately.** The code shipped; the
three-client experiment it exists to run is human work and happens against the deployed
server, not in the PR.

**Slice 1 exceeds the 5–7 file limit at 10 files.** Eight are config with no logic and the
whole slice is under 200 lines. Justified in `design.md` → Files touched. **The reviewer
accepts or rejects this at the spec gate.** If rejected, the split is: scaffold + env +
Elysia first, deploy config second — at the cost of a first PR that ships nothing runnable.

---

## Blocked

Nothing is blocked.

---

## Test revisions

Every deliberate change to a test, with justification. Written by the **test agent only**.
A revision on a task that was failing gets extra scrutiny from the human reviewer.

| Date | Test | Change | Why |
|---|---|---|---|
| 2026-07-30 | `src/index.test.ts` (T-04, T-05) | T-04: swapped the `as typeof fetch` double-cast on the fetch stand-in for `Object.assign(spy, { preconnect: originalFetch.preconnect })`, carrying the real property across instead of asserting an unchecked shape. T-05: added `typeof`/`null`/`in` guards to narrow the `unknown` body from `response.json()` before reading `.checks`, instead of trusting an unverified shape. | Made the file typecheck under tsgo + `@types/bun` (`lib: ["ESNext"]`, no `dom`), which types `Response.json()` as `Promise<unknown>` and the Bun `fetch` type as a call signature plus a `preconnect` static method. No assertion changed — same expectations, same failure conditions, just reached through a real guard instead of a cast. |
| 2026-07-31 | `src/index.test.ts` (T-04, T-05, T-06, T-07) | Each now calls `createApp(testEnv, { site: fakeSite })` instead of `createApp(testEnv)`, reusing a `fakeSite` moved to the top of the file. No assertion changed. | Task 8's `createApp` grew a `deps` parameter defaulted to the real site singleton (`= { site }`), solely to keep these four tests compiling with one argument. `code-style.md` bans exactly this — a default that falls back to a module singleton smuggles the dependency-injection seam back out through the signature. From Task 9 onward `/{secret}/health` calls the real site; a test that forgot to inject would silently hit `ashutoshverma.dev`. Ruling: keep `deps` **required**. These four tests are the only reason the default existed, so making them pass a fake explicitly removes the need for it. Source follow-up (not made by the test agent): remove the `= { site }` default in `src/index.ts` so `createApp`'s second argument is required. |
| 2026-07-31 | `src/index.test.ts` (T-05) | Changed the final assertion from `expect(Object.keys(body.checks)).toEqual([])` to `expect(Object.keys(body.checks)).toContain("site")`. | T-05's original assertion was correct for Slice 1, where `design.md` Slice 1 acceptance criterion 2 states an empty `checks` object is the right answer. Task 9 (Slice 2) adds a real site check to the same route, so an empty object stops being correct. T-05 keeps testing "the route is reachable and returns a checks object"; the pass/fail value of the check is now T-16 and T-17's job, not T-05's — so the new assertion checks presence only, not status. |

---

## Session notes

Newest first. Keep entries short — this is a handoff, not a diary.

### 2026-07-31 — Task 10 done. The mobile connector works. Spec complete

**The custom connector works in the Claude mobile app.** That is the riskiest unknown in
`mcp-design.md`, the stated premise of this project (`design.md` Risk 4), and the reason
ADR-001 reordered the whole build plan to get here in two slices instead of six tools.
It was worth answering first, and the answer is yes.

Verified by the user against `https://mcp.ashutoshverma.dev/{secret}/mcp`:

| # | Slice 2 acceptance criterion | Result |
|---|---|---|
| 1 | Connector added in Claude Code, claude.ai **and** mobile | met — all three |
| 2 | "list my published writing" returns the real posts on each | met — all three |
| 3 | Site unreachable → actionable sentence, still HTTP 200 | met by T-13; not re-run by hand against the live site |
| 4 | `/{secret}/health` → 503 naming `site` when the site is down | met by T-17; not re-run by hand |
| 5 | The mobile answer is written down either way | met — this note |

- **Cold start is not a problem in practice.** No client timed out or gave up on the ~5.7s
  wake. **This is the user's qualitative report, not a measured number** — nobody timed a
  real tool call paying a site fetch on top, and the Task 4 note's request for that
  measurement is therefore still technically unanswered. It is no longer worth chasing:
  the reason to want the number was to decide whether to spend money on it, and that
  decision is now made.
- **Nothing was built for the cold start, and nothing should be.** Both candidate changes
  — deleting `fly.toml`'s `[[http_service.checks]]` block, or `min_machines_running = 1`
  at ~$3/month — are **rejected, not deferred.** design.md Risk 3 said to record the
  number and build nothing unless it actually bit. It did not bite. The `ponytail:` note
  in `fly.toml` about `grace_period` stays as a pointer for anyone who revisits this, but
  there is no longer a reason to.
- **What this does not prove.** Three clients on one network on one day, by one user, on
  the happy path. The failure paths (criteria 3 and 4) are covered by tests, not by a
  hand-run against a genuinely down site.

### 2026-07-31 — Custom hostname live; Slice 2 deployed

Slice 2 merged as PR #3 (`bc66cef`) and was deployed with `fly deploy --ha=false`. One
machine, 52 MB image, exit 0.

- **`mcp.ashutoshverma.dev` now resolves to Fly.** This closes the item the 2026-07-30
  Task 4 note left open — that entry's acceptance table says the custom hostname was not
  set up, and it is now, so **Slice 1 acceptance criterion 1 is met on the intended
  domain.** `ashutoshverma-mcp.fly.dev` still works; both reach the same machine.
- **The DNS is at Vercel, not the registrar** — `ashutoshverma.dev` uses
  `ns1/ns2.vercel-dns.com`. The record is a **CNAME `mcp` → `ashutoshverma-mcp.fly.dev`**,
  added in the Vercel dashboard. `fly certs add` then issued a Let's Encrypt certificate
  and verified it on the first check.
  **Fly's own output recommends `A`/`AAAA` records instead. They were not added and are
  not needed** — the CNAME verified, and Fly's shared IPv4 routes by SNI. Recorded because
  the next person to read that output will be tempted to follow it.
- **Verified live on the new hostname:** `GET /health` → 200, and `/some-typo-path` → 404
  `text/plain;charset=utf-8`, so Slice 1's single-404 shape survives the domain change.
- **Cold start re-measured after mounting the MCP handler: 5.75s cold, 0.74s warm.**
  Unchanged from Slice 1's ~5.4–5.7s, so the handler costs nothing at startup.
  **This is still `GET /health`, which does no I/O** — the "real tool call with a site
  fetch on top" measurement the Task 4 note asked for has *not* been taken. It needs a
  real MCP call, so it happens when Task 10 runs.
- **Nothing was built for the cold start,** per design.md Risk 3. The two options were put
  to the user: delete `fly.toml`'s `[[http_service.checks]]` block (free, tests the
  untested `grace_period` hypothesis already recorded in that file) or set
  `min_machines_running = 1` (~$3/month, removes the cold start entirely). **The prior
  question is whether any of the three clients actually times out at 5.7s — Task 10
  answers that, and if none do, neither change is worth making.**
- **Connector URL is `https://mcp.ashutoshverma.dev/{secret}/mcp`.** Task 10 ran against
  it — see the note above.

### 2026-07-31 — Tasks 8 and 9 done, in one commit

**They share a commit, deliberately.** Task 9's RED (T-16, T-17, and the T-05 revision)
was appended to `src/index.test.ts` — the same file as Task 8's T-08/T-09 — so splitting
them meant committing a red suite. One green commit beat two commits where the first is
broken. Both task IDs and all six test IDs are in the message.

- **`createApp`'s `deps` is required, with no default.** The coder first defaulted it to
  the real `site` singleton so the four Slice 1 tests kept compiling, and flagged it. The
  test agent ruled against it on `code-style.md` grounds: a default that falls back to a
  module singleton smuggles the dependency back through the seam, and **from Task 9 on the
  health route calls the site for real** — a test that forgot to inject would quietly hit
  `ashutoshverma.dev` and pass or fail on the weather. Now it is a compile error.
  **This is the second test revision in the table and the reason for it.**
- **`.mount("/mcp", handler.fetch)` worked exactly as `tech-stack.yaml` recorded.** No
  cast, no manual `.all()` route with hand-rolled body forwarding. That entry was written
  from a type declaration in Task 1 and is now confirmed against a running server.
- **The deep health check does a real network call, but Fly's 30s probe never reaches it.**
  `fly.toml` points the probe at the public `GET /health`, which does no I/O. The site
  fetch fires only when someone calls `/{secret}/health` by hand. **ADR-001's auto-stop
  cost model is unaffected.** Recorded because it is the obvious thing to worry about here,
  and the answer is "no" — nothing was built for it.
- **Known gap, unchanged from Task 7:** no test drives a *failing* or *non-empty* site
  through the MCP handler. Both are covered at the service layer (T-11…T-14). design.md's
  test list does not ask for more.

### 2026-07-31 — Task 7 done

**Three SDK behaviours discovered empirically. None of them was documented anywhere in
this repo, and all three are load bearing for Tasks 8–10.**

- **The handler answers a stateless POST as SSE, not JSON.** With
  `Accept: application/json, text/event-stream`, a bare `tools/list` comes back
  `text/event-stream` — one `event: message` frame whose `data:` line holds the JSON-RPC
  response. **Any future test that reads `response.json()` off this handler will fail.**
  Parse the `data:` line.
- **No `initialize` handshake is needed for a bare `tools/list` / `tools/call` POST.**
  `CreateMcpHandlerOptions.legacy` defaults to `'stateless'`, which answers each legacy
  request from a fresh factory instance. No options are passed to `createMcpHandler` and
  none should be added without a test that fails without them.
- **The SDK validates tool arguments itself and folds a Zod failure into a normal tool
  result** — `isError: true`, allowed enum values in the text, HTTP 200. **T-15 needs no
  hand-rolled `kind` check and none was written.**

Also:

- **The union overload on `listContent` is load bearing after all** — its probation from
  Task 6 is over. The tool callback receives `kind` widened to `"writing" | "project"`, so
  it resolves to exactly that third signature. **Do not delete it.**
- **The tool description was diffed character for character against `design.md`** →
  Approach → The tool description. Byte-identical, em dash included.
- **Known coverage gap at the tool layer.** `index.test.ts`'s fake site returns `[]`, so
  only the empty-catalogue branch runs through `createHandler`. The error branch and the
  non-empty listing branch are covered at the *service* layer (T-11…T-14) but never through
  the MCP handler. design.md's test list does not ask for more; recorded, not built.

### 2026-07-31 — Task 6 done

- **Result shape is `{ ok: true; items } | { ok: false; error }`**, chosen by the test agent
  and written at the top of `list-content.test.ts`. That comment is the source of truth for
  Task 7 — read it before writing the tool.
- **`listContent` is declared with three overloads, not a generic.** A generic
  `<K extends Kind>` cannot return `parsed.data` without a cast, and casts are banned. The
  overloads keep the file cast-free while letting T-12 do `items.map((i) => i.stack)` on a
  literal `kind: "project"` call.
  **The third (union) overload is on probation.** The test agent's read: T-13 and T-14 do
  not need it — it exists so a caller holding a widened `"writing" | "project"` gets a
  usable return type, since `ReturnType` resolves to the *last* overload. **If Task 7's tool
  passes a literal kind and never needs it, delete it.**
- **Zod's own issue text is deliberately not used in the error string.** It says
  "received undefined" for a missing field, which would put the literal `"undefined"` into a
  tool result and fail T-14. The message names the failing field paths instead. A non-array
  root (`{}`, `null`) degrades to `(fields: )` — ugly, no test covers it, left alone.
- **One formatting fix to `list-content.test.ts`** via `bun run format` — Biome line-wrap on
  a long `throw`. Whitespace only, verified against the diff. **Not a test revision**, so it
  is not in the table below.

### 2026-07-31 — Task 5 done, Slice 2 opened on a new branch

- **Branch is `feat/list-content`.** Slice 1 merged as PR #2 (`f4d32fd`); this branch is cut
  from that merge, per the note below.
- **Decided: `lib/site.ts` fetches, the service parses.** `design.md` reads two ways here —
  Task 5's row says "parse with Zod at the boundary", but T-14 hands `listContent` a **fake
  site** returning `[{nope:1}]`. If `site.ts` parsed internally and returned typed data,
  that fake would need a banned cast to typecheck, and it would bypass the real parse
  anyway — T-14 would assert nothing. So `Site.fetchContent(kind)` returns `unknown`, the
  schemas live in `site.ts` (it is still the boundary module), and `listContent` runs
  `safeParse`. **This is the shape Task 6 and Task 7 build on.**
- **`status` is `z.string()`, not `z.enum`.** The site's allowed values were never verified.
  A guessed enum turns a valid entry into a production parse failure the day the site adds
  a status. Same reasoning for `stack` as `z.array(z.string())`.
- **`site.test.ts` does not test `fetchContent` or `fetch` at all** — `testing.md` says a
  thin wrapper over someone else's API tested against a mock of that API tests the mock.
  Only the Zod parse, which is ours, is tested.
- **Next:** Task 6 — the RED test `src/services/list-content.test.ts` is already written
  (T-11…T-14 plus the empty-list edge case) and confirmed failing on the missing module.

### 2026-07-31 — Slice 1 closed, PR opened

Task 4's row said `green` / "deploy pending" while the note below it recorded a finished
deploy and all five acceptance criteria met. The row was the stale one; corrected to `done`
with its three commits. No code changed — 8 tests pass, `docs:check` clean.

Slice 2 starts from Task 5 **after** the Slice 1 PR merges, on a fresh branch. Do not build
it onto `feat/server-skeleton` — that PR is already over the file limit on its own.

### 2026-07-30 — Task 4 deployed

Live at `https://ashutoshverma-mcp.fly.dev`. One machine, `bom`, health check passing.

- **Cold start is ~5.4s, not ~1s.** Three samples from a deliberately stopped machine:
  5.62s, 5.48s, 5.38s. Warm is ~0.75s. **`design.md` Risk 3 assumed "around a second" and
  called it "expected to be a non-issue" — that assumption is wrong by roughly 5×.** The
  number is recorded, nothing was built for it, and the `min_machines_running = 1` trade
  is the user's call exactly as Risk 3 says. Re-measure from Slice 2, when a real tool
  call also pays a site fetch on top of this.
- **App is `ashutoshverma-mcp`, not `portfolio-mcp`** — the latter is taken, Fly app names
  are global. Cosmetic; the intended hostname is `mcp.ashutoshverma.dev` via CNAME.
- **The first deploy failed on the `prepare` script.** `package.json` runs
  `bash .claude/hooks/install-git-hooks.sh` on install; the Alpine image has no bash and
  no `.git`. Fixed with `--ignore-scripts` in the Dockerfile. None of the three runtime
  dependencies is native, so nothing else needed a lifecycle script.
- **`fly deploy` tries to create a second machine for HA** and it failed with "no capacity
  available in bom". Harmless — one machine is what ADR-001 asked for — but it makes the
  deploy exit non-zero. **Use `fly deploy --ha=false`.** `min_machines_running = 0` does
  not suppress it, despite what Fly's own hint says.
- **Bun auto-loads `.env`.** No dotenv package is needed, and `bun --watch src/index.ts`
  just works locally. It also means unsetting a variable in the shell does **not** unset
  it for the process — a boot-failure check has to use
  `bun --env-file=<empty> src/index.ts` or it silently passes.

**Acceptance criteria**

| # | Criterion | State |
|---|---|---|
| 1 | 200 from a stopped machine | met on `ashutoshverma-mcp.fly.dev`; **custom hostname not set up** — needs a CNAME at the DNS provider, then `fly certs add` |
| 2 | `GET /{secret}/health` → 200 with `checks` | met — returns `{"checks":{}}` |
| 3 | Every other path is the same 404 | met — `/`, `/some-typo-path` and a wrong secret all return `NOT_FOUND` / 404 / `text/plain;charset=utf-8`, byte-identical in production |
| 4 | Refuses to boot on a missing or short secret | met — exit 1, and the error's `path` names `MCP_SECRET_PATH` |
| 5 | Cold start measured and written down | met — ~5.4s, above |

**Auto-stop is verified.** The machine stopped on its own after ~9 idle minutes with the
30s health check active, so proxy-issued checks do **not** hold it awake and ADR-001's
cost model holds. A fourth cold-start sample taken against that naturally-idle machine —
the truest measurement, since it is exactly what a real tool call pays — came in at
**5.66s**, matching the three forced-stop samples.

**Untested hypothesis on the cold start:** `[[http_service.checks]]` sets
`grace_period = "10s"`, and Fly's proxy may wait for a check to pass before routing to a
machine it has just woken. Nobody has ruled that block out as a contributor to the 5.4s.
Deleting it and re-measuring is the cheapest experiment if the number needs to come down.
Not done here — Risk 3 says to record the number and build nothing.

**Still open before Slice 1 closes:** the custom hostname. `mcp.ashutoshverma.dev`
currently resolves to Vercel (`64.29.17.1`, `216.198.79.1`), not Fly. Repointing it is a
change to the live domain at the registrar and is the user's to make; then
`fly certs add mcp.ashutoshverma.dev`. Slice 1 otherwise meets every criterion on
`ashutoshverma-mcp.fly.dev`, which works identically as a connector URL.

### 2026-07-30 — Task 4 config written, deploy pending

- **Done:** `Dockerfile`, `.dockerignore`, `fly.toml`, `.env.example`. Base image pinned to
  `oven/bun:1.3.14-alpine`, matching `packageManager`; the tag was confirmed to exist on
  Docker Hub, not assumed. No build step — Bun runs the TypeScript directly.
- **Region is `bom`,** matching the user's existing Fly apps. Noted at the time that the
  real caller is Anthropic's cloud, not the phone, so a US region would cut a round trip
  per tool call. The user chose `bom` with that trade in front of them. Revisit only if
  latency actually bites.
- **Watch out for:** `fly.toml` has an `[[http_service.checks]]` block, and it is
  **unverified** whether proxy-issued checks keep an `auto_stop_machines` machine awake.
  If it never stops, the cost model in ADR-001 breaks. Acceptance criterion 1 measures a
  cold start from a stopped machine, so the first deploy settles it — the fix is deleting
  the block. Marked with a `ponytail:` comment in the file.
- **VM is 512mb,** not the 256mb minimum. Deliberate: an OOM would land inside the
  mobile-connector experiment this slice exists to run, and idle machines cost nothing.
- **Not done:** the deploy itself, the custom hostname, and the cold-start number. The
  human runs those — `flyctl` is installed and authenticated, but creating a billable
  machine and setting `MCP_SECRET_PATH` are not an agent's call. The secret is generated
  by the human and set with `fly secrets set`; it never passes through an agent or a file.
- **Next:** deploy, then record the cold-start timing here and in `summary.md`. Task 4 is
  not `done` until acceptance criteria 1 and 5 are met.

### 2026-07-30 — Task 3 done

- **Done:** `createApp(env)` is the seam — env passed as an argument, boot guarded by
  `import.meta.main` so importing the module binds no port.
- **The 404 needed zero code.** The secret is a literal `.group()` prefix, so a wrong
  secret matches no route and gets Elysia's own unmatched-route 404 — byte-identical to
  any typo, including content-type. If anyone later adds an `onError` for `NOT_FOUND`,
  T-06 and T-07 are what catch the regression.
- **`Response.json()` types as `unknown`** under tsgo + `@types/bun` with
  `lib: ["ESNext"]`. Test bodies must be narrowed with a guard. Expect this in every
  future HTTP test.
- **Next:** Task 4 — Dockerfile, `.dockerignore`, `fly.toml`, `.env.example`, deploy, and
  **measure cold start** (design.md Risk 3). No automated test; verified by hand and
  written into `summary.md`.

### 2026-07-30 — Task 2 done

- **Done:** `src/lib/env.ts` with `parseEnv(source = process.env)` as the test seam — env
  is an argument so tests pass an object literal, no `process.env` mutation. Schema is
  `MCP_SECRET_PATH` (min 32) and `PORT` (coerced, default 3000), nothing else. Type is
  `z.infer<typeof envSchema>`, not hand-written.
- **Watch out for:** Zod's raw `ZodError` message already contains both the variable name
  and `32`, so `parseEnv` does a bare `parse` with no try/catch. A future custom error
  message must still contain both, or T-01 and T-02 regress.
- **Correction to the Task 1 note below:** it claims `bun test` and `bun run typecheck`
  "both go green the moment Task 2 creates the first file." That was wrong about
  typecheck — `tsconfig.json` needed `"types": ["bun"]` because tsgo does not
  auto-discover `@types/bun`. Fixed in this commit.
- **Next:** Task 3 — `src/index.ts`, tests T-04…T-07. The 404 shape is the
  security-relevant part; T-06 and T-07 compare bodies byte for byte.

### 2026-07-30 — Task 1 done

- **Done:** Spec approved. Task 1: flat package (no Turborepo, per ADR-001), TS strict
  with `noUncheckedIndexedAccess`, Biome 2.5.6, `bun.lock` committed. Installed
  `elysia@1.4.29`, `zod@4.4.3`, `@modelcontextprotocol/server@~2.0.0`, and dev
  `typescript@7.0.2`, `@types/bun`. **Not** installed: `octokit` and `@mdx-js/mdx` — ADR-001
  lists them, but nothing in this spec touches GitHub or MDX.
- **State:** Scaffold green. Both Task 1 verifications came back positive.
- **Next:** Task 2 — write `src/lib/env.test.ts` first (T-01, T-02, T-03), confirm it fails
  for the right reason, then `src/lib/env.ts`.
- **Watch out for:**
  - **`bun test` and `bun run typecheck` both error on an empty `src/`** — "0 test files"
    and `TS18003: No inputs were found`. Expected at this commit; both go green the moment
    Task 2 creates the first file. Not a broken scaffold.
  - **`createMcpHandler` takes a factory, not a server.** Signature is
    `(factory: (ctx) => McpServer | Server | Promise<...>, options?)`, and the factory runs
    **once per HTTP request**. Task 7 builds the server inside it. This spec originally
    assumed a single options argument.
  - `zod@4.4.3` here matches the `portfolio` repo's version exactly, and the SDK requires
    `^4.2.0`. Keep them aligned.

### 2026-07-30 — spec scaffolded

- **Done:** Spec written from ADR-001. Four live facts checked against the real site and
  the real package; all four are recorded in `design.md`.
- **Resolved at the gate:** server computes `readingTime`; `publish` selects
  `schema[kind]`; both corrected in `mcp-design.md`. `list_content`'s description written.
  Slice 1's 10-file count accepted.
