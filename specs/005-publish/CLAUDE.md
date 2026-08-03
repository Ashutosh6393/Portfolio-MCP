# CLAUDE.md — Publish

Feature-specific instructions. Read this **first**, before `design.md`.

- **Spec:** `specs/005-publish/`
- **Source ADR:** `docs/adr/005-publish-opens-a-pull-request.md` — read it in full. Seven
  decisions, four of them checked against the live site rather than assumed.
- **Branch:** `feat/publish`
- **Workflow:** [`SPEC-WORKFLOW.md`](../../SPEC-WORKFLOW.md) — the loop, retry limits, and
  file ownership rules apply here in full.

---

## Context

The last of the six tools, and the only one that writes to the **public** repo. A draft in
`workshop` is validated against the site's live schema, rendered into `portfolio` on a
branch, and offered as a pull request. Along the way `get_content` learns to read published
content, which is what makes revising an existing post possible from a phone.

Everything up to here has been reversible. This is not: a merged PR is the live site.

---

## Before writing anything

1. Read `design.md` — scope, files touched, test cases.
2. Read `implementation.md` — this is the source of truth for current state.
3. If any task is `blocked`, **stop and report it.** Do not start other tasks.
4. Confirm you are on `feat/publish`.
5. Read `../../CONTEXT.md` for the domain vocabulary. `writing`, `project`, `post`,
   `draft`, `published`, `publish`, `revise`, `slug` each mean one specific thing and none
   is a synonym for another.
6. **Slice 3 does not start until M-2 has passed.** The ruleset on `portfolio`'s `main` is
   already configured, but M-2 — proving it refuses a push with *this* token — has not run.
   That is the prerequisite. If it has not been confirmed, stop and ask.

---

## Which agent am I?

| If you are the… | You may write | You may **never** write |
|---|---|---|
| Test agent | `*.test.ts` | source files |
| Coder agent | source files, `implementation.md` | **any test file** |

If you are the coder agent and you believe a test is wrong: **stop and escalate.** Do not
edit it, skip it, or weaken the assertion. That path produces a green suite that proves
nothing, and it is the single failure mode this workflow exists to prevent.

---

## Reference implementations

Every one of these already exists. This feature invents no new shape.

| Concern | Follow the pattern in |
|---|---|
| A pure `lib` module, no network | `src/lib/draft.ts` |
| A `lib` module with a schema and a fetch | `src/lib/site.ts` |
| A `lib` module with errors and a request helper | `src/lib/github.ts` |
| A service taking `deps` | `src/services/save-draft.ts` |
| A service branching on error type | `describeWriteFailure` in `src/services/save-draft.ts` |
| A service reading and refusing | `src/services/get-content.ts` |
| Service tests with fake deps | `src/services/save-draft.test.ts` |
| A tool + a specified description | `src/tools/save-draft.ts` |
| A tool with a `state` argument | `src/tools/list-content.ts` |
| Tool tests through the MCP handler | `src/tools/index.test.ts` |
| Tool registration | `src/tools/index.ts` |
| A health check | `src/index.ts` |

---

## Facts already established — do not re-derive them

Checked live on 2026-08-03. Re-checking costs a call and risks writing a guess into code.

- **Published paths are `content/writing/{slug}.mdx` and `content/projects/{slug}.mdx`.**
  The project directory is **plural**. The domain word is singular. Both are correct in
  their own place and mixing them is the most likely bug in this feature.
- The default branch on `portfolio` is `main`.
- `readingTime` on live posts is formatted `{n} min` — `"16 min"`, `"14 min"`.
- `api/schema.json` returns `{ writing: {...}, project: {...} }` — two complete
  draft-2020-12 documents. Select `schema[kind]`; never hand the envelope to a validator.
- The schema uses **eleven** keywords: `$schema`, `type`, `properties`, `required`,
  `additionalProperties`, `minLength`, `minItems`, `items`, `enum`, `format`, `pattern`.
  No `$ref`, no `allOf`/`anyOf`.
  - **`$schema` is on both documents** and names the dialect. It is an annotation, not a
    constraint, so recognising it satisfies nothing.
  - **`items` carries a constraint, not just a type**: `stack.items` is
    `{ "type": "string", "minLength": 1 }`. The scalar constraints are implemented inside
    `items`; `items.items` and `items.minItems` are still refused.
  - This bullet said "exactly ten" and "no nesting past one array of strings" until
    2026-08-03. Both were wrong, and the interpreter written to them refused every real
    post. Corrected against the live route.
- Both live projects are featured: `scaffold-ai` (`show: true, order: 1`) and `yapper`
  (`show: true, order: 2`). Live writings carry neither key.
- Published files in `portfolio` are hand-written **JS object literals** with unquoted keys.
  `renderDraft` emits JSON-shaped metadata. Both are valid JS and MDX compiles either.
- `list_content`'s `state` is **required**, not optional. `get_content` mirrors it.
- **The token needs `Contents: write` AND `Pull requests: write` on `portfolio`.** They are
  separate fine-grained permissions. ADR-005 decision 8 says otherwise and is wrong —
  verified live during M-1, `POST /pulls` returns 403 without the second one.
- **`delete_branch_on_merge` is OFF on `Portfolio-new`**, so a merged publish branch survives.
- Repo constants live in `lib/github.ts`, never in env. The site repo is `Portfolio-new`;
  the domain word stays `portfolio`.
