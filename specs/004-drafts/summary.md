# Drafts — Summary

Written for a **human**, at the point a PR slice is complete — before the PR is raised and
before any automated review has run. It must stand on its own.

Read this, then the diff, then approve the PR.

- **Slice:** 1 of 4 · **Branch:** `feat/drafts`
- **Spec:** `design.md` · **ADR:** `docs/adr/004-drafts-are-real-mdx-in-workshop.md`
- **Tasks:** 1–2 · **Tests:** 7 added (48 → 55), all passing
- **Size:** 2 source files, 208 insertions / 15 deletions (limit: 5–7 files excl. tests,
  500 lines)

---

## TL;DR

**Nothing changes for anyone using the server.** No new tool, no changed tool, no changed
response. Ask it for your skills or your writings today and you get exactly what you got
yesterday.

What lands is the two pieces the next slice needs. First, a **file format** for a draft —
turn a title and some text into an `.mdx` file, and read it back and get the same title and
the same text. Second, `lib/github.ts` can now **write and delete** files in the private
`workshop` repo, not only read them. Nothing calls either one yet.

The point of shipping it alone is that both carried real unknowns, and both are now closed
against the real GitHub API rather than against a guess.

---

## What changed

### Source — the two files a reviewer should actually read

| File | Change | Why |
|---|---|---|
| `src/lib/draft.ts` | **new**, 68 lines | The draft format. `renderDraft`, `readDraft`, `draftPath`, `isSlug` — four pure functions. The first `lib` module with no `fetch` in it, so it is testable directly with no fake and no network. |
| `src/lib/github.ts` | modified, +140/−15 | Gains `readFileWithSha`, `writeFile`, `deleteFile`, `fileContentSchema`, and two error classes (`GithubConflictError`, `GithubAlreadyExistsError`) so a caller can tell a stale-sha conflict from a name collision without matching message strings. The five methods now share one `request` helper instead of four copies of the URL and the status mapping. Its header comment claimed the token was read-only; that is no longer true and is corrected in the same commit (criterion 6). |

### Tests

| File | Change | Why |
|---|---|---|
| `src/lib/draft.test.ts` | **new**, 115 lines | T-01 … T-06b. Written red, before `draft.ts`. |
| `src/index.test.ts`, `src/services/get-skill.test.ts`, `src/tools/index.test.ts` | +55, −0 | **One approved test revision.** See *Test revisions* below — read that section before the diff. |

### Docs riding along in the same PR

This branch has never been PR'd, so the spec scaffolding lands with it. None of it is code.

| File | What |
|---|---|
| `specs/004-drafts/` — `design.md`, `CLAUDE.md`, `implementation.md`, this file | The spec, approved 2026-08-01, plus live state. `design.md` also records M-1's real status codes (criterion 5). |
| `docs/adr/004-…md`, `docs/adr/README.md` | ADR-004's body reconciled with the acceptance review; indexed as accepted. |
| `specs/002-github-access/implementation.md` | Spec 002 closed out. Housekeeping, not this feature. |
| `.gitignore` | +1 line: ignore `.claude/settings.local.json`, which was failing `bun run lint`. Unrelated to drafts; it rode along rather than becoming its own PR. |

### How it works now

**The format.** `renderDraft(metadata, body)` is `JSON.stringify(metadata, null, 2)` wrapped
in `export const metadata = …`, a blank line, then the body verbatim.

**The `2` is the format, not styling.** With an indent of two, the top-level `}` is the only
closing brace at column 0 — every nested object and array closes on an indented line. That
single fact is the whole parser: `readDraft` finds the first `{`, finds the first later line
that is *exactly* `}`, and `JSON.parse`s the span. No regex per field, no `eval`, no JS
parser, no new dependency. Drop the `2` and the block renders on one line with no `}` line
at all, and the reader fails on the serializer's own output — silently, and only for files
written after the change. `T-05` pins the exact rendered bytes so a formatter-minded
"tidy-up" fails a test instead of shipping.

One guard is written by hand: `JSON.stringify({}, null, 2)` is the two characters `{}`, with
no closing line. Empty metadata is reachable, so that one case renders as `{\n}`.

Failure is `null`, never a throw and never a message. There is nothing a phone user can do
with a character offset, so nothing is carried up. A later slice's service turns `null` into
one specified sentence.

