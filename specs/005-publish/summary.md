# Publish — Summary

Written for a **human**, at the point a PR slice is complete — before the PR is raised and
before any automated review has run. It must stand on its own.

Read this, then the diff, then approve the PR.

- **Slices:** 1 and 2 of 4, combined · **Branch:** `feat/publish`
- **Spec:** `specs/005-publish/design.md` · **ADR:** `docs/adr/005-publish-opens-a-pull-request.md`
- **Tasks:** 1–9 · **Tests:** 90 → 124, 0 fail (verified by running the suite before and
  after — see Verify it yourself)
- **Size:** slice 1 — 4 files, 316/2 lines. Slice 2 — 4 files, 150/25 lines. Combined,
  excluding tests: 7 files, 466/27 lines (`src/lib/site.ts` is touched by both slices,
  hence 7 not 8). Within the 5–7 file / 500 line PR limit for each slice individually.

This summary was rewritten because the version written after slice 1 alone had gone stale
in three places once slice 2 and the review landed on top of it: it still said "1 of 4",
still said "109 pass" (it's 124), and still said "no tool was touched" and "nothing
user-facing changed" — both false as of slice 2. See **The review and the fixes** below
for the one change in this pair of slices that actually matters.

---

## TL;DR

`publish` — the sixth and last tool — still does not exist. These two slices build what
it needs and, on the way, change something a user can feel today: **`get_content` can now
read a post that is already live on the site**, not just an unpublished draft. Ask for a
published writing or project by slug and you get its metadata and body back — useful on
its own, for revising something already on `ashutoshverma.dev` from a phone before
`publish` exists to save the edit anywhere.

That came at a cost: `get_content` now **requires** a new argument, `state`. Every caller
that used to omit it is rejected. See Breaking change.

Underneath that, slice 1 built a schema checker that reads the site's live publishing
rules and reports every problem with a draft's metadata at once, and a reading-time
estimate computed from a post's body — both still unused by any tool, waiting for
`publish` in slice 3. `/{secret}/health` gained a third check so the server notices, on
its own, if the site's schema ever becomes unreachable or changes shape.

A review between the two slices found that the schema checker was wrong in a way that
would have made `publish` refuse every real post, permanently, once slice 3 shipped on
top of it. That's fixed. See below.

---

## What changed

| File | Slice | Change | Why |
|---|---|---|---|
| `src/lib/reading-time.ts` | 1 | new | Turns a draft's body into the `"{n} min"` string the site's schema requires. Floors at `"1 min"` — the schema demands a non-empty string, so `"0 min"` would validate cleanly and still be nonsense. |
| `src/lib/validate.ts` | 1 | new | Interprets the site's JSON Schema documents by hand (ADR-005 rejected a library — few keywords in use, no `$ref`, no composition). Checks `type`, `properties`, `required`, `additionalProperties`, `minLength`, `enum`, `pattern`, `format`, `minItems`, `items`, `$schema`. Returns every error found, not just the first. Corrected after review — see below. |
| `src/lib/site.ts` | 1 & 2 | modified — `fetchSchema` (slice 1), `fetchDocument` + `SiteNotFoundError` (slice 2), `SiteShapeError` (review fix) | Slice 1: fetches `api/schema.json`, the two-key envelope (`{ writing, project }`), parsed with Zod but deliberately not describing what's inside each key — that would be a second, driftable definition of the rules `lib/validate.ts` already interprets. Slice 2: fetches one published document by kind and slug. Review: a malformed response from that route no longer throws a raw Zod error or gets mislabelled "unreachable". |
| `src/index.ts` | 1 | modified — `schema` health check | `/{secret}/health` now runs three checks in parallel: `site`, `github`, `schema`, as its own entry because it can fail for a different reason than the site being down. |
| `src/services/get-content.ts` | 2 | modified — `state` required, published branch | `state: "draft"` keeps the existing GitHub read unchanged. `state: "published"` reads through `site.fetchDocument` instead — never GitHub, since a `portfolio` file is a hand-written JS object literal and reading it as a draft would return `null` or a plausible-looking wrong value. |
| `src/tools/get-content.ts` | 2 | modified — `state` in the input schema, description rewritten | The tool now requires `state` the same way `list_content` has since spec 004 — no default, because a default on one but not the other costs a turn every time a model has to guess which behaviour it's getting. |
| `src/tools/save-draft.ts` | 2 | modified — description text only | Adds the instruction to ask the human for a slug rather than deriving one from the title. No behaviour changed. |

### How it works now

A request to `get_content` with `state: "draft"` works exactly as before: read from
`workshop`, return `{ metadata, body, sha }`. A request with `state: "published"` is new:
it calls `site.fetchDocument(kind, slug)` against `ashutoshverma.dev`'s API and returns
`{ metadata, body }` — no `sha`, because there's no draft to overwrite. To edit something
read this way, the model calls `save_draft` with no `sha` at all, which creates a new
draft; if one already exists at that slug, that create is refused and the model is told
to read the draft instead. That's existing `save_draft` behaviour, unchanged here.

`/{secret}/health` still runs `site`, `github`, and `schema` in parallel; any one failing
is a 503.

`lib/validate.ts` and `lib/reading-time.ts` are still not called by any tool — they exist
for `publish` in slice 3.

---

## The review and the fixes

**This is the part of the diff that matters most. Read it before the rest.**

The `reviewer` agent found a **blocking correctness bug** in slice 1's schema checker,
and I confirmed it independently by fetching the live schema myself
(`https://ashutoshverma.dev/api/schema.json`):

- `design.md` and `specs/005-publish/CLAUDE.md` both claimed the write schema uses
  "exactly ten keywords" with "no nesting past one array of strings". **Both were false.**
  The real schema carries `"$schema"` as an eleventh top-level key on both documents
  (Zod's `toJSONSchema` always emits it), and `stack.items` is
  `{ "type": "string", "minLength": 1 }` — `items` carries a constraint, not just a type.
- Because the interpreter correctly refuses any keyword it does not implement, it
  returned an error for **every valid post**, including the live ones. Had `publish`
  (slice 3) shipped on top of this, every publish attempt would have failed, permanently,
  with a message that blamed the site's schema for a bug in this repo's reading of it.
- The reviewer also found the test suite was **structurally incapable of catching this**:
  T-01 and T-12 — the only `toEqual([])` happy-path assertions — ran against a
  four-keyword hand-written fixture, never the real document. T-05 through T-10 all used
  `errors.some(...)`, so a validator returning a spurious error on every field still
  passed all six. The `format: "date"` no-op had no test at all.

**Fixes applied to `src/lib/validate.ts` and `src/lib/site.ts`, all re-verified:**

- `$schema` is now recognised as an annotation that constrains nothing — the code
  comment distinguishes "known and ignored annotation" from "skipped constraint" so the
  next reader doesn't mistake it for a hole.
- The scalar constraints (`minLength`, `enum`, `pattern`, `format`) are now checked
  *inside* `items`. `items.items` and `items.minItems` are still refused — that's what
  "no nesting past one array of strings" actually means.
- The unknown-keyword walk now runs unconditionally, not only when the field has a
  value. Previously an unimplemented keyword on an optional field nobody filled in
  passed silently.
- A property whose `type` is missing or not a string is now an error, not a silent skip
  of every constraint on that field.
- `SiteShapeError` (new, `src/lib/site.ts`) means a raw Zod issue dump can never reach
  the model, and a shape change on the site no longer reports as "unreachable" — the
  site answered; the thing to check is the API route, and the error now says so.

**Fixtures and tests corrected:**

- The hand-written schema fixtures in `src/lib/validate.test.ts` were replaced with the
  real, captured `api/schema.json`. Happy-path `toEqual([])` assertions were added for
  both live documents — these are the tests that would have caught the bug on day one.
- T-05 through T-10 were tightened from "contains this error somewhere" to "returns
  exactly this error set."
- Three tests were added by the review and marked as such in-file: `T-52` pins the
  `format: "date"` no-op so deleting that line would now be caught; `T-53` proves an
  unimplemented `items` keyword is refused even when the array field is absent; `T-54`
  proves a missing/non-string `type` is refused rather than silently skipped.
- **I found a fourth review-added test while verifying this summary, `T-55` in
  `src/services/get-content.test.ts`, that pins the `SiteShapeError` fix (no raw Zod
  dump, no false "unreachable" claim). It carries the same "added by review" comment as
  T-52–54 but is not listed in `implementation.md`'s Test revisions table.** Not a
  correctness problem — the test exists and passes — but it's a gap in the paper trail
  worth closing before this ships.
- `design.md`, `specs/005-publish/CLAUDE.md`, `specs/004-drafts/design.md`, and
  `README.md` were corrected to match the re-checked live facts. `design.md` gained a
  **Tool descriptions** section that didn't exist before — `CLAUDE.md`'s instruction to
  "check it by eye against `design.md`" had nothing to check against until now.

I re-ran the fixed validator against the real live schema by hand: valid writing
metadata → `[]`; valid project metadata → `[]`; `stack: [""]` → one precise error; a
malformed date → one precise error.

**One more thing worth flagging plainly: these fixes are not committed yet.** They exist
as uncommitted changes in the working tree — `git status` shows `src/lib/validate.ts`,
`src/lib/site.ts`, `src/services/get-content.ts`, their test files, and the four docs
files above, all modified but unstaged. Everything in this summary was checked against
that working tree, and the numbers below (124 tests, clean typecheck/lint/docs) include
it. But it needs its own commit — separate from the two slice commits it corrects —
before this can be raised as a PR, per this project's own rule that a fix like this
deserves review on its own, not buried in an unrelated diff.

---

## QA

Questions a reviewer would actually ask, answered before they have to ask them.

**What does this let a user do that they couldn't before?**
Read a published post back through `get_content` — metadata and body for anything
already live on the site, by kind and slug. That's the first user-visible change in this
feature. Everything else (the schema checker, `readingTime`, the health check) is still
inert, waiting for `publish` in slice 3.

**What happens when it fails?**
`fetchSchema` throws on a non-2xx response or a body missing `writing`/`project`; the
health route catches that and reports `checks.schema: "unreachable"`, 503 overall — same
pattern as the existing `site`/`github` checks. `fetchDocument` now distinguishes three
cases: a 404 becomes `SiteNotFoundError` ("no published {kind} at this slug"), a
malformed response becomes `SiteShapeError` (names the route, doesn't claim the site is
down), and a network failure is the generic "ashutoshverma.dev is unreachable" message.
`validate()` never throws — an unrecognised keyword becomes a string in the returned
array. `readingTime()` cannot fail; it's arithmetic with one floor.

**Does this touch existing behaviour?**
Yes, in one place that matters: `get_content` now requires `state`. See Breaking change.
Everything else is additive — `save_draft`'s behaviour is unchanged (description text
only), drafts read through `get_content` exactly as before, and `/health` adds a check
without changing the other two.

**Any data migration?**
None. No database in this repo.

**Any performance implications?**
One new outbound fetch per `/health` call, run in parallel with the two that already
exist. `get_content` with `state: "published"` adds one fetch to `ashutoshverma.dev`
per call, in place of the GitHub call a draft read makes — not in addition to it. No
cache or rate limiter was added, matching the project's stated position that ~15
calls/week doesn't warrant one.

**Any security or auth implications?**
None. No new route, no new auth path. Both changed tools stay behind the existing MCP
auth and the health route stays behind its existing secret path prefix.

**What did we deliberately not do?**
`publish` doesn't exist yet. No dependency was added — the schema interpreter is still
hand-written per ADR-005. `readDraft` is never pointed at a published file — published
reads go through the site's API, not GitHub, on purpose (see `CLAUDE.md` → Don't).