- `zod` is v4. `@modelcontextprotocol/server@2.0.0` wants `inputSchema` as a `z.object({})`.
- The MCP SDK answers a stateless POST as `text/event-stream`, one `event: message` frame.
  `src/tools/index.test.ts` already has the helper that reads it.

---

## Patterns for this feature

**The layer chain is `tools → services → lib`.** No `repository/`, no database. Only
`src/tools/` imports the MCP SDK, and a tool must not import `lib` for anything but a
`type`. If a tool needs a path string, the service returns it — `discardDraft` already
solved exactly this by returning `{ ok: true; path }`.

**Validate, then attach `show`/`order`. Never the other way round.** The write schema is
`additionalProperties: false` and omits both keys, so attaching first fails every project
publish. Skipping the attach drops a featured project off the homepage. T-31 asserts the
ordering, not just the result.

**`readingTime` is computed before validation, `show`/`order` after.** They are not
symmetrical: `readingTime` is in the schema and required; `show`/`order` are forbidden by
it.

**An unknown schema keyword is an error.** Never skip it, never `continue`, never treat it
as satisfied. A validator that ignores what it does not understand is worse than none,
because it produces confidence. This is T-11 and it is the reason a library was not used.

**`format` has exactly one real implementation: `uri`.** `format: "date"` is accepted as
satisfied, deliberately, because the live schema puts a full `pattern` beside it that is
strictly stronger. **Write the comment saying so** — without it the next reader sees a hole.
This is the one documented exception to the rule above; any *other* unrecognised `format`
value is still an error.

**Collect every validation error.** Return `string[]`, not the first failure. One error per
turn costs four round trips on a new writing.

**`renderDraft` is reused for the published file.** Do not write a second serializer, do not
"match the existing style" with unquoted keys, do not hand-roll JS string escaping.

**`readDraft` is only ever pointed at a file this server wrote.** A `portfolio` file is a JS
object literal and `readDraft` will return `null` or plausible-looking wrong metadata.
Published content is read through the site's API, which imports the real object.

**Generalise `github.ts`'s `request` before adding a method that needs it.** It currently
hardcodes `/contents/{path}`. That refactor is its own task, and the existing suite must
stay green across it — five shipped methods depend on it.

**Errors are returned, never thrown.** Every service returns
`{ ok: true; ... } | { ok: false; error: string }`, and every tool turns a refusal into
`isError: true` with HTTP still 200.

**Branch on error type with `instanceof`, never on a message string.** `GithubNotFoundError`,
`GithubConflictError`, `GithubAlreadyExistsError` all exist already.

**A 404 might mean the token scope is wrong.** GitHub answers 404, not 403, for a write it
will not permit. Never write a message stating a file does not exist as a certainty.

**The PR body is specified in `design.md` and asserted by a test.** It is the last place a
wrong slug or a wrong homepage value can be caught. Do not reword it, do not "tidy" it into
a summary. T-39 and T-40 hold it in place.

**Tool descriptions are specified in `design.md`, not authored here.** `save_draft`'s change
is text only — its logic is untouched. Nothing asserts description text, so if you change a
file that holds one, check it by eye against `design.md` in the same commit.

---

## Don't

- Don't build anything not in `design.md`. New ideas go to **Deferred work** in
  `summary.md`.
- Don't skip tests, and don't write code before the failing test exists.
- Don't mark a task `done` yourself — the test agent confirms the pass.
- Don't continue past a `blocked` task.
- Don't batch documentation updates; they ship in the same commit as the change.
- **Don't add a dependency.** No `ajv`, no `@mdx-js/mdx`, no `acorn`, no `octokit`, no
  JSON Schema library, no date library, no URL parser. ADR-005 rejected the first two by
  name and the whole point of decision 1 is that ten keywords need no library. Adding one
  needs a new ADR.
- **Don't parse the MDX body.** ADR-005 decision 2. The Vercel preview build is the check.
  No heuristic for a stray `<` either — `a < b` appears in ordinary prose here.
- **Don't add a `post` kind.** Not to `publish`, not to the enum, not "for later". The
  social post archive is out of scope and needs its own ADR.
- **Don't let a tool choose `show` or `order`.** They arrive as arguments from the human. Do
  not default them, do not infer them from the existing list, do not compute an `order` from
  the count of projects.
- **Don't accept `readingTime` from the draft.** The server computes it. `save_draft`
  already strips it, so a draft carrying one is a bug elsewhere.
- **Don't commit to `main` on `portfolio`.** Every write goes to `publish/{kind}/{slug}`.
  The ruleset will refuse it anyway — that is the point — but the code must never try.
- **Don't merge, approve, or close a PR.** No tool in this repo touches the merge button.
- **Don't record the PR number in the draft file.** ADR-005 decision 5: it invalidates the
  `sha` the model is holding. Find the PR by branch name.
- **Don't write a second draft serializer or a second metadata format.**
- **Don't touch `src/services/list-content.ts` or `src/services/list-drafts.ts`.** `publish`
  calls `listContent`; it does not modify it.
- **Don't change `save_draft`'s behaviour.** Its description text changes. Nothing else.
- **Don't add a cache, a retry, or a rate limiter.** ~15 calls a week against 5,000 an hour.
- **Don't set the commit `author`.** A fine-grained PAT is already the user.
- **Don't surface a raw `JSON.parse` or `ZodError` message** to the model. Name the field or
  the shape; a character offset is useless on a phone.
