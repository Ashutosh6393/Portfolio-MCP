# CLAUDE.md — GitHub Access

Feature-specific instructions. Read this **first**, before `design.md`.

- **Spec:** `specs/002-github-access/`
- **Source ADR:** `docs/adr/002-github-access-and-workshop.md`, amended by
  `docs/adr/003-skills-and-templates-are-separate.md` — **read 003 too.** It replaced the
  `workshop` layout and `get_skill`'s contract after Slice 1 shipped.
- **Branch:** `feat/github-access`
- **Workflow:** [`SPEC-WORKFLOW.md`](../../SPEC-WORKFLOW.md) — the loop, retry limits, and
  file ownership rules apply here in full.

---

## Context

The server's first contact with GitHub. A fine-grained personal access token reaches two
repos through Bun's `fetch`; the deep health check reports whether that works; and one new
tool, `get_skill`, pulls drafting rules and templates out of the private `workshop` repo.
Its job is to make drafting on a phone produce something that sounds like the author rather
than generic LinkedIn voice.

---

## Before writing anything

1. Read `design.md` — scope, files touched, test cases.
2. Read `implementation.md` — this is the source of truth for current state.
3. If any task is `blocked`, **stop and report it.** Do not start other tasks.
4. Confirm you are on `feat/github-access`.
5. Read `../../CONTEXT.md` for the domain vocabulary. Use those exact words.
6. Read the reference implementations below. **Every one of them already exists** — this
   feature invents no new shape.

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

Follow these rather than inventing a new shape. Spec 001 settled all of them.

| Concern | Follow the pattern in |
|---|---|
| A `lib/` reader | `src/lib/site.ts` |
| Schema tests for a `lib/` reader | `src/lib/site.test.ts` |
| A service taking `deps` | `src/services/list-content.ts` |
| Service tests with a fake dep | `src/services/list-content.test.ts` |
| A tool + its description | `src/tools/list-content.ts` |
| Tool tests through the MCP handler | `src/tools/index.test.ts` |
| The deep health check | `src/index.ts` |
| Deep-health tests | `src/index.test.ts` |
| Env schema and its tests | `src/lib/env.ts`, `src/lib/env.test.ts` |

`github.ts` is `site.ts` with a token and two methods. If it starts looking like something
else, stop.

---

## Patterns for this feature

**The layer chain is `tools → services → lib`.** No `repository/`, no database. Only
`src/tools/` may import the MCP SDK.

**`listDirectory` returns `unknown`. The parse runs in the service.** Exactly as
`site.fetchContent` does, and for the same reason: it is what lets a test hand the service
a fake returning `[{nope:1}]` without a banned cast and still exercise the real schema. If
you parse inside `lib/`, T-14 asserts nothing.

**`readFile` returns `string` and gets no schema.** `response.text()` is already `string`.
There is nothing to validate. Do not add a schema to have one.

**Use `Accept: application/vnd.github.raw` for file reads.** This is why there is no base64
decode anywhere in this feature. **Verify it works in Task 2 before building on it** — if
GitHub does not honour it, say so and add the decode. Do not assume either way.

**Two error shapes, and only two.** `GithubNotFoundError` on 404, a plain `Error` carrying
the status on anything else. The service branches with `instanceof`, never by matching an
error message string.

**A 404 might mean the token is wrong.** GitHub returns 404 rather than 403 for a private
repo the token cannot see. Never write an error message that states "this skill does not
exist" as a certainty when a bad token produces the identical response. Say what is true:
the path could not be read.

**The voice, or nothing.** `skills/be-human.md` comes back with every named answer. If it
is missing, that is an error — never return a template or a rules file without it. A model
given structure and no voice writes something correctly shaped that sounds like nobody, and
unlike a missing file, nobody notices.

**Resolve names from the listing. Never guess a path.** `get_skill("writing")` lists
`skills/` and `templates/` and matches on the basename, so `.md` and `.mdx` both work and
an unknown name already holds the lists it needs for the error message. Building
`templates/${name}.mdx` by hand is how this starts 404-ing on a file that exists.