---

## Breaking change

**`get_content` now requires `state`.** Any existing caller — a saved prompt, a Claude
Project instruction, a script — that calls it with only `kind` and `slug` is rejected by
the input schema (Zod), before the service runs. This is deliberate, not an oversight:
it mirrors `list_content`, which has required `state` since spec 004, and the two tools
are meant to be learned together. T-27 pins that omitting `state` is rejected.

There's no migration path other than updating the caller to pass `state: "draft"` (the
old, only behaviour) or `state: "published"` (the new one). If something outside this
repo calls `get_content` today, it will start failing the moment this ships.

---

## Verify it yourself

Steps to check this by hand, in under five minutes.

```bash
git checkout feat/publish
bun install
bun test
```

1. Full suite → expect `124 pass, 0 fail`. I confirmed the baseline is `90 pass` by
   checking out the commit immediately before slice 1 (`98eb726^`) into a separate
   worktree and running the suite there — the 34-test increase is real, not a guess.
2. Open `src/lib/validate.test.ts`, find the test with `T-01` and `T-12` in its name that
   asserts against the real captured schema (not `structureOnly*`) → confirm it uses
   `toEqual([])` against the live document, not the old hand-written fixture. This is the
   test that would have caught the review's bug on day one.
3. Open `src/tools/get-content.ts` and call `get_content` with `{ kind: "writing",
   slug: "anything" }` and no `state` → confirm the MCP layer rejects it before the
   service runs (T-27). This is the breaking change, in one call.
