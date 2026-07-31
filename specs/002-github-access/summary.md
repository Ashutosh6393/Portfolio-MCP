# GitHub Access — Summary

Written for a **human**, at the point a PR slice is complete — before the PR is raised and
before any automated review has run. It must stand on its own.

Read this, then the diff, then approve the PR.

- **Slice:** 2 of 2 · **Branch:** `feat/github-access-skill`
- **Stacked on:** `feat/github-access` (Slice 1) — **merge that one first**
- **Spec:** `design.md` · **ADRs:** `docs/adr/002-github-access-and-workshop.md`,
  `docs/adr/003-skills-and-templates-are-separate.md`
- **Tasks:** 4–7 · **Tests:** 15 added (33 → 48), all passing
- **Size:** 5 files, 280 lines (limit: 5–7 files excl. tests, 500 lines)

---

## TL;DR

The server has a second tool. `get_skill` hands a model the drafting rules or the template
it asked for, and **always attaches the author's voice** — because voice is the thing a
model silently does without.

Ask it "what skills do I have" and it answers `be-human`, `linkedin-post`, `twitter-post`,
plus the `writing` and `project` templates. Ask for one and you get it, in one response,
out of a private repo.

---

## What changed

| File | Change | Why |
|---|---|---|
| `src/lib/github.ts` | modified | `entryListSchema` — the directory-listing shape, +14 lines |
| `src/services/get-skill.ts` | **new** | Resolve a name, bundle the voice, return never throw |
| `src/tools/get-skill.ts` | **new** | The tool and its specified description |
| `src/tools/index.ts` | modified | Registers the second tool |
| `fly.toml` | modified | VM 512mb → 256mb, and the comment that argued for 512 |

`fly.toml` belongs to neither slice — it rode with this one rather than inventing a third
PR for one line.

### How it works now

**With no name.** Both directories are listed in parallel and the names come back with
extensions stripped. Directories and non-markdown files are filtered by *type and
extension*, never by name — a blocklist breaks the day a second stray file appears.

**With a name.** Both listings come back first, the name is resolved against them, then
the voice and the target are read together. Two round trips, four calls.

**Nothing ever builds a path by appending an extension.** That is why the templates landing
as `.md` rather than the `.mdx` ADR-003 assumed changed no code at all. T-10c is the test
that keeps it that way.

---

## QA

**What does this let a user do that they couldn't before?**
Draft on a phone in the author's voice. There is no skill system on mobile, so without this
the model writes generic prose — the failure `mcp-design.md` predicted.

**What happens when it fails?**
Every failure is a *tool result*, never a thrown error, and the HTTP status stays 200. A
thrown error dead-ends the conversation; a returned sentence lands in context and the model
acts on it in the same turn. An unknown name comes back naming what does exist, so the
retry happens without another round trip. A missing `be-human.md` is a hard error — never
structure without voice.

**Does this touch existing behaviour?**
`list_content` is untouched: not its enum, not its description, not its response. Its tests
pass unchanged, and 002-T-15 asserts registering a second tool did not drop the first. The
health check is untouched.

**Any data migration?**
None. No database, and nothing is written to GitHub — the token is read-only.

**Any performance implications?**
Four API calls across two round trips per named call, against a 5,000/hour limit and
roughly 15 calls a week. `be-human.md` is re-read every time. No cache, no retry, no rate
limiter — three orders of magnitude of headroom is not a design input.

**Any security or auth implications?**
No new credential and no new route. `workshop` is private and its contents now flow through
the tool, so anyone holding the path secret can read the skills — already true of
everything else behind that path. Still read-only.

**What did we deliberately not do?**
No `octokit`. No writes. No changes to `list_content` — including **not** the "call
`get_skill` first" nudge, which is Slice 5 and has its own design.

---

## Verify it yourself

```bash
git checkout feat/github-access-skill
bun install
bun test
```

