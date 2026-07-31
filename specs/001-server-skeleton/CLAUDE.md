# CLAUDE.md — Server Skeleton

Feature-specific instructions. Read this **first**, before `design.md`.

- **Spec:** `specs/001-server-skeleton/`
- **Source ADR:** `docs/adr/001-server-runtime-and-shape.md`
- **Branch:** `feat/server-skeleton`
- **Workflow:** [`SPEC-WORKFLOW.md`](../../SPEC-WORKFLOW.md) — the loop, retry limits, and
  file ownership rules apply here in full.

---

## Context

The first code in this repo. A Bun process on Fly.io that answers a liveness probe, hides
everything else behind an unguessable URL path, and serves one MCP tool that reads
published content from `ashutoshverma.dev`'s live JSON routes. Its real job is to find out
whether a custom connector works in the Claude mobile app, using the least code that can
answer the question.

---

## Before writing anything

1. Read `design.md` — scope, files touched, test cases.
2. Read `implementation.md` — this is the source of truth for current state.
3. If any task is `blocked`, **stop and report it.** Do not start other tasks.
4. Confirm you are on `feat/server-skeleton`.
5. Read `../../CONTEXT.md` for the domain vocabulary. Use those exact words.

---

## Which agent am I?

| If you are the… | You may write | You may **never** write |
|---|---|---|
| Test agent | `*.test.ts` | source files |
| Coder agent | source files, `implementation.md` | **any test file** |

If you are the coder agent and you believe a test is wrong: **stop and escalate.**
Do not edit it, skip it, or weaken the assertion. That path produces a green suite that
proves nothing, and it is the single failure mode this workflow exists to prevent.

---

## Reference implementations

**There are none.** This is the first code in the repo, so there is nothing to imitate and
no established pattern to match. That cuts both ways: every choice made here becomes the
pattern the next five slices copy. Get the shapes below right, because they are load
bearing.

The nearest thing to a reference is the `portfolio` repo's `specs/mcp-content-api/check.ts`
— plain assertions, no framework. Same spirit applies here.

---

## Patterns for this feature

**The layer chain is `tools → services → lib`.** Not the four-layer default in
`tech-stack.yaml` — ADR-001 records the deviation, and
[`code-style.md`](../../.claude/rules/code-style.md) is already corrected. There is no
`repository/` layer and no database.

- **`src/tools/` is the only place the MCP SDK may be imported.** If an SDK type appears
  in `services/` or `lib/`, the boundary has leaked.
- **Services take dependencies as an argument.** `listContent(deps, args)`, never
  `import { site } from "../lib/site"`. That signature is the test seam.
- **`lib/` never imports from `services/` or `tools/`.** Never call upward.

**Errors are returned, not thrown.** A tool that fails returns an error result with a
sentence the model can act on, and the HTTP response is still 200. Elysia's `onError` is
for genuine crashes only — it will never see a tool failure, and ADR-001 says so
explicitly.

**Every external response is parsed, not trusted.** The site is a separate repo deployed
separately. Its JSON gets a Zod schema in `lib/site.ts`. Types come from `z.infer`; never
hand-write a type next to a schema.

**The schemas live in `lib/site.ts`; the parse runs in the service.** `fetchContent`
returns `unknown` deliberately — that is what lets a test hand `listContent` a fake site
returning a bad shape without a cast, and still exercise the real schema. Settled in
Task 5; see `design.md` → Request flow.

**The 404 must be identical everywhere.** A wrong secret, an unknown path, and a typo all
produce the same status and the same bytes. Anything that distinguishes them tells an
attacker the secret path exists. This is the whole auth model — see
[`security.md`](../../.claude/rules/security.md).

**The tool description is specified, not yours to invent.** `design.md` → Approach → The
tool description holds the exact text. Two rules behind it: never name a tool that is not
registered, and never let `writing` and `post` blur — they are different things in
`CONTEXT.md` and a model will conflate them given the chance.

**Live facts, already checked — do not re-derive them:**

- `api/writing/content.json` is a bare array; keys are `slug`, `title`, `date`,
  `readingTime`, `summary`.
- `api/projects/content.json` is a bare array; keys are `slug`, `title`, `summary`,
  `stack`, `status`, `repo`, and optionally `demo`, `show`, `order`.
- `@modelcontextprotocol/server@2.0.0` exports `createMcpHandler`, `McpServer`, and
  `fromJsonSchema` from the root, plus subpaths `./stdio`, `./validators/ajv`,
  `./validators/cf-worker`. It depends on `zod ^4.2.0`, so **zod must be v4**.

---

## Don't

- Don't build anything not in `design.md`. New ideas go to **Deferred work** in
  `summary.md`.
- Don't skip tests, and don't write code before the failing test exists.
- Don't mark a task `done` yourself — the test agent confirms the pass.
- Don't continue past a `blocked` task.
- Don't batch documentation updates; they ship in the same commit as the change.
- **Don't touch GitHub.** No octokit, no App, no tokens, no `workshop`. That is the next
  slice and it has an external prerequisite that does not exist yet.
- **Don't add `state` or `kind: "post"` to `list_content`.** Both need `workshop`. The
  enum is `writing | project` and nothing else until the repo exists.
- **Don't `bun add ajv`,** and don't add JSON Schema validation at all — nothing in this
  spec validates against the site's schema. Task 1 records whether the SDK's bundled ajv
  resolves; that is a note for a later slice, not work for this one.
- **Don't log the request path.** The secret is in it.
- **Don't add a logger, an HTTP client, a rate limiter, or a second framework.** Bun has
  `fetch`, Fly has logs, and there is one user making ~15 calls a week.
