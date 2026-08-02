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
| `src/lib/draft.test.ts` | **new**, 115 lines | T-01 … T-06b. Written red first, but it shares commit `fc39df2` with `draft.ts`, so **the ordering is not provable from the history** — unlike the Task 2 revision, which was deliberately split ahead of its code. What *is* provable is stronger: every assertion was mutation-checked at sign-off (see *Test revisions*). |
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
| **Move the slug guard into `draftPath`.** `draftPath` does not enforce `isSlug`, and `design.md` wires `isSlug` into `saveDraft` only — `get_content` (design.md:314) and `discard_draft` (design.md:323) are specified with no slug check and no test ID for one. The `..` segments are collapsed by the URL parser before the request leaves, so a crafted slug **crosses repos**: `"../../../../Portfolio-new/contents/src/content/writing/evil"` resolves to a `Portfolio-new` URL. Slice 3's `discardDraft` would make that a `DELETE`. Today the only thing in the way is the token's scope — and Risk 5 says a refused write returns **404**, which `discardDraft` renders as *"There is no draft at {kind}/{slug}."* The most alarming outcome reported as the most boring one. | Found by the reviewer at the slice-1 gate. Not a blocker for this merge: nothing calls the writers, so criterion 7 holds. | **yes, and before slice 3.** Make `draftPath` refuse a non-slug so every caller inherits the guard instead of remembering it — a smaller diff than three `isSlug` calls plus three tests, and it cannot be forgotten. Add slug-shape test IDs for `getContent` and `discardDraft` to `design.md`. |
| **Narrow the writer's `repo` parameter.** `writeFile`/`deleteFile` take `repo: Repo`, so the type permits a write to `portfolio`. Criterion 7 holds today only because nothing calls them. | Out of scope for slice 1 — surfaced by the test agent at sign-off, and there is no caller yet to constrain. | **yes.** Minimum: the first service to call a writer passes `"workshop"` as a literal. Better: narrow the signature in slice 2 so the type does the work the comment currently does. |
| **`readFileWithSha` lets a raw `ZodError` escape `lib`.** `github.ts:192` parses unwrapped. `design.md:449` says a service never rejects, and `get_content` is specified with exactly three outcomes; a `ZodError` is an unlisted fourth. | Only reachable on a malformed GitHub response or a directory path, so not worth code today. | **yes, in slice 2.** `getContent` needs a `catch` for it or it will reject. |
| **`writeFile` treats `sha: ""` as a create.** `github.ts:211` uses `options.sha ? …`, so an empty-string sha silently becomes a create and the resulting `GithubAlreadyExistsError` tells the model to read the file first when it already did. | Not reachable from any current caller. | **yes** — `options.sha !== undefined` is the same length and correct on the edge. |
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

---

## Slice 2 — save a draft, and read it back

- **Slice:** 2 of 4 · **Branch:** `feat/drafts`
- **Spec:** `design.md` · **ADR:** `docs/adr/004-drafts-are-real-mdx-in-workshop.md`
- **Tasks:** 3–6, all `done`. **Task 7 (M-2) is outstanding and only a human can run it** —
  the read-modify-write loop against a real client, at least once from the phone. This
  slice is not ready to merge until that step happens.
- **Tests:** 18 added (55 → 73), all passing
- **Size:** 5 source files, 274 insertions / 0 deletions (limit: 5–7 files excl. tests,
  500 lines)

---

### TL;DR

**The code is done. It has not been used yet.** Two new tools land — `save_draft` writes a
draft into `workshop/drafts/{kind}/{slug}.mdx`, and `get_content` reads one back with its
metadata, body and `sha`. Editing means calling `get_content`, changing what it returns,
and calling `save_draft` again with that `sha` — there is no separate update tool.

Every path through both services is exercised by a fake `github` and a fake `site`, and
the suite is 73/73. What is **not** yet true: nobody has driven this from Claude Code, from
claude.ai, or from a phone against the real `workshop` repo. That is Task 7 — M-2 — and it
is the one thing left before this slice can be called finished. Three of the design's nine
acceptance criteria (1, 3, 4) name a real client or the phone by their own wording, and
none of the three can be claimed from a test suite. They are open until a human runs M-2.