**The writer.** `writeFile` and `deleteFile` are `PUT` and `DELETE` on the same contents
endpoint the reader already used. Content goes over as base64. `readFileWithSha` cannot use
the raw `Accept` header — that returns bytes but not the `sha` — so it takes the JSON
response and decodes with `Buffer`, never `atob`, because GitHub wraps base64 at 60
characters and `atob` throws on the embedded newlines.

Omitting `sha` means create; supplying it means update-if-unchanged. That is the entire
concurrency story, and it is GitHub's, not ours.

---

## QA

Questions a reviewer would actually ask, answered before they have to ask them.

**What does this let a user do that they couldn't before?**
Nothing. This is the honest answer and it is the first thing to be clear about. `tools/list`
returns the same two tools it returned before (`list_content`, `get_skill`), with the same
descriptions, and both behave identically. Nothing under `src/services/` or `src/tools/` is
touched. No route, no env var, no health check changed. The value of the slice is that the
next one is now ordinary code with no unknowns left in it.

**What happens when it fails?**
`readDraft` returns `null` for every malformation — no `{`, no closing line, or `JSON.parse`
throwing. It never throws and never returns half an answer with empty metadata, which is the
outcome that would be worst: plausible-looking wrong metadata.

On the GitHub side, three statuses are turned into three error classes and everything else
becomes a plain `Error` naming the status and the repo. **404 deliberately does not claim
the file is missing** — GitHub answers 404, not 403, for a write a token may not make, so
"missing file" and "mis-scoped token" arrive identically. The message says "Could not read or
write {path} in the {repo} repo." Stating either cause as fact would send the reader the
wrong way half the time.

Nothing here is retried. A stale `sha` is a refusal, and re-reading is the caller's decision.

**Does this touch existing behaviour?**
No, and it is provable from the diff rather than argued: the non-test source diff is exactly
two files, both in `lib/`, and grepping `src/` finds **no caller of `writeFile` or
`deleteFile` anywhere**. The only behavioural change to existing code is
`GithubNotFoundError`'s message text, reworded because it is now thrown on the write path
too. No test asserted the old string.

**Any data migration?**
None. There is no database. A draft is a file in a git repo, and no draft exists yet.

**Any performance implications?**
None. No new call is made by anything running today. When slice 2 lands, `readFileWithSha`
costs one API call and pays a base64 decode the raw reader avoided — against roughly 15 calls
a week and a 5,000/hour limit. No cache, no retry, no rate limiter, on purpose.

**Any security or auth implications?**
Yes, and it is the biggest thing in the slice: **the server can now delete files.** The
GitHub token was widened by hand to contents read **and write** on `workshop` only. That is a
Fly secret, set by a human, never in a file and never read by an agent.

Two things constrain the blast radius, and only one is enforced by code:

- `isSlug` rejects anything that is not kebab-case. It exists because a slug becomes a path
  in a repo the server can now delete from — `../../../etc/passwd` has to fail. Enforced.
- `portfolio` stays read-only, verified live in M-1 (it took no commits). But `writeFile`'s
  signature takes `repo: Repo`, so the **type** still permits aiming a write at it. Nothing
  calls it, so slice 1's criterion 7 holds today — but that is a comment in the header, not a
  guard. See Deferred work item 1. This is the thing to watch in slice 2.

No new route, no new credential, no change to who can reach the server.

**What did we deliberately not do?**
No service, no tool, no registration — those are slices 2–4. No validation of draft metadata
at any layer, ever, which is ADR-004's decision and not an oversight. No dependency: no JS
parser, no MDX package, no base64 library. No unit test of the writer against a mock of
GitHub — see *Not covered*.

---

## Verify it yourself

Steps to check this by hand, in under five minutes.

```bash
git checkout feat/drafts
bun install
bun test
```

1. `bun test` → **55 pass, 0 fail** (155 `expect()` calls, 7 files)
2. `bun run typecheck && bun run lint && bun run docs:check` → all three clean
3. `bash .claude/hooks/check-test-count.sh` → `Test count OK: 48 -> 55`. No test was removed
   or skipped.
