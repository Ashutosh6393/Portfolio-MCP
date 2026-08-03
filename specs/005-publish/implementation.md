# Publish — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** in-progress — slice 3
- **Branch:** `feat/publish`
- **Spec:** `design.md` · **ADR:** `docs/adr/005-publish-opens-a-pull-request.md`
- **Current task:** none — slice 3 code done. M-1 is by hand. Next is task 15.

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
| 1 | `lib/reading-time.ts` — words ÷ 200, `{n} min`, floor of one minute | — | T-13, T-14, T-15 | 1 | `done` | 1/3 | `98eb726` |
| 2 | `lib/validate.ts` — structure: `type`, `properties`, `required`, `additionalProperties`, and the **unknown-keyword refusal** | — | T-01, T-02, T-03, T-04, T-11, T-12 | 1 | `done` | 1/3 | `da25fc0` |
| 3 | `lib/validate.ts` — constraints: `minLength`, `enum`, `pattern`, `format`, `minItems`, `items` | 2 | T-05, T-06, T-07, T-08, T-09, T-10 | 1 | `done` | 1/3 | `8b9b286` |
| 4 | `lib/site.ts` — `fetchSchema` and the two-key envelope schema | — | T-16, T-17 | 1 | `done` | 1/3 | `30008b5` |
| 5 | `src/index.ts` — the `schema` health check | 4 | T-18, T-19 | 1 | `done` | 1/3 | `2215d76` |
| 6 | `lib/site.ts` — `fetchDocument(kind, slug)` and its response schema | — | T-20 (via 7) | 2 | `done` | 1/3 | `4b01a66` |
| 7 | `services/get-content.ts` — the `state` argument and the published branch | 6 | T-20, T-21, T-22, T-23, T-24, T-25 | 2 | `done` | 1/3 | `6b97c8c` |
| 8 | `tools/get-content.ts` — `state` in the input schema, description rewritten | 7 | T-26, T-27 | 2 | `done` | 1/3 | `6b97c8c` |
| 9 | `tools/save-draft.ts` — the slug instruction in the description. **Text only.** | — | none — see note | 2 | `done` | 1/3 | `48cf191` |
| — | **M-2 — prove the ruleset refuses a push to `main`.** The ruleset is already configured; this proves it refuses *this* token. Blocks slice 3. | — | M-2 | 3 | `done` 2026-08-03 | — | see below |
| 10 | `lib/github.ts` — generalise `request` to take a path suffix. **Refactor only, no new behaviour.** | M-2 | none — existing suite stays green | 3 | `done` | 1/3 | `pending` |
| 11 | `lib/github.ts` — `getBranchHead`, `createBranch`, `createPullRequest`; a `branch` option on `writeFile`; narrow the write functions' `repo` parameter | 10 | none — see design.md → Seams | 3 | `done` | 1/3 | `pending` |
| 12 | `lib/publish.ts` — `publishedPath`, `branchName`, `publicUrl`, `renderPrBody`. Pure. | — | T-39, T-40 | 3 | `done` | 1/3 | `pending` |
| 13 | `services/publish.ts` — the create path end to end | 1, 3, 4, 11, 12 | T-28 … T-38, T-41, T-43 | 3 | `done` | 1/3 | `pending` |
| 14 | `tools/publish.ts` + registration in `tools/index.ts` | 13 | T-42 | 3 | `done` | 1/3 | `pending` |
| — | **M-1 — a real PR on `portfolio` from a real client** | 14 | M-1 | 3 | `pending` | — | — |
| 15 | `lib/github.ts` — `findPullRequest` by head branch; a `ref` on `readFileWithSha` | 11 | none — see design.md → Seams | 4 | `pending` | 0/3 | — |
| 16 | `services/publish.ts` — the four branch/PR states | 15 | T-44, T-45, T-46, T-48 | 4 | `pending` | 0/3 | — |
| 17 | `services/publish.ts` — `revise`, the published-slug escape, and updating an existing file | 16 | T-47, T-49, T-50, T-51 | 4 | `pending` | 0/3 | — |
| 18 | `tools/publish.ts` — the `revise` argument and the description update | 17 | covered by T-42 | 4 | `pending` | 0/3 | — |
| — | **M-3 — publishing twice from a phone leaves one PR** | 18 | M-3 | 4 | `pending` | — | — |

### Notes on specific tasks

**Task 9 has no test ID, and that is a known gap, not an oversight.** No test in this
project asserts a tool description's text. The change must be checked by eye against
`design.md` in the same commit, exactly as every slice of spec 004 did. It is listed as its
own task so it cannot be forgotten inside a bigger commit.