---

### What changed

#### Source

| File | Change | Why |
|---|---|---|
| `src/services/save-draft.ts` | **new**, 98 lines | `saveDraft` — checks the slug is a safe path segment, checks it is not already published, drops `show`/`order`/`readingTime`, renders the draft, and calls `writeFile`. Branches on `GithubConflictError` and `GithubAlreadyExistsError` by type, never by matching a message string. |
| `src/services/get-content.ts` | **new**, 52 lines | `getContent` — reads the file with its `sha`, runs it through `readDraft`, and returns `{ metadata, body, sha }` or a refusal. Never claims a 404 means the file doesn't exist, because a mis-scoped token answers 404 too. |
| `src/tools/save-draft.ts` | **new**, 61 lines | The tool wrapper: the description specified verbatim in `design.md`, the `z.object` schema, and turning `{ ok:false }` into `isError: true`. |
| `src/tools/get-content.ts` | **new**, 59 lines | Same shape, for reading. Formats the success text as `sha`, a blank line, the metadata, a blank line, the body — the `sha` first and unmissable, because it's the one thing the next `save_draft` needs. |
| `src/tools/index.ts` | modified, +4 | Registers both new tools alongside the two that already existed. `list_content` and `get_skill` are untouched. |

#### Tests

| File | Change | Why |
|---|---|---|
| `src/services/save-draft.test.ts` | **new**, 351 lines | T-07…T-15, T-32 — the create path, the update path, both conflict refusals, the published-slug and unreachable-site refusals, and the reserved-key drop. |
| `src/services/get-content.test.ts` | **new**, 171 lines | T-19…T-21 — the round trip, the missing-draft refusal, the unparseable-block refusal. |
| `src/tools/index.test.ts` | +228, −0 | T-25…T-28, exercised through the MCP handler, not by calling the tool functions directly. Also adds a `beforeEach` that resets a shared fixture — see *Test revisions* below. |

#### Docs

| File | Change | Why |
|---|---|---|
| `specs/004-drafts/implementation.md` | +111/−8 | Task states, session notes for Tasks 3–6, and the current status. |

Nothing else moved. `design.md` and the ADR are untouched this slice, on purpose: unlike
slice 1, nothing here was verified live yet, so there is nothing confirmed to write back
into the spec. That happens when Task 7 runs.

### How it works now

`save_draft` and `get_content` are thin: both go straight to their service and turn the
result into MCP content. All the real logic is in the two service files.

**Saving.** `saveDraft` checks the slug's shape before it checks anything else — a bad
slug never even reaches `listContent`, so the refusal for `"../../etc/passwd"` never
mentions the site. It then lists the published items of that `kind` and refuses if the
slug is already live. Reserved keys (`show`, `order`, `readingTime`) are silently dropped,
never rejected — nothing in this slice validates metadata, by design. The draft is
rendered with `renderDraft` from slice 1 and written with `writeFile`, also from slice 1.
Create and update are the same call: omitting `sha` creates, supplying it means
update-if-unchanged, and that distinction is entirely GitHub's, not this code's. A stale
`sha` or a create over an existing path comes back as a `GithubConflictError` or a
`GithubAlreadyExistsError`, and the service branches on the error's type to produce one of
two specific sentences, each naming `get_content` as the next step.

**Reading.** `getContent` calls `readFileWithSha`, feeds the content to `readDraft`, and
returns the parsed metadata, the body, and the `sha` — or a refusal if the file can't be
found or the metadata block won't parse. The `sha` is never a guess: it comes straight off
the GitHub response and is handed back unchanged, because it's what the next `save_draft`
needs to prove nothing else has written to that path in between.

---

### QA

**What does this let a user do that they couldn't before?**
On paper, save an idea as a real file and read it back to edit it. In practice: not yet,
because nobody has done it against the real repo. The tools are registered and answer
correctly against every fake case tried, but `tools/list` returning `save_draft` and
`get_content` is not the same claim as a human having used them.