**`skills/` is checked before `templates/`.** Only matters if one name is in both, which is
not defended against. See `design.md` → Edge cases.

**Errors are returned, not thrown.** A tool that fails returns an error result with a
sentence the model can act on, and the HTTP response is still 200.

**The tool description is specified, not yours to invent.** `design.md` → Approach → The
tool description holds the exact text. Two rules behind it: never name a tool that is not
registered, and never blur `writing` and `post` — they are different things in
`CONTEXT.md`. Note that `linkedin-post` and `twitter-post` are both kinds of `post`, and
that `writing` and `project` name templates, not skills.

**Facts already established — do not re-derive them:**

- Owner handle: `Ashutosh6393`. Repo constants live in `lib/github.ts`, **not** in env.
- **The site repo is `Portfolio-new`, not `portfolio`.** Verified 2026-07-31. The account
  also holds `Portfolio` (a 2025 GSAP site) and `Portfolio2` — do not guess from the docs.
  Keep the domain word `portfolio` in the `Repo` type and in every message; only
  `repoNames` maps it to `"Portfolio-new"`.
- **`workshop` exists but is EMPTY** — no commits at all, verified 2026-07-31. The token
  reads it fine (metadata 200, `private: true`); there is simply nothing in it. P-1 is
  unmet and Task 3 is blocked on it. Once filled, per ADR-003, it holds
  `skills/{be-human,linkedin-post,twitter-post}.md` and
  `templates/{writing,project}.mdx`.
- **`Accept: application/vnd.github.raw` works** — verified live 2026-07-31, 200 with
  `content-type: application/vnd.github.raw` and the real bytes. No base64 decoder exists
  or is needed. Listings carry `name` and `type`, `type` being `"dir"` or `"file"`.
- The GitHub contents endpoint is `GET /repos/{owner}/{repo}/contents/{path}`. A directory
  returns an array of entries carrying `name` and `type` (`"file" | "dir"`).
- `zod` is v4 in this repo. `@modelcontextprotocol/server@2.0.0` wants `inputSchema` as a
  `z.object({...})`, not a raw shape record.
- The MCP SDK answers a stateless POST as `text/event-stream`, one `event: message` frame.
  `src/tools/index.test.ts` already has the helper that reads it.

---

## Don't

- Don't build anything not in `design.md`. New ideas go to **Deferred work** in
  `summary.md`.
- Don't skip tests, and don't write code before the failing test exists.
- Don't mark a task `done` yourself — the test agent confirms the pass.
- Don't continue past a `blocked` task.
- Don't batch documentation updates; they ship in the same commit as the change.
- **Don't `bun add octokit`.** ADR-002 argued it out. It stays listed and uninstalled, and
  gets re-decided at `publish`. Installing it here needs a new ADR.
- **Don't write to GitHub.** The token is read-only this slice. No branches, no commits, no
  PRs, no `PUT /contents`.
- **Don't touch `list_content`** — not its enum, not its `state` argument (it has none),
  not its description, not its response. The Slice 5 "call `get_skill` first" nudge is
  **not** part of this spec.
- **Don't put the owner or repo names in an environment variable.** ADR-002 decided they
  are constants. One user, two repos, they will not change.
- **Don't log the token, the `Authorization` header, or a full request URL.** And still
  don't log the request path — the path secret is in it.
- **Don't add a cache, a retry, or a rate limiter.** 15 calls a week against 5,000 an hour.
- **Don't build anything that watches the token's expiry.** ADR-002 gave that up knowingly
  and wrote down why. The health check is the whole answer.
- **Don't write a base64 decoder.** Task 2 proved the raw `Accept` header works.
- **Don't build a `skills/{name}/` directory read.** ADR-003 removed it. Flat files.
- **Don't make `be-human` optional, and don't fall back when it is missing.** A silent
  fall-back is the one failure here that ships bad output without anyone noticing.