**Task 10 is the riskiest refactor in the feature.** Five shipped methods share the
`request` helper. The whole existing suite is the test: green before, green after, no test
file touched. If it cannot be, that is a `blocked` task, not a reason to edit a test.

**Task 11 will break type-checking in every `Github` fake.** Widening the type is what did
it in spec 004 (commit `93fc8ce`), and the same move is pre-authorised here: the **test
agent** adds throwing stubs for the new methods to each fake, as its own commit, ahead of
the code. Stubs throw — they never return a plausible value — so an accidental call fails
loudly instead of passing silently. Record it in **Test revisions** below when it happens.

**M-2 blocks task 10 and everything after it.** Do not start slice 3 on the assumption the
ruleset will be added later. It is the only enforcement of the project's central safety
claim.

### Attempt budget

**3 code attempts per task.** Resets each task, never carries over.

Stop early — do not spend the remaining budget — if the **same failure signature appears
twice in a row**. An identical error twice means the problem is not understood, and further
attempts distort the implementation to satisfy an assertion nobody has understood.

Environmental failures (missing dependency, bad import, config, flake) do not consume an
attempt. Fix them and retry.

On exhaustion: mark `blocked`, fill in the record below, **stop**. Do not start the next
task — tasks are dependency-ordered.

---

## PR slices

Each slice ships independently: summary → human review → PR → CI review.
Max 5–7 files (excluding tests) and 500 lines per slice.

| Slice | Contains | Files | State | PR |
|---|---|---|---|---|
| 1 | Tasks 1–5 — the schema arrives, health reports it | 4 | `awaiting review` | — |
| 2 | Tasks 6–9 — `get_content` reads published content | 4 | `awaiting review` | — |
| 3 | M-2, Tasks 10–14, M-1 — the PR path | 5 | `pending` | — |
| 4 | Tasks 15–18, M-3 — idempotency and `revise` | 2 | `pending` | — |

---

## Blocked

Nothing is blocked.

---

## Test revisions

Every deliberate change to a test, with justification. Written by the **test agent only**.
A revision on a task that was failing gets extra scrutiny from the human reviewer.

