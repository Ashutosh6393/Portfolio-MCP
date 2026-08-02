# CLAUDE.md — Drafts

Feature-specific instructions. Read this **first**, before `design.md`.

- **Spec:** `specs/004-drafts/`
- **Source ADR:** `docs/adr/004-drafts-are-real-mdx-in-workshop.md` — read it in full. It
  was accepted after a review that narrowed the scope; the header block lists what changed
  and the body is the reviewed text.
- **Branch:** `feat/drafts`
- **Workflow:** [`SPEC-WORKFLOW.md`](../../SPEC-WORKFLOW.md) — the loop, retry limits, and
  file ownership rules apply here in full.

---

## Context

The first slice that **writes**. A draft becomes a real MDX file in the private `workshop`
repo, with its metadata in a JSON-shaped `export const metadata = {...}` block the server
writes and reads back. Three new tools — `save_draft`, `get_content`, `discard_draft` — plus
a `state` argument on `list_content`. The point is that an idea had on a train can be
drafted, saved, re-read, edited and thrown away from a phone, with no laptop and no diff to
read.

---

## Before writing anything

1. Read `design.md` — scope, files touched, test cases.
2. Read `implementation.md` — this is the source of truth for current state.
3. If any task is `blocked`, **stop and report it.** Do not start other tasks.
4. Confirm you are on `feat/drafts`.
5. Read `../../CONTEXT.md` for the domain vocabulary. Use those exact words — `writing`,
   `project`, `post`, `draft`, `published`, `slug` all mean something specific and none of
   them is a synonym for another.
6. Read the reference implementations below. **Every one of them already exists** — this
   feature invents one new shape (a pure `lib/` module) and nothing else.

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

Follow these rather than inventing a new shape.

| Concern | Follow the pattern in |
|---|---|
| A `lib/` module and its schemas | `src/lib/github.ts` |
| A service taking `deps` | `src/services/get-skill.ts` |
| Service tests with fake deps | `src/services/get-skill.test.ts` |
| A tool + a specified description | `src/tools/get-skill.ts` |
| Tool tests through the MCP handler | `src/tools/index.test.ts` |
| Tool registration | `src/tools/index.ts` |
| An error class in `lib` | `GithubNotFoundError` in `src/lib/github.ts` |
| A result union with no discriminator tag | `GetSkillResult` in `src/services/get-skill.ts` |

`src/lib/draft.ts` has no precedent because it is the first `lib` module with no network in
it. It is two pure functions, a path builder, and a regex. If it grows a `fetch`, a class,
or a dependency, stop.

---

## Patterns for this feature

**The layer chain is `tools → services → lib`.** No `repository/`, no database. Only
`src/tools/` may import the MCP SDK, and a tool must not import `lib` for anything but a
`type`.

**`JSON.stringify(metadata, null, 2)` — the `2` is load-bearing.** It is what puts the
closing `}` at column 0 on its own line while every nested closer stays indented. With no
indent the whole block is one line and the reader fails on the serializer's own output.
T-05 pins the exact rendered text; if that test looks fussy, that is why.

**`renderDraft` and `readDraft` are exact inverses.** Do not add trimming, normalising,
sorting, or a trailing newline to either one. The round trip (T-01) is the highest-value
test in the slice and every convenience added to one side breaks it.

**The reader is: first `{`, first line that is exactly `}`, `JSON.parse`.** That is the
whole parser. No regex per field, no `eval`, no `new Function`, no dynamic `import()`, no
JS parser. ADR-004 rejected all four by name.

**`readDraft` returns `null` on failure — not a message.** ADR-004 forbids surfacing the
parse error, so there is nothing to carry. The service turns `null` into the one specified
sentence.

**`Buffer.from(x, "base64")`, never `atob`.** GitHub wraps base64 content at 60 characters
and `atob` throws on the embedded newlines. This is the one decode line ADR-004 brings back
after ADR-002 said there would be none.

**Two new error classes, and the service branches with `instanceof`.**
`GithubConflictError` (stale `sha`) and `GithubAlreadyExistsError` (create over an existing
path). Never match an error message string.

**Services take `deps` as an argument and return a result.** `{ ok: true, ... } | { ok:
false; error: string }`. Nothing in this slice throws out of a service, and nothing rejects.

