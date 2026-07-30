# Server Skeleton — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** not-started
- **Branch:** `feat/server-skeleton`
- **Spec:** `design.md` · **ADR:** `docs/adr/001-server-runtime-and-shape.md`
- **Current task:** none — waiting on spec approval

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
| 1 | Scaffold: Bun, TS strict, Biome, scripts, deps | — | — | 1 | `pending` | 0/3 | — |
| 2 | `src/lib/env.ts` — Zod env schema, parsed at boot | 1 | T-01, T-02, T-03 | 1 | `pending` | 0/3 | — |
| 3 | `src/index.ts` — Elysia, `GET /health`, secret prefix, `GET /{secret}/health` with empty checks, one 404 shape | 2 | T-04, T-05, T-06, T-07 | 1 | `pending` | 0/3 | — |
| 4 | `Dockerfile`, `.dockerignore`, `fly.toml`, `.env.example`; deploy; measure cold start | 3 | — | 1 | `pending` | 0/3 | — |
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
| | | | |

---

## Session notes

Newest first. Keep entries short — this is a handoff, not a diary.

### 2026-07-30

- **Done:** Spec scaffolded from ADR-001. No code written.
- **State:** Waiting at the spec gate. `design.md` is `draft`.
- **Next:** Human approves the slice plan, then Task 1.
- **Watch out for:** Three live facts checked while writing this spec contradict the
  design docs. All are recorded in `design.md`:
  1. `api/schema.json` is a **map** of two schemas keyed `writing` and `project`, not a
     single schema as `mcp-design.md` describes. Bites at `publish`, not here.
  2. The `writing` schema **requires `readingTime`**, which `mcp-design.md`'s metadata
     section never mentions. `publish` cannot build a valid writing until that is
     answered.
  3. `ajv` is not a declared dependency of the MCP SDK or its core package, despite
     ADR-001 and `tech-stack.yaml` both stating it ships bundled. Presumed bundled into
     `dist`; unconfirmed.