| Date | Test | Change | Why |
|---|---|---|---|
| 2026-08-03 | The 11 `Site` fakes in `src/index.test.ts` (2), `src/services/list-content.test.ts` (5), `src/services/save-draft.test.ts` (2) and `src/tools/index.test.ts` (2), plus the import line in `src/lib/site.test.ts` | Added a `fetchSchema` stub to every `Site` fake so each satisfies the widened `Site`. All stubs throw. Additions only — no assertion, test name, `describe` or fixture value touched, count stays at 107. Separately reformatted the multi-name import in `src/lib/site.test.ts` to satisfy Biome (formatting only, no assertion touched). | Task 4 widens `Site` (`src/lib/site.ts`) with `fetchSchema()`, so every fake must carry it to typecheck — 12 `TS2741` errors otherwise. Same pre-authorised move spec 004 recorded at Task 2 (commit `93fc8ce`): the test agent widens the fakes ahead of the code. Stubs throw rather than return a plausible value: no test in these files should reach the publish path, so an accidental call fails loudly instead of passing silently. |
| 2026-08-03 | `src/index.test.ts`: the module-level `fakeSite.fetchSchema` stub, plus T-19 | Changed the module-level `fakeSite.fetchSchema` from throwing to resolving `{ writing: {}, project: {} }`, so the shared default represents a healthy site. Gave T-19 its own inline `Site` (`siteWithBadSchema`, mirroring `unreachableSite` in T-17) whose `fetchSchema` throws, so T-19 no longer depends on the shared default failing. No assertion, test name, or any other fixture touched; count stays at 109 (107 + T-18/T-19 added by Task 5). | Task 5 adds a `schema` check to `GET /{secret}/health` that calls `deps.site.fetchSchema()` on every request. That invalidated the Task 4 stub's justification ("nothing in this file reaches the publish path"), so T-05, T-16 and 002-T-04 — which assert on `checks.site`/`checks.github` and have nothing to do with the schema check — started getting an incidental 503 from the shared fake instead of the 200 they test for. `src/index.ts` is correct; the fixture's premise was stale. |
| 2026-08-03 | The 12 `Site` fakes in `src/index.test.ts` (3), `src/services/list-content.test.ts` (5), `src/services/save-draft.test.ts` (2, via the shared `fetchDocumentNotPartOfThisTest` helper) and `src/tools/index.test.ts` (2) | Added a `fetchDocument` stub to every `Site` fake so each satisfies the widened `Site`. All stubs throw. Additions only — no assertion, test name, `describe` or fixture value touched, count stays at 109. | Task 6 widens `Site` (`src/lib/site.ts`) with `fetchDocument(kind, slug)`, so every fake must carry it to typecheck — 12 `TS2741` errors otherwise. Same pre-authorised move as the Task 4 row above. Stubs throw rather than return a plausible value: no test in these files should reach the publish-document read path, so an accidental call fails loudly instead of passing silently. |
| 2026-08-03 | `src/services/publish.test.ts`, T-43 loop, scenario `"an existing branch"` | Added an optional `expectedCreateBranchCalls` field to the T-43 scenario table (defaulting to 0) and set it to `1` for the `"an existing branch"` scenario only. `writeFile` and `createPullRequest` still assert `0` for every scenario, including this one. No other scenario's assertions touched. Escalated by the coder rather than edited by it — the coder stopped at the RED failure and reported it instead of touching the test. | T-41 (design.md line 438) requires the existing-branch refusal to come from GitHub itself — there is no other way to learn the branch exists without a speculative pre-check, which nothing in design.md or ADR-005 asks for and which would still race. `github.createBranch` is therefore necessarily called once on this path, and the dedicated T-41 test (`src/services/publish.test.ts` line ~475-497, written earlier in the same file) already asserts `calls.createBranch` has length 1 for this exact scenario. The T-43 loop's generic `createBranch` length-0 assertion contradicted that dedicated test. T-43's design.md line (440) says "the github fake records zero **writes**" — read as zero content landing in `portfolio` (`writeFile`, `createPullRequest`), not zero calls to every GitHub method, since the call that throws `GithubAlreadyExistsError` creates nothing. |
| 2026-08-03 | The 6 existing `getContent` calls in `src/services/get-content.test.ts` (T-19, T-20, T-21 ×2, T-33 ×2) | Added `state: "draft"` to every existing call's args and `site: noSiteAccess` (a `Site` fake whose every method throws) to every existing call's `deps`. Additions only — no assertion, test name, `describe`, or fixture value touched; count did not drop. | Task 7 makes `state` a required argument on `getContent` and widens `deps` from `{ github }` to `{ github; site }` (design.md → `get_content` gains `state`). Every draft-reading test written before this task called `getContent` with neither, so both would fail `tsc --noEmit` (`TS2345`/missing property) without this mechanical migration. `noSiteAccess` throws on any call so an accidental site touch during a draft read fails loudly, matching the precedent set by the `noWritePath` github fake already in this file. |
| 2026-08-03 | The 1 existing `get_content` call in `src/tools/index.test.ts` (T-28) | Added `state: "draft"` to the call's `arguments`. Mechanical only — no assertion, test name, `describe`, or other fixture value touched; count did not drop. | Task 8 makes `get_content`'s `state` argument required (design.md → `get_content` gains `state`, mirroring `list_content` since spec 004). T-28 called `get_content` with only `kind`/`slug`, which will fail Zod's required check once the widened schema lands. Migrating it to pass `state: "draft"` explicitly keeps it asserting the same behaviour it always did — a draft read — under the new required argument. |
| 2026-08-03 | `src/lib/validate.test.ts` — `liveWritingSchema`/`liveProjectSchema` (Task 3's fixtures), T-05 … T-10, plus 3 new tests | Review-driven revision, not a bug-fix-motivated one. **(a) Fixtures replaced, not tweaked:** `liveWritingSchema`/`liveProjectSchema` were hand-written and did not match the real site. They are now the actual documents captured live from `GET https://ashutoshverma.dev/api/schema.json` (saved verbatim before this edit), which carry a top-level `$schema` key and `stack.items.minLength` that the hand-written versions omitted — both keywords the shipped `validate()` refuses as unimplemented, so it errors on every real document. `structureOnly*` (Task 2's fixtures) were left untouched — still valid, still exercising T-11 against a schema with none of the constraint keywords. **(b) Missing assertions added, not weakened:** design.md's T-01/T-12 specify "the live writing/project schema... → `[]`", but no test ever ran a full valid document through the real fixtures — the only happy-path tests used the structure-only ones. Added two new tests doing exactly that; both are the ones that would have caught the `$schema`/`items.minLength` bug on day one. **(c) T-05 … T-10 strengthened:** every one previously asserted only `errors.some(matching)` — that one expected error exists among however many come back, never that no others do. A validator returning a spurious error on every field (exactly what shipped) passed all six unchanged. Each now asserts `toEqual([exact error])`. **(d) Three new tests, `T-52`/`T-53`/`T-54`, marked in-file as "added by review, not in design.md's original list":** `T-52` isolates the `format: "date"` no-op (a resolved Open question and a named Risk with zero test coverage — deleting the no-op line from `checkFormat` today would go undetected). `T-53` proves an unimplemented `items` keyword must be refused even when the array property is absent from the metadata (today the `items` walk only runs when the value is present, so it silently passes). `T-54` proves a property subschema with no `type` (or a non-string one) must be refused, not silently skipped (today `continue`s past every constraint on that field). No existing assertion was loosened anywhere in this revision — every change either corrects a fixture to match reality or adds/tightens a check. |
| 2026-08-03 | `src/lib/validate.test.ts` — T-53 | Self-correction of the row above. T-53 originally used `items: { type: "string", minLength: 1 }` as its example of an unimplemented `items` keyword, and asserted the error names `minLength`. That directly contradicted `T-12 (full live schema)` in the same revision, which asserts the real live project schema — whose `stack.items` genuinely is `{ type: "string", minLength: 1 }` — returns `[]`. Both cannot hold: `minLength` inside `items` must be implemented (T-12-full) and simultaneously refused as unimplemented (T-53). T-53 picked the wrong example keyword, not T-12-full, since T-12-full reflects the actual live document. Changed T-53's example and expected error string to `maxLength`, mirroring T-11's precedent of using `maxLength` at the property level as a keyword the live schema never uses and never will, so the test stays honest permanently. T-53's actual intent — an unimplemented `items` keyword is refused even when the array property is absent from the metadata — is unchanged. |
| 2026-08-03 | The 19 `Github` fakes across `src/index.test.ts` (2), `src/services/discard-draft.test.ts` (3, via the shared `noOtherPath` helper), `src/services/get-content.test.ts` (2, via `noWritePath`, plus 1 standalone `noGithubAccess`), `src/services/get-skill.test.ts` (2, via the shared `noWritePath` helper), `src/services/list-drafts.test.ts` (2, via `noOtherPath`), `src/services/save-draft.test.ts` (2, via `noReadPath`) and `src/tools/index.test.ts` (3 standalone, no shared helper in that file) | Added `getBranchHead`, `createBranch` and `createPullRequest` throwing stubs to every fake — via the file's existing shared helper where one exists, inline where it doesn't. All stubs throw. Additions only — no assertion, test name, `describe` or fixture value touched; count stays at 124. Also checked whether narrowing `deleteFile`'s first parameter to `"workshop"` broke any fake declaring `repo: Repo` on that method — none did, no further change needed there. | Task 11 widens `Github` (`src/lib/github.ts`) with the three publish-path methods, so every fake must carry them to typecheck — 19 `TS2739` errors otherwise. This is the revision the Task 11 note in "Notes on specific tasks" above pre-authorises by name: the test agent widens the fakes ahead of the code, mirroring spec 004's commit `93fc8ce`. Stubs throw rather than return a plausible value — no test in these files should reach the publish path, so an accidental call fails loudly instead of passing silently. Unlike the Task 4/6 rows above, this could not land as its own commit ahead of Task 11's code: a stub does not typecheck until the `Github` type carries the method, and the type does not typecheck until every fake carries the stub, so neither half is green alone. Landed together with Task 11 as one commit instead. |