4. Failure case: run `bunx tsc --noEmit` → expect clean, no output. This is what proves
   the `Site` type widening across two slices didn't leave a fake somewhere
   half-updated.

I ran all four while preparing this summary, against the working tree including the
uncommitted review fixes: `124/124` pass (baseline `90` confirmed in a clean worktree at
`98eb726^`), `tsc --noEmit` clean, `biome check .` clean, `bun run docs:check` reports
docs in sync.

---

## Test coverage

| Test | Verifies | File |
|---|---|---|
| T-01 … T-04, T-11, T-12 | Structure keywords, unknown-keyword refusal, optional-field-absent | `src/lib/validate.test.ts` |
| T-05 … T-10 | Constraint keywords — now asserted as exact error sets, not "contains" | `src/lib/validate.test.ts` |
| T-13 … T-15 | `readingTime` arithmetic and the `"1 min"` floor | `src/lib/reading-time.test.ts` |
| T-16, T-17 | The schema envelope parses; a malformed response names the missing keys | `src/lib/site.test.ts` |
| T-18, T-19 | `/health` reports `schema: ok`; 503s with `checks.schema: "unreachable"` on failure | `src/index.test.ts` |
| T-20, T-21 | A published read returns metadata + body, no `sha`; a draft read is unchanged | `src/services/get-content.test.ts` |
| T-22 … T-25 | Slug guard applies to published reads; unknown slug and unreachable site refuse distinctly; GitHub is never called for a published read | `src/services/get-content.test.ts` |
| T-26, T-27 | Through the MCP handler; `state` is required and rejected when absent | `src/tools/index.test.ts` |
| T-52 (review) | `format: "date"` no-op stays pinned | `src/lib/validate.test.ts` |
| T-53 (review) | An unimplemented `items` keyword is refused even with the field absent | `src/lib/validate.test.ts` |
| T-54 (review) | A missing/non-string `type` is refused, not skipped | `src/lib/validate.test.ts` |
| T-55 (review, undocumented in `implementation.md`) | `SiteShapeError` — no raw Zod dump, no false "unreachable" | `src/services/get-content.test.ts` |