4. See the format for yourself, including the nasty case — a body containing a line that is
   exactly `}`:

   ```bash
   bun -e '
   import { renderDraft, readDraft } from "./src/lib/draft.ts";
   const t = renderDraft({ title: "What CRDTs taught me", tags: ["a","b"] }, "Body line one.\n}\nafter");
   console.log(t);
   console.log(JSON.stringify(readDraft(t), null, 2));
   '
   ```

   Expect quoted keys indented two spaces, the array closing on an *indented* line, one `}`
   at column 0, a blank line, then the body — and the read-back giving the same metadata and
   the same three body lines.

5. **Failure case** — a block that will not parse must return `null`, not throw and not
   guess:

   ```bash
   bun -e '
   import { readDraft } from "./src/lib/draft.ts";
   console.log(readDraft("export const metadata = {\n  \"title\": \"x\",\n}\n\nbody"));
   '
   ```

   Expect `null` (the trailing comma). Not an exception, and not `{ metadata: {}, body }`.

6. Confirm the slice is invisible from outside: `git diff main...HEAD --stat -- src` shows
   only `draft.ts`, `github.ts` and test files. Nothing in `src/tools/` or `src/services/`.

---

## Test coverage

| Test | Verifies | File |
|---|---|---|
| T-01 | The round trip, with nested objects and arrays — nested closers never end the block | `src/lib/draft.test.ts` |
| T-02 | A key set to `undefined` is an absent key, not an empty string | `src/lib/draft.test.ts` |
| T-03 | Empty metadata round-trips as `{}`, not as a failure | `src/lib/draft.test.ts` |
| T-04 | A body containing a line that is exactly `}` comes back byte-identical | `src/lib/draft.test.ts` |
| T-05 | The rendered bytes are pinned exactly — quoted keys, two-space indent, closer at column 0, blank line, body | `src/lib/draft.test.ts` |
| T-06 | A block that will not parse returns `null` | `src/lib/draft.test.ts` |
| T-06b | A block that never closes at column 0 returns `null` without throwing | `src/lib/draft.test.ts` |
| M-1 | The whole write path against the **real** `workshop` repo | manual, 2026-08-02 |

**Covered:** every path through `draft.ts`, including the two failure modes and the three
cases where the format could plausibly break (nested closers, a `}` in the body, empty
metadata).

**Green was not taken on trust.** At sign-off the test agent mutated a scratchpad copy of
`draft.ts` one change at a time and confirmed a matching test failed each time. **All seven
mutants died** — dropping the `2` indent kills four tests, removing the `{}` guard kills
T-03, trimming the closer comparison kills T-06b, taking the *last* `}` instead of the first
kills T-04, adding a trailing newline kills four, and swallowing the parse failure into empty
metadata kills T-06. That is why "55 pass" means something here rather than only meaning the
file imports.

**Not covered, deliberately:** `lib/github.ts`'s new write methods have **no automated
test**. `testing.md` is explicit — it is a thin wrapper over someone else's API, and testing
it against a mock of that API tests the mock. Its status-code mapping is proven live in M-1
instead. If you disagree with that trade, `design.md` → Seams is where it is argued.

**M-1, run 2026-08-02 against the real `workshop` repo, all six answers:**

- **409** for a stale `sha` on `PUT` and **422** for a create over an existing path. Both
  were *assumptions* in the spec, flagged as Risk 1. Both were **correct** — nothing in the
  mapping had to change.
- The widened token permits the write. A create succeeded rather than returning the 404 that
  Risk 5 warns a still-read-only token gives.
- `readFileWithSha` decodes correctly, including a file long enough to trigger GitHub's
  base64 wrap at 60 characters — the exact case `atob` would have thrown on.
- `deleteFile` removes the file; a following read raises `GithubNotFoundError`.
- Commits are attributed to **Ashutosh6393**, not a bot, with no `author` field sent.
- **`portfolio` took no commits.**

### Test revisions in this slice

**One, and a reviewer should look at this hardest.** It was approved by the human before it
landed, and it is recorded in `implementation.md` → Test revisions.

**What:** widening the `Github` type with three write methods broke `tsc` in **seven fake
objects across three test files** (`src/index.test.ts`, `src/services/get-skill.test.ts`,
`src/tools/index.test.ts`). The test agent added `readFileWithSha`, `writeFile` and
`deleteFile` stubs to each so they satisfy the type again.