---

## Session notes

Newest first. Keep entries short — this is a handoff, not a diary.

### 2026-08-03 — M-2 passed

**M-2 is closed. Slice 3 is unblocked.** Run by hand against the real repo with the
widened token. A direct push of an empty commit to `Portfolio-new`'s `main` was refused:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
 ! [remote rejected] main -> main (push declined due to repository rule violations)
```

The token was deliberately used rather than the owner's own git credentials — a repo
admin is usually on the ruleset's bypass list, so testing as the admin would have proved
nothing about the actor the server actually runs as.

The token used for this check was exposed in the session transcript and was rotated
immediately afterwards. M-2's result is unaffected: it proves the ruleset, not one
token string.

### 2026-08-03 — slices 1 and 2, and the review

- **Done:** slices 1 and 2. The reviewer found a blocking bug: `design.md` and `CLAUDE.md`
  recorded the live schema wrongly ("exactly ten keywords", "no nesting past one array of
  strings"), and the interpreter built to that description refused **every** valid post.
  Confirmed against the live route, fixed, and both documents corrected.
- **Watch out for:** T-55 in `get-content.test.ts` is a review-driven addition, not a
  revision, so it is deliberately not in the Test revisions table. It pins `SiteShapeError`.
- **Next:** M-2 — by hand, and it blocks all of slice 3.

### 2026-08-03

- **Done:** spec scaffolded from ADR-005. Live facts checked against the real site and the
  real `portfolio` repo, then written into `design.md` → *Live facts* and `CLAUDE.md`.
- **State:** awaiting human approval of the slice plan. `design.md` Status stays `draft`
  until then.
- **Next:** answer the three Open questions in `design.md`, get approval, then Task 1.
- **Watch out for:** `content/projects/` is plural, `content/writing/` is singular, and the
  domain word for the former is singular. T-29 exists only to catch getting this backwards.