**Covered:** every schema keyword the live site actually uses (now including `$schema`
and the scalar constraints inside `items`), both live documents end-to-end with
`toEqual([])`, both branches of the new health check, both `state` branches of
`get_content`, and the three distinct published-read failure shapes (not found, wrong
shape, unreachable).

**Not covered:** the health route and `get_content`'s `state: "published"` path are both
tested against a **fake** `Site`, not the live deployment. The schema interpreter itself
was checked by hand against the real `api/schema.json` (see The review and the fixes),
but nobody in this session hit the deployed MCP server. That's a `curl` against the real
deployment, not a code change, before this ships.

### Test revisions across both slices

Seven revisions, all already recorded in `implementation.md` → Test revisions, falling
into five categories. Flagging them here rather than burying them — anything other than
"none" deserves a closer look, and there's more than usual in this pair of slices.

1. **Throwing stubs added to `Site` fakes, twice.** Once when `fetchSchema` was added to
   the `Site` type (11 fakes), again when `fetchDocument` was added (12 fakes). Every
   stub throws rather than returning a plausible value, so a test that accidentally
   reaches the publish-document path fails loudly instead of passing quietly. Additive
   only — no assertion, name, or fixture value touched.
2. **A fixture's stated justification expired.** The shared `fakeSite` in
   `src/index.test.ts` had a throwing `fetchSchema`, justified as "nothing in this file
   reaches the publish path." Task 5 made `/health` call `fetchSchema()` on every
   request, which broke that reasoning and started 503-ing three unrelated tests. Fixed
   by making the shared default resolve a healthy schema and giving the one test that
   needs a failing schema (T-19) its own inline fake.
3. **Mechanical migrations when `state` became required.** Six existing `getContent`
   calls and one existing `get_content` tool call gained `state: "draft"` (plus a
   throwing `site` fake, for the service-level tests) so they kept typechecking and kept
   testing exactly what they tested before. No assertion changed.