**What happens when it fails?**
Every failure is a returned result, never a thrown error, all the way out to the tool
response — `isError: true` with a sentence naming what to do next, and the HTTP response
stays 200. That's asserted directly for `save_draft` (T-27). For `get_content` it isn't
asserted at the MCP layer — there is no test ID for it in this slice — but it's true for a
structural reason rather than a service-specific one: the MCP SDK catches whatever a tool
callback throws and folds it into a normal `tools/call` result before it becomes an HTTP
error. That was already true for `get_skill` in spec 001, and Task 6's session notes
record confirming it again by mutation: turning a `save_draft` refusal into a `throw`
passes every test, because there's nothing observable to fail.

**Does this touch existing behaviour?**
No. `list_content` and `get_skill` are not in the diff. `src/tools/index.ts` only gains
two `register…` calls; nothing already registered is edited.

**Any data migration?**
None. A draft is a file; none exists yet for a real user.

**Any performance implications?**
One extra API call per save (list the published items, to check for shadowing) and one
per read. Both are within the same low-volume budget slice 1 already argued — no cache,
no retry, no rate limiter.

**Any security or auth implications?**
Nothing new widens here — the token was already widened to read/write `workshop` in
slice 1. What's worth restating: `writeFile`/`deleteFile` still take `repo: Repo`, so the
**type** still permits a write to `portfolio`. `saveDraft` passes the `"workshop"` literal,
so no caller in this slice can reach it — but that is a comment and a convention, not a
guard, exactly as slice 1's summary flagged. Nothing in this slice closes that gap.

**What did we deliberately not do?**
No metadata validation at save — a draft with only a title is accepted, on purpose
(ADR-004). No update tool — editing is `get_content` then `save_draft` with the `sha`. No
retry on a stale `sha` — it's a refusal, and re-reading is the model's decision. Task 7
(M-2), because it needs a human and a phone.

---

### Verify it yourself

```bash
git checkout feat/drafts
bun install
bun test
```

1. `bun test` → **73 pass, 0 fail** (243 `expect()` calls, 9 files).
2. `bun run typecheck && bun run lint` → both clean.
3. `bash .claude/hooks/check-test-count.sh` → `Test count OK: 55 -> 73`. No test removed or
   skipped.
4. **Failure case** — a slug that isn't kebab-case refuses before either fake is called, so
   this needs no network and no token:

   ```bash
   bun -e '
   import { saveDraft } from "./src/services/save-draft.ts";
   const throwsIfCalled = async () => { throw new Error("should not be called"); };
   const github = { writeFile: throwsIfCalled, readFile: throwsIfCalled, readFileWithSha: throwsIfCalled, deleteFile: throwsIfCalled, listDirectory: throwsIfCalled };
   const site = { fetchContent: throwsIfCalled };
   console.log(await saveDraft({ site, github }, { kind: "writing", slug: "../../etc/passwd", metadata: {}, body: "x" }));
   '
   ```

   Expect `{ ok: false, error: "\"../../etc/passwd\" is not a valid slug. ..." }`. Neither
   fake throws — proof that the slug check runs before the site or GitHub is ever touched.
5. What this **cannot** verify by itself: that a real save reaches `workshop`, that a real
   `sha` round-trips, or that any of this works from the phone. That's Task 7.

---

### Test coverage

