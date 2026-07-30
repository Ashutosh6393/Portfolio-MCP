# Server Skeleton — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** in-progress
- **Branch:** `feat/server-skeleton`
- **Spec:** `design.md` · **ADR:** `docs/adr/001-server-runtime-and-shape.md`
- **Current task:** 4 — Dockerfile, .dockerignore, fly.toml, .env.example

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
| 4 | `Dockerfile`, `.dockerignore`, `fly.toml`, `.env.example`; deploy; measure cold start | 3 | — | 1 | `green` (config written; deploy pending — human) | 0/3 | — |
| 5 | `src/lib/site.ts` — fetch the two `content.json` routes, parse with Zod at the boundary | 4 | T-14 | 2 | `pending` | 0/3 | — |
| 6 | `src/services/list-content.ts` — `listContent(deps, args)`, error paths as return values | 5 | T-11, T-12, T-13, T-14 | 2 | `pending` | 0/3 | — |
| 7 | `src/tools/list-content.ts` + `src/tools/index.ts` — build the `McpServer`, register the tool, `createMcpHandler` | 6 | T-10, T-15 | 2 | `pending` | 0/3 | — |
| 8 | Mount the handler at `/{secret}/mcp` in `src/index.ts` | 7 | T-08, T-09 | 2 | `pending` | 0/3 | — |
| 9 | Deep health runs the real site check; 503 on failure | 5, 8 | T-16, T-17 | 2 | `pending` | 0/3 | — |
| 10 | Deploy; connect from Claude Code, claude.ai, and mobile; read a writing on each | 9 | — | 2 | `pending` | 0/3 | — |

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
| 1 | Tasks 1–4 — deployed server, health routes, secret path | 10 | `pending` | — |
| 2 | Tasks 5–10 — MCP handler, `list_content`, deep health check | 5 | `pending` | — |

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

---

## Session notes

Newest first. Keep entries short — this is a handoff, not a diary.

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