**Errors are returned, not thrown, all the way to the client.** A tool that fails returns
`isError: true` with a sentence the model can act on, and the HTTP response is still 200.

**The four tool descriptions are specified, not yours to invent.** `design.md` → Approach →
The tool descriptions holds the exact text. Two rules behind it: never name a tool that is
not registered, and never blur `writing`, `project` and `post` — they are different things
in `CONTEXT.md`.

**A 404 might mean the token scope is wrong.** GitHub answers 404, not 403, for a write it
will not permit. Never write a message stating "this draft does not exist" as a certainty.
Say what is true: the path could not be read or written.

**Facts already established — do not re-derive them:**

- Owner handle `Ashutosh6393`; repo constants live in `lib/github.ts`, never in env. The
  site repo is `Portfolio-new`; the domain word stays `portfolio`.
- The contents endpoint is `GET|PUT|DELETE /repos/{owner}/{repo}/contents/{path}`. A
  directory listing is an array of entries carrying `name` and `type` (`"file" | "dir"`).
- `Accept: application/vnd.github.raw` returns raw bytes — but **not the `sha`**, which is
  why `readFileWithSha` uses the JSON response and decodes.
- `zod` is v4. `@modelcontextprotocol/server@2.0.0` wants `inputSchema` as a
  `z.object({...})`, not a raw shape record.
- The MCP SDK answers a stateless POST as `text/event-stream`, one `event: message` frame.
  `src/tools/index.test.ts` already has the helper that reads it.
- `workshop` holds `skills/` and `templates/` today. `drafts/{kind}/` does not exist yet and
  **will 404 until the first draft is saved** — that is an empty list, not an error.

---

## Don't

- Don't build anything not in `design.md`. New ideas go to **Deferred work** in
  `summary.md`.
- Don't skip tests, and don't write code before the failing test exists.
- Don't mark a task `done` yourself — the test agent confirms the pass.
- Don't continue past a `blocked` task.
- Don't batch documentation updates; they ship in the same commit as the change.
- **Don't add a dependency.** No `acorn`, no `meriyah`, no MDX package, no YAML parser, no
  base64 library, no `octokit`. ADR-004 rejected a JS parser by name and the whole point of
  the JSON-shaped block is that `JSON.parse` is enough. Adding one needs a new ADR.
- **Don't validate metadata at save.** No required fields, no `api/schema.json` fetch, no
  hand-written Zod copy of the site's schema, no "warn if the title is missing". A draft
  with only a summary is saved without complaint. Validation belongs to `publish`, and a
  second definition of valid is exactly what ADR-004 refused.
- **Don't write to `portfolio`.** The token is read-only there and stays that way. No
  branch, no commit, no PR — those arrive with `publish`.
- **Don't add a `post` kind.** Not to the enum, not to the path, not "for later". A social
  post is never stored: the model drafts it in the conversation with `get_skill` and hands
  it over. `kind` is `"writing" | "project"`, everywhere.
- **Don't build an update tool.** There is no `update_draft`, no `edit_draft`, no `patch`
  argument. Editing is `get_content` → edit → `save_draft` with the `sha`. One tool, one
  file per draft.
- **Don't retry a `sha` mismatch.** It is a refusal. Re-reading and re-applying is the
  model's job, and the refusal tells it so.
- **Don't parse a draft in order to delete it.** `discard_draft` reads the `sha` and
  nothing else. A broken draft must still be removable.
- **Don't surface the `JSON.parse` error** in the unparseable-block refusal. A character
  offset is useless on a phone. The message says to fix it in GitHub and save again.
- **Don't touch `src/services/list-content.ts`.** The `state: "draft"` path is a new
  service. Leaving the published path untouched is what makes "unchanged" provable.
- **Don't add a health check, an env var, or anything to `src/index.ts`.** No new external
  system arrives — this is the same GitHub with a wider token.
- **Don't set the commit `author`.** A fine-grained PAT is already the user.
  `mcp-design.md`'s rule was written for a GitHub App that was rejected.
- **Don't build an undo, a trash, a backup, or draft history.** Git is the history.
- **Don't add a cache, a retry, or a rate limiter.** 15 calls a week against 5,000 an hour.
- **Don't point `readDraft` at a file from `portfolio`.** Those are hand-written JS object
  literals. This parser reads only blocks the server itself wrote, and it will look like the
  right tool when it is not.