| Test | Verifies | File |
|---|---|---|
| T-07 | A new writing draft, metadata with only a title, is written to `drafts/writing/{slug}.mdx` with no `sha` | `src/services/save-draft.test.ts` |
| T-08 | Same, for a project draft, written to `drafts/project/{slug}.mdx` | `src/services/save-draft.test.ts` |
| T-09 | A supplied `sha` reaches `writeFile` unchanged | `src/services/save-draft.test.ts` |
| T-10 | A stale `sha` refuses instead of overwriting, and names `get_content` | `src/services/save-draft.test.ts` |
| T-11 | A create over an existing path refuses instead of silently overwriting | `src/services/save-draft.test.ts` |
| T-12 | A slug already published refuses, and `writeFile` is never called | `src/services/save-draft.test.ts` |
| T-13 | An unreachable site refuses — it can't prove the slug is free, so it doesn't guess — and `writeFile` is never called | `src/services/save-draft.test.ts` |
| T-14 | `show`, `order` and `readingTime` are dropped silently; the title survives | `src/services/save-draft.test.ts` |
| T-15 | Any other GitHub failure returns an error result, nothing thrown | `src/services/save-draft.test.ts` |
| T-32 | A slug that isn't kebab-case refuses before the site is ever named | `src/services/save-draft.test.ts` |
| T-19 | A saved draft reads back with its metadata, its body, and its `sha` | `src/services/get-content.test.ts` |
| T-20 | A missing draft refuses, naming kind and slug, without claiming which cause it is | `src/services/get-content.test.ts` |
| T-21 | A block that won't parse refuses without leaking the `JSON.parse` error | `src/services/get-content.test.ts` |
| T-25 | `tools/list` advertises `save_draft` and `get_content`; `list_content` and `get_skill` still listed | `src/tools/index.test.ts` |
| T-26 | `save_draft` through the MCP handler answers with the path it wrote | `src/tools/index.test.ts` |
| T-27 | A `save_draft` refusal is `isError: true` — and HTTP status is still 200 | `src/tools/index.test.ts` |
| T-28 | `get_content` through the MCP handler hands back the `sha` the next save needs | `src/tools/index.test.ts` |
| M-2 | The read-modify-write loop against a real client, including from the phone | **pending — Task 7, human step, not run** |

**Green was not taken on trust.** Every task was mutation-checked at sign-off:

- **Task 3:** five mutants applied, all five died — dropping the slug guard, moving it
  below the published-slug check, dropping the reserved-key filter, dropping the
  published-slug check, and forcing a `sha` onto a create all fail a test.
- **Task 4:** five mutants, four died — swapping the two `instanceof` branches, removing
  the `try/catch`, retrying before refusing, and dropping `get_content` from the conflict
  sentence each fail a test. **The fifth survived**: replacing `instanceof` with a
  message-string match on the caught error still passes the whole suite. The code
  correctly uses `instanceof` — `errors-and-validation.md` requires it — but no assertion
  would catch a future regression to string matching. See *Deferred work*.
- **Task 5:** five mutants, four died at once. **The fifth exposed a real gap and was
  fixed before sign-off, not deferred**: with the `GithubNotFoundError` branch removed, a
  404 fell through to the generic message, and T-20 still passed because the generic
  message happens to embed the same path. T-20 was strengthened with
  `not.toContain("unreachable")` and `not.toContain(".mdx")` before commit, and the mutant
  then died. This is a pre-commit strengthening, not a Test revision — nothing was
  weakened, and it landed with the rest of Task 5's first attempt.
- **Task 6:** six mutants, five died — unregistering either tool, dropping the `sha` line,
  and widening `kind` from the enum to `z.string()` each fail a test. **The sixth is the
  SDK fact above**: a thrown refusal instead of a returned one passes everything, because
  the SDK already turns it into the same result. Recorded, not treated as a gap in this
  code — it's one layer below what this code controls.

**T-09 deserves a note.** It passed the moment it was written, because Task 3 already
threads `args.sha` straight into `writeFile` — create and update were always one code
path. A test that's green on arrival is normally suspicious; this one was checked by
mutation (`sha: args.sha` → `sha: undefined`) and does fail, so it's a real regression
guard rather than an assertion that never had a chance to fail.

**Not covered, deliberately:** both tool descriptions were checked character-for-character
against `design.md` lines 361–403 by eye at Task 6 sign-off. Nothing asserts that text, so
it is a review-only guarantee — if a future edit rewords either description, no test will
catch the drift. Re-check it by hand if either file changes.

### Test revisions in this slice

**None.** No assertion, test name, `describe`, or fixture *value* was weakened, and the
test count moved only by addition (55 → 73, `check-test-count.sh` enforces it).

