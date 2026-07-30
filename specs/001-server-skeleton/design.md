# Server Skeleton — Design

The plan. Source of truth for **what** gets built. Nothing gets implemented that is not
described here.

> **This is not an ADR.** The decision and its rationale live in
> [`docs/adr/001-server-runtime-and-shape.md`](../../docs/adr/001-server-runtime-and-shape.md).
> This document assumes that decision is made and describes how it lands in the codebase.

- **Source ADR:** `docs/adr/001-server-runtime-and-shape.md`
- **Status:** draft
- **Approved by:** —

> Implementation does not start until Status is `approved`.

---

## What we're building

Slice 1 of [`mcp-design.md`](../../docs/adr/mcp-design.md), in the order ADR-001 rewrote
it. After this ships: a Bun process runs on Fly.io at `mcp.ashutoshverma.dev`, answers a
liveness probe at `GET /health`, and serves an MCP endpoint behind an unguessable URL
path. One tool — `list_content` — returns the published writings and projects by reading
the site's live JSON routes.

The point is not the tool. The point is answering the one question nobody can answer from
a laptop: **does a custom connector actually work in the Claude mobile app?** Everything
here exists to find that out with the least code possible.

## Why now

ADR-001 moved `get_skill` out of Slice 1 because it reads from `workshop`, a repo that
does not exist and has no GitHub App installed. That coupled the cheapest and riskiest
experiment to setup it does not need. This spec is Slice 1 with the external
prerequisites removed.

---

## Scope

### In scope