4. **The review-driven fixture correction.** Described in full above — real schema
   fixtures, two new happy-path assertions, six tightened assertions, three new tests.
5. **A self-correction inside the review's own changes.** T-53 initially used
   `minLength` as its example of an "unimplemented `items` keyword," which directly
   contradicted the corrected live fixture — `stack.items.minLength` genuinely is
   implemented now. Changed to `maxLength`, a keyword the live schema never uses,
   mirroring T-11's precedent at the property level.

**No assertion was weakened in any of the seven.** Every change either kept an existing
check working under a wider type/required argument, or made a check stricter. Test count
only ever grew, from 90 to 124.

---

## Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| The review fixes are uncommitted | certain, right now | Land them as their own commit before raising the PR — see The review and the fixes. |
| `T-55` isn't recorded in `implementation.md`'s Test revisions table | low impact, but real | The test exists, passes, and is marked in-file as review-added; the paper trail should still be closed so a future reader of `implementation.md` isn't missing one entry. |
| `format: "date"` is still a deliberate no-op — accepted whenever the schema uses it, because the live schema pairs `writing.date` with a stronger `pattern` that does the real checking. If the site ever drops that `pattern`, dates stop being validated and nothing detects it | low | Now at least covered by T-52, which pins the current behaviour. Still can't detect a future site change. |
| The health route's and `get_content`'s published-read behaviour against the real deployed site are unverified this session | low | Run `curl https://<host>/{secret}/health` and a real `get_content` call after deploy. |
| Anything outside this repo still calls `get_content` without `state` | depends on what exists | It will start failing immediately on deploy. See Breaking change. |

**Rollback:** revert the nine commits (`98eb726`, `da25fc0`, `8b9b286`, `30008b5`,
`2215d76`, `4b01a66`, `6b97c8c`, `48cf191`, and the review-fix commit once it lands), or
revert the two slice PRs independently — they don't depend on each other in either
direction, since slice 2 doesn't call anything slice 1 built. No migration, no data
written anywhere.

---

## Deferred work

Ideas surfaced during the build that were deliberately not done. This replaces a separate
future-work file — everything deferred lives here.

| Item | Why deferred | Worth doing? |
|---|---|---|
| **M-2 — proving the branch-protection ruleset on `portfolio`'s `main` actually refuses a push with the widened token.** This is by hand, and slice 3 does not start without it. | Out of scope for slices 1–2; the token widening itself is a slice 3 concern | **yes, and it is the next thing, not an optional one** — it's the only enforcement of this feature's central safety claim |
| Detecting when the site's schema drops the `pattern` next to `format: "date"` | No live signal to detect it with — needs a human reading a future schema diff or a monitor comparing schema versions over time | maybe — only if the site's schema is ever actually changed this way |
| Recording `T-55` in `implementation.md`'s Test revisions table | Small, mechanical, should happen in the same commit as the review fixes | yes, trivially — do it when committing the fixes |

Anything marked **yes** that is non-trivial needs its own ADR before it becomes a spec.
The live-facts lesson from this review is worth carrying forward without needing one: a
"do not re-derive this" fact is only as good as the one check that verified it, and
nothing compared the interpreter against the real response until a review did it by hand.

---

## Documentation updated

Docs are live — updated in the same commit as the change that made them stale, except
where noted below.

- [x] `specs/005-publish/design.md` — Status flipped to `approved`; live facts corrected
      after the review (the `$schema` and `items` rows); a new **Tool descriptions**
      section added, since none existed to check descriptions against.
- [x] `specs/005-publish/CLAUDE.md` — the same live-facts correction, with the old
      "exactly ten keywords" wording kept struck through rather than silently replaced.
- [x] `specs/004-drafts/design.md` — the `save_draft`/`get_content` description blocks
      marked superseded by spec 005, with a pointer, rather than deleted (ADRs and specs
      are append-only).
- [x] `specs/005-publish/implementation.md` — task states, commits, session notes, and
      the seven test revisions, each updated as its task landed.
- [ ] `README.md`'s ADR-001 reasoning was corrected (MDX parsing is no longer why Bun/JS
      was chosen, per ADR-005) — **staged but not yet committed**, part of the same
      pending commit as the review fixes.