1. `bun test` → 48 pass, 0 fail
2. `bun run typecheck && bun run lint && bun run docs:check` → all clean
3. "what skills do I have" → `be-human`, `linkedin-post`, `twitter-post`, and the `writing`
   and `project` templates
4. "load the linkedin-post skill" → the real rules **and** the voice, in one response
5. Failure case: "load the lnkedin-post skill" (typo) → a sentence naming the real skills,
   and a correct retry in the same turn. Not a crash, and not an HTTP error

---

## Test coverage

| Test | Verifies | File |
|---|---|---|
| T-07 | Both lists come back, extensions stripped | `src/services/get-skill.test.ts` |
| T-08 | Directories and non-markdown files are skipped | `src/services/get-skill.test.ts` |
| T-09 | An empty workshop is a valid answer, not an error | `src/services/get-skill.test.ts` |
| T-10 | A named skill returns its rules and the voice, not swapped | `src/services/get-skill.test.ts` |
| T-10b | A named template returns the template and the voice | `src/services/get-skill.test.ts` |
| T-10c | `.md` and `.mdx` both resolve — the extension is never guessed | `src/services/get-skill.test.ts` |
| T-10d | Asking for the voice returns it once and reads it once | `src/services/get-skill.test.ts` |
| T-11 | An unknown name names what does exist | `src/services/get-skill.test.ts` |
| T-12 | A missing voice is an error, never structure alone | `src/services/get-skill.test.ts` |
| T-13, T-14 | GitHub down, and a listing in a bad shape — both error results | `src/services/get-skill.test.ts` |
| 002-T-15 | `get_skill` is advertised with an optional `name`; `list_content` still listed | `src/tools/index.test.ts` |
| 002-T-16 | Both modes answer through the real MCP handler | `src/tools/index.test.ts` |
| 002-T-17 | A tool failure is a tool result at HTTP 200 | `src/tools/index.test.ts` |

**Covered:** both modes, every error path, the empty case, the junk-file case, the
extension case, and the one edge case with a genuinely bad silent outcome — a missing
voice.

**Not covered:** the three-clients check (Task 7) is a human step. The protocol side was
driven against the **live** `workshop` repo through the real handler: listing, a skill, a
template, the voice alone, and an unknown name.

### Test revisions in this slice

**One. Input-only; no assertion changed.** `postJsonRpc` in `src/tools/index.test.ts` now
passes `github` alongside `site`, because Task 6 grew `createHandler`'s deps. One call
site, one field. Justified in `implementation.md` → Test revisions.

---

## Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| `be-human.md` renamed or deleted | low | **Every** named `get_skill` call fails, not just one. The error names the file, so the message points at the fix |
| A stray `.md` in `skills/` is offered as a skill | low | It would show up in the listing under its filename |
| A model ignores the tool and drafts in generic voice | medium | The description is the only nudge in this slice. The second one is Slice 5 |

**Rollback:** revert these commits. Slice 1 keeps working — nothing in it depends on this.

---

## Deferred work

| Item | Why deferred | Worth doing? |
|---|---|---|
| The "call `get_skill` first" nudge on `list_content` | Slice 5, with its own design. Explicitly out of scope here | yes — already planned |
| A name in both `skills/` and `templates/` | Not defended against; `skills/` wins. Recorded in `design.md` → Edge cases | no |
| Caching `be-human.md` across calls | Re-read on every named call. ~15 calls a week against 5,000/hour | no |
| Filtering a stray `README.md` out of `skills/` | A name blocklist is the fragile kind of guard. Private repo, five files, one author | no |

---

## Documentation updated

- [x] `specs/002-github-access/design.md` — two corrections found while building Task 5:
      the voice resolves from the listing rather than a hardcoded path, and asking for
      `be-human` returns it under `voice` alone rather than duplicated under a second key
- [x] `specs/002-github-access/implementation.md` — task states, the test revision, session
      notes, and the PR split
- [x] `fly.toml` — the comment that argued for the old VM size