- Repo scaffold: Bun, TypeScript strict, Biome, `bun:test`
- Env parsing with Zod, validated at boot
- Elysia app with `GET /health` (no I/O — Fly's liveness probe)
- Secret-path auth: every real route lives under `/{secret}/`
- `GET /{secret}/health` — the deep check, **site check only**
- The MCP handler mounted at `/{secret}/mcp`
- One tool: `list_content({ kind })` for `kind: writing | project`, published only
- Dockerfile and `fly.toml`; deployed and reachable
- Connecting from Claude Code, claude.ai, and the mobile app

### Out of scope

- **Anything touching GitHub** — no App, no tokens, no octokit. Slice 2 of the build plan.
- **`kind: "post"` and `state: "draft"`** — both need `workshop`. The tool's argument enum
  accepts `writing | project` only, and there is no `state` argument yet. Widened later.
- **`get_content`, `get_skill`, `save_draft`, `publish`, `discard_draft`** — build slices
  2–4.
- **`schema.json` fetching, MDX parsing, `fromJsonSchema`** — nothing is validated against
  the site's schema until `publish` exists. See Open questions 1 and 2, which must be
  answered before that slice is planned.
- **The remaining two deep-health checks** (mint a GitHub token, reach both repos) — they
  cannot exist before the GitHub App does.
- **Lazy reconciliation, response nudges, rate limiting** — later slices, or explicitly
  rejected in `mcp-design.md`.

Anything discovered mid-build that is not in the in-scope list goes to **Deferred work**
in `summary.md`. It does not get built.

---

## Approach

### Request flow

```
Anthropic cloud
      │
      ▼
Fly.io (auto-start on request)
      │
      ▼
Elysia
  ├── GET  /health            → 200, no I/O. Fly's probe. Outside the secret.
  └── /{secret}                (mismatched secret falls through to the 404 handler)
        ├── GET  /health       → deep check: fetch the site, report per-check status
        └── ALL  /mcp          → mounted MCP handler
                                     │
                                     ▼
                            tools/  (only layer importing the MCP SDK)
                                     │
                                     ▼
                            services/  (deps passed as an argument)
                                     │
                                     ▼
                            lib/site.ts  (fetch + parse the boundary)
```

The chain is `tools → services → lib`, per ADR-001. There is no `repository/` layer and no
database.

### The secret path

`GET /{wrong-secret}/health` must be **indistinguishable** from `GET /anything-else`. Same
status, same body. A response that differs tells an attacker the path exists and turns
guessing into a two-step problem. This is why the guard is a route prefix and not a
middleware that returns 401 — a 401 is itself the oracle.

The secret comes from `MCP_SECRET_PATH`, minimum 32 characters, enforced at boot. A short
secret is the only failure mode of this auth model, so it fails loudly at startup rather
than quietly at request time.

### Services take dependencies as an argument

```ts
export async function listContent(
  deps: { site: Site },
  args: { kind: "writing" | "project" },
) { ... }
```

That is the test seam and it is visible in the signature. A test passes an object literal.
No mocking framework, no `mock.module()`.

### Errors

Tool failures are returned as **tool results**, never thrown. A thrown error gives the
client a bare "tool failed" and the conversation dead-ends; a returned string lands in
context and the model can act on it in the same turn. Elysia's `onError` therefore never
sees a tool failure — it catches genuine faults only, as ADR-001 states.

The HTTP status for a tool that failed is still 200. That is not a bug; it is the protocol.

### The tool description

`CONTEXT.md` says the model is the real caller and that tool wording is "part of the
product, not polish". So the description is specified here rather than left to whoever
writes the file.

**A description may only mention tools that are registered.** Naming `get_content` before
it exists teaches the model to call something that isn't there, and it burns a turn
finding out. Descriptions get revised as tools land, in the slice that lands them.

The one real hazard is vocabulary. `CONTEXT.md` is strict: a **writing** is a blog entry,
a **post** is a social post, and they are different things. A model asked to "list my blog
posts" will reach for `post` unless the description closes that door.

```
List the published content on ashutoshverma.dev.

Returns one entry per item with its slug, title and summary. This is the
catalogue, not the text — use it to see what exists and to get a slug.

kind:
  "writing"  a blog entry, live at /writing/{slug}
  "project"  a portfolio project page, live at /projects/{slug}

Only published content is reachable. Drafts and social posts are not
available from this server yet.
```

The last line exists to stop a retry loop, not to be polite. A model that gets a bare
"invalid kind" will guess again; one that is told drafts are unreachable will stop.

### Data model

**No change.** No database, no Prisma, no migration. ADR-001 records the deviation.

### API surface

| Method | Route | Purpose | Auth |
|---|---|---|---|
| `GET` | `/health` | Liveness. Returns 200, does no I/O | public |
| `GET` | `/{secret}/health` | Deep check. 200 all-pass / 503 any-fail | secret path |
| `ALL` | `/{secret}/mcp` | The MCP Streamable HTTP endpoint | secret path |
| — | anything else | 404, one shape, no information | — |

### Validation

| Boundary | Schema | Lives in |
|---|---|---|
| Environment, at boot | `envSchema` | `src/lib/env.ts` |
| Tool arguments | Zod, per tool | `src/tools/list-content.ts` |
| Site JSON responses | `writingListSchema`, `projectListSchema` | `src/lib/site.ts` |

The site's JSON is a third-party response as far as this server is concerned — a different
repo, deployed separately. Their contract is not our contract, so it gets parsed, not
trusted. Types come from `z.infer`; nothing is hand-written alongside a schema.

### Existing code to reuse

Nothing exists in this repo yet. What is being deliberately *not* built:

- **No HTTP client.** `fetch` is global in Bun.
- **No logger.** ADR-001: platform logs are enough.
- **No ajv, no JSON Schema validation.** Not needed until `publish`. See Risk 2.
- **No test framework.** `bun:test` is the runner.

---

## Files touched

| Path | Change | Layer | Slice |
|---|---|---|---|
| `package.json` | new | config | 1 |
| `tsconfig.json` | new | config | 1 |
| `biome.json` | new | config | 1 |
| `.gitignore` | new | config | 1 |
| `.env.example` | new | config | 1 |
| `src/lib/env.ts` | new | lib | 1 |
| `src/index.ts` | new | entry | 1 |
| `Dockerfile` | new | deploy | 1 |
| `.dockerignore` | new | deploy | 1 |
| `fly.toml` | new | deploy | 1 |
| `src/lib/site.ts` | new | lib | 2 |
| `src/services/list-content.ts` | new | service | 2 |
| `src/tools/list-content.ts` | new | tool | 2 |
| `src/tools/index.ts` | new | tool | 2 |
| `src/index.ts` | modify | entry | 2 |

**Slice 1 is 10 files, which breaks the 5–7 rule.** Eight of them are config with no
logic — `package.json`, `tsconfig.json`, `biome.json`, `.gitignore`, `.env.example`,
`Dockerfile`, `.dockerignore`, `fly.toml`. Only `src/lib/env.ts` and `src/index.ts` carry
behaviour, and the whole slice is under 200 lines. The alternative is a scaffold-only PR
that ships nothing runnable. **Flagged for the reviewer to accept or reject at the gate,
not decided here.**

---

## Test cases

Every task in `implementation.md` maps to one or more of these IDs. If a behaviour is not
listed here, there is no test for it, and it does not get built.

### Seams

| Level | How | Covers |
|---|---|---|
| Unit | Call the schema / service directly with a literal | T-01…T-03, T-11…T-14 |
| HTTP | `app.handle(new Request(...))` — in process, nothing listens | T-04…T-07, T-16, T-17 |
| MCP | A real JSON-RPC body through `app.handle` | T-08…T-10, T-15 |

Tools are exercised **through the MCP handler**, never by calling the tool function
directly — per [testing.md](../../.claude/rules/testing.md). `lib/site.ts`'s `fetch` call
is not unit-tested against a mock of the site; that would test the mock. Its Zod parse is
ours and is tested.

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-01 | Boot fails on missing secret | unit | No `MCP_SECRET_PATH` → parse env → throws, message names the variable |
| T-02 | Boot fails on a guessable secret | unit | `MCP_SECRET_PATH` of 8 chars → parse env → throws, message states the 32-char minimum |
| T-03 | Valid env parses | unit | All vars set → parse env → typed object, type derived via `z.infer` |
| T-04 | Liveness is cheap and public | http | Server up → `GET /health` → 200, and no outbound fetch is made |
| T-05 | Deep health is reachable behind the secret | http | Correct secret → `GET /{secret}/health` → 200 with a `checks` object |
| T-06 | A wrong secret is not an oracle | http | Wrong secret → `GET /{wrong}/health` → 404, byte-identical body to `GET /nonsense` |
| T-07 | Root reveals nothing | http | — → `GET /` → 404, same body as any unknown route |
| T-08 | The MCP endpoint handshakes | mcp | Correct secret → `POST /{secret}/mcp` `initialize` → valid result with a negotiated protocol version |
| T-09 | The MCP endpoint is behind the secret | mcp | Wrong secret → `POST /{wrong}/mcp` `initialize` → 404, same body as any unknown route |
| T-10 | The tool is advertised | mcp | — → `tools/list` → includes `list_content` with a non-empty description and a `kind` enum of exactly `writing`, `project` |
| T-11 | Listing writings | unit | Fake site returning 2 writings → `listContent({site}, {kind:"writing"})` → both slugs and titles present |
| T-12 | Listing projects | unit | Fake site returning 2 projects → `listContent({site}, {kind:"project"})` → both present, `stack` and `status` carried through |
| T-13 | Site is down | unit | Fake site throwing / non-200 → `listContent` → error **result** naming the site, nothing thrown |
| T-14 | Site returns an unexpected shape | unit | Fake site returning `[{nope:1}]` → `listContent` → error result, no crash, no undefined leaking into the response |
| T-15 | Unknown kind is refused | mcp | `tools/call list_content {kind:"post"}` → error result citing the allowed values; HTTP status still 200 |
| T-16 | Deep health passes | http | Site reachable → `GET /{secret}/health` → 200, `checks.site` is `ok` |
| T-17 | Deep health fails loudly | http | Site unreachable → `GET /{secret}/health` → 503, body names `site` as the failed check |

### Edge cases and failure modes

- **Empty content list.** The site returns `[]` — a valid answer, not an error. The tool
  says "no published writings", not an empty blob.
- **Cold start.** Fly auto-stops when idle, so most calls hit a stopped machine. Covered
  by manual verification, not a test. See Risk 3.
- **Concurrent calls.** Not a concern — no shared state, no writes, one user.
- **Authorization.** There is one user and one credential. The only authorization question
  is "is the path right", covered by T-06, T-07, T-09.
- **A tool failure must never become an HTTP error.** Asserted explicitly in T-13 and T-15.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **1. The SDK's handler shape is unverified.** `createMcpHandler(options): McpHttpHandler` and `fromJsonSchema` are confirmed present in `@modelcontextprotocol/server@2.0.0`'s types. **`McpHttpHandler`'s own shape is not** — `tech-stack.yaml` says to mount it as `.mount('/mcp', handler.fetch)`, which nobody has run. | Slice 2 stalls on its first task | Task 1 reads the installed `.d.mts` and confirms the mount expression **before** any other code is written. Blast radius is one file. |
| **2. ajv may not actually ship with the SDK.** Verified against the registry: neither `@modelcontextprotocol/server@2.0.0` nor `@modelcontextprotocol/core@2.0.0` declares `ajv` as a dependency, though a `./validators/ajv` export exists. It is presumably bundled into `dist`, but that is an assumption. If wrong, ADR-001's "adds no dependency" claim and `tech-stack.yaml`'s "do NOT `bun add ajv`" rule are both false. | Nothing in this spec — no schema validation until `publish`. Would block Slice 4. | Task 1 resolves the import once at install time, since we are installing anyway. Record the answer in `summary.md`. Do not act on it here. |
| **3. Cold start is unmeasured.** `auto_stop_machines` is deliberate — it is what makes ~15 calls a week cost near nothing — so nearly every call wakes a stopped machine. Fly machine starts are around a second and Bun adds little, so this is **expected to be a non-issue**; it is listed only because the number has never been looked at. | Low. Would only matter if a client gives up mid-handshake | Note the first request's latency in Task 4. Nothing is built for this. If the number is genuinely bad, `min_machines_running = 1` is a one-line `fly.toml` change that costs money, and that trade is the user's call — not a decision to pre-empt here. |
| **4. The mobile connector may simply not work.** The stated riskiest unknown in the whole plan. Untestable locally. | The project's premise | This slice exists to find out, with ~150 lines rather than six tools. |
| **5. The secret sits in the URL path**, so it lands in Fly's HTTP access logs, and in any proxy in between. `security.md` says never put sensitive data in a URL. | A log reader gets the credential | **Decided, not re-argued** — `mcp-design.md` rejected OAuth for one user, and ADR-001 kept it. Recorded here as an accepted cost. Never log the request path from inside the app. Rotating the secret is an env var change and a redeploy. |

---

## Open questions

Resolve before Status becomes `approved`.

- [x] **1. `list_content`'s tool description.** Written — see Approach → The tool
      description. `mcp-design.md`'s open item 3 asks for all six descriptions; only this
      one is needed now, and the other five are drafted in the slice that registers the
      tool. Writing wording for tools that do not exist would be guessing at a shape that
      has not been built.

Logged for later slices, **not blocking this one**:

- [ ] **2. `api/schema.json` is a map, not a schema.** Verified live: the top level is
      `{ "writing": {...}, "project": {...} }`, two draft-2020-12 schemas. `mcp-design.md`
      describes it in the singular. `publish` must select `schema[kind]` before calling
      `fromJsonSchema`. Affects Slice 4. **owner:** Ashutosh
- [ ] **3. Nothing says who computes `readingTime`.** Verified live: the `writing` schema
      requires `title`, `date`, `readingTime`, `summary` — but `mcp-design.md`'s metadata
      section never mentions `readingTime`. So `publish` cannot construct a valid writing
      today. Either the model passes it, the server computes it, or the site's schema
      changes. Affects Slice 4. **owner:** Ashutosh

---

## Slice plan

### Slice 1 — a deployed server that answers

**Blast radius:** `package.json`, `tsconfig.json`, `biome.json`, `.gitignore`,
`.env.example`, `src/lib/env.ts`, `src/index.ts`, `Dockerfile`, `.dockerignore`,
`fly.toml`, plus tests. **Nothing under `src/tools/`, `src/services/`, or
`src/lib/site.ts`.**

**Acceptance criteria**

1. `curl https://mcp.ashutoshverma.dev/health` returns 200 from a machine that was
   stopped.
2. `GET /{secret}/health` returns 200 with a `checks` object. It is empty — there are no
   checks to run yet, and that is correct for this slice.
3. Every other path returns the same 404. A wrong secret is not distinguishable from a
   typo.
4. The process refuses to start with a missing or under-32-character secret, and says
   which.
5. Cold-start time is measured and written down.

**Test IDs:** T-01, T-02, T-03, T-04, T-05, T-06, T-07

### Slice 2 — read a published writing from a phone

**Blast radius:** `src/lib/site.ts`, `src/services/list-content.ts`,
`src/tools/list-content.ts`, `src/tools/index.ts`, and a modification to `src/index.ts`
that mounts the handler and adds the site check. **No new config, no deploy changes,
nothing GitHub-shaped.**

**Acceptance criteria**

1. The connector is added successfully in Claude Code, claude.ai, **and** the mobile app.
2. On each of the three, "list my published writing" returns the real posts from
   `ashutoshverma.dev`.
3. With the site unreachable, the tool answers with a sentence the model can act on, and
   the call still returns HTTP 200.
4. `GET /{secret}/health` returns 503 and names `site` when the site is down.
5. Whether the mobile app works is written down either way. A "no" here is a successful
   slice — it is the answer this whole plan was ordered to get first.

**Test IDs:** T-08, T-09, T-10, T-11, T-12, T-13, T-14, T-15, T-16, T-17

---

Slice 1 is the walking skeleton: the thinnest path that is genuinely deployed. Slice 2 is
the riskiest work and comes immediately after, because it cannot come first — there is
nothing to mount a handler into until Slice 1 exists.