One thing is worth reading closely even though it isn't a revision: **Task 6 hit a real
block.** T-28 failed on the first run, and the cause wasn't `save-draft.ts` or
`get-content.ts` — it was `draftFiles`, a `Record` at module scope in
`src/tools/index.test.ts` shared by every test in that block. T-26 writes to
`drafts/writing/a-post.mdx`; T-28 reads the same path; Bun runs a file's tests in
declaration order, so T-26 always ran first and overwrote the seed content and `sha` T-28
expected. `bun test -t "T-28"` alone passed, which is what pointed at shared state rather
than a source bug.

**The coder escalated instead of touching the test — the workflow working as intended.**
The fix landed in the fixture, not the assertion: a `beforeEach` restores `draftFiles`
from a frozen seed via `structuredClone` before every test. That closes the whole bug
class — any later test reading that path is now safe by construction, not by which order
Bun happens to run tests in. T-28's assertions, including the pinned `sha`, are unchanged.
No Test revisions entry, because nothing that makes a test pass or fail was touched — only
the state it starts from.

---

### Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| **Task 7 (M-2) hasn't run.** Nobody has saved a draft, edited it, or read it back against the real `workshop` repo, and nobody has done it from the phone. | **this is the open item** | Do not treat this slice as finished until Task 7 runs and its answers land in `implementation.md`. |
| Acceptance criteria 1, 3 and 4 name a real client and the phone by their own wording | same as above | They cannot be closed by a test suite. They stay open until M-2. |
| The `instanceof` conflict-branch mutant survives | low | No test distinguishes typed branching from a string match on the caught error. The code is correct today; a future edit that switches to message-matching would pass every test and violate `errors-and-validation.md` silently. |
| `bun run lint` is not part of the per-task loop | medium — a process gap, not a code bug | It failed silently after Task 4 (an import-order and formatting issue in the new test file) and was only caught by chance at Task 5. Nothing enforces lint per task today. |
| `writeFile`/`deleteFile` still type-permit a write to `portfolio` | low today | Unchanged from slice 1. `saveDraft` passes `"workshop"` as a literal, so nothing in this slice can reach it — but the type still allows it, and that's a comment, not a guard. |
| `get_content`'s HTTP-200-on-failure isn't independently asserted at the MCP layer | low | True by the same SDK mechanism T-27 proves for `save_draft` (see QA), but there is no `get_content`-specific test ID for it in this slice. |

**Rollback:** revert the commits. `list_content` and `get_skill` are untouched, and
nothing outside `src/tools/index.ts`'s two new registration lines depends on this slice.

---

### Deferred work

| Item | Why deferred | Worth doing? |
|---|---|---|
| **No test distinguishes `instanceof` branching from a message-string match** in `describeWriteFailure` (`src/services/save-draft.ts`). Surfaced by mutation testing at Task 4 sign-off. | The code is correct as written, and adding a test for "the error was matched by type, not by string" is awkward to express without reaching into the error class itself. | **maybe** — worth a test if this branch is ever touched again; not worth blocking this slice for. |
| **`bun run lint` isn't run per task**, only at whatever point someone happens to run it. It silently failed for one commit between Task 4 and Task 5. | Not part of this slice's scope — a workflow gap, not a code defect. | **yes**, but as a change to the loop in `SPEC-WORKFLOW.md`/`testing.md`, not to this diff. |
| **`writeFile`/`deleteFile` still take `repo: Repo`.** Carried forward from slice 1's Deferred work — unchanged by this slice. | Nothing in slice 2 calls a writer with anything but `"workshop"`, so there's still no live caller to force the narrowing. | **yes**, unchanged recommendation: narrow the signature so the type does the work the literal currently does by convention. |

---

### Documentation updated

- [x] `specs/004-drafts/implementation.md` — task states, session notes for Tasks 3–6,
      current status
- [ ] `specs/004-drafts/design.md` — **not updated this slice.** Nothing was verified live
      yet, so there is nothing confirmed to record. Updates when Task 7 (M-2) runs.
- [x] `bun run docs:check` — clean, no generated-block drift