**Why it should not worry you, and how to check that yourself rather than believing it:**

- **Additions only — 55 lines added, 0 removed.** `git show 93fc8ce` is the whole of it. No
  assertion, no test name, no `describe`, no fixture value was touched.
- **The test count did not move**: 55 before, 55 after. `check-test-count.sh` enforces it.
- **It landed as its own commit, `93fc8ce`, *ahead* of the code commit `397be30`** — so it
  cannot have been a reaction to a failing implementation. That ordering is the point.
- **The stubs throw.** They do not return a plausible value. No test in those files should
  ever reach the write path, so an accidental call fails loudly instead of passing silently.

`implementation.md` pre-authorised the identical move at Task 12 for `registerListContent`;
it simply arrived at Task 2 instead, because Task 2 widens the same type.

---

## Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| The `2` in `JSON.stringify(metadata, null, 2)` gets "tidied" away | low | Every draft written after that change is unreadable, and it is silent. T-05 fails first, which is the guard. |
| The server can now delete files in `workshop` | **medium — new capability** | Nothing calls the deleter yet. From slice 2 on, the `sha` rules are the entire defence and there is no second layer (ADR-004). No undo, no trash, no history — git is the history. |
| `writeFile`'s type permits aiming at `portfolio` | low today, higher in slice 2 | Nothing calls it. The header comment says a write there is a bug, but a comment is not a guard. Deferred item 1. |
| `readDraft` looks like the right tool for a hand-written `portfolio` MDX file | low | It is not — those are JS object literals, and it returns `null` or plausible-looking wrong metadata. Stated in `draft.ts`'s header where the next person will read it. Nothing enforces it. |
| A 404 read as "no such draft" when the token scope is actually wrong | low | Already closed for this token by M-1. The error message deliberately refuses to claim either cause. |

**Rollback:** revert the commits. Nothing depends on either file — no caller exists — so a
revert is clean and leaves the server exactly as it runs today. The one thing a revert does
**not** undo is the widened GitHub token, which is a Fly secret set by hand. Narrow it by
hand if you want it narrow.

---

## Deferred work

Ideas surfaced during the build that were deliberately not done. This replaces a separate
future-work file — everything deferred lives here.

| Item | Why deferred | Worth doing? |
|---|---|---|
| **Narrow the writer's `repo` parameter.** `writeFile`/`deleteFile` take `repo: Repo`, so the type permits a write to `portfolio`. Criterion 7 holds today only because nothing calls them. | Out of scope for slice 1 — surfaced by the test agent at sign-off, and there is no caller yet to constrain. | **yes.** Minimum: the first service to call a writer passes `"workshop"` as a literal. Better: narrow the signature in slice 2 so the type does the work the comment currently does. |
| **M-1's successful-*update* step is proven by inference, not by an assertion.** The script printed no `OK updated` line; the 409 implies it, since a `sha` can only go stale if a write landed after it was read. | The inference is sound, and re-running M-1 costs real commits in a real repo. | **maybe** — add an explicit assertion if M-1 is ever re-run. |
| **Four scratch commits** (`m-1: create` / `long` / `dupe` / `delete`) now sit in `workshop`'s history from the M-1 run. | Harmless — git is the history, and this is a private repo with one author. | **no.** Recorded so nobody wonders later where they came from. |

Anything marked **yes** that is non-trivial needs its own ADR before it becomes a spec.

---

## Documentation updated

Docs are live — updated in the same commit as the change that made them stale.

- [x] `src/lib/github.ts` — the header comment no longer says the token is read-only, and
      now states the constraint that replaced it: read **and write** on `workshop`,
      read-only on `portfolio` (acceptance criterion 6)
- [x] `specs/004-drafts/design.md` — M-1's real status codes and its other four answers
      written in, in the same commit as the code (acceptance criterion 5)
- [x] `specs/004-drafts/implementation.md` — task states, the test revision, session notes,
      slice state
- [x] `docs/adr/004-drafts-are-real-mdx-in-workshop.md`, `docs/adr/README.md` — body
      reconciled with the acceptance review, indexed as accepted
- [x] `bun run docs:check` — clean, no generated-block drift
