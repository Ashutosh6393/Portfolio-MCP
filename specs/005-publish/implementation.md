# Publish — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** in-progress — slice 4
- **Branch:** `feat/publish`
- **Spec:** `design.md` · **ADR:** `docs/adr/005-publish-opens-a-pull-request.md`
- **Current task:** 18 — `tools/publish.ts`, the `revise` argument and the description update

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
| 10 | `lib/github.ts` — generalise `request` to take a path suffix. **Refactor only, no new behaviour.** | M-2 | none — existing suite stays green | 3 | `done` | 1/3 | `1428d6e` |
| 11 | `lib/github.ts` — `getBranchHead`, `createBranch`, `createPullRequest`; a `branch` option on `writeFile`; narrow the write functions' `repo` parameter | 10 | none — see design.md → Seams | 3 | `done` | 1/3 | `4a36ada` |
| 12 | `lib/publish.ts` — `publishedPath`, `branchName`, `publicUrl`, `renderPrBody`. Pure. | — | T-39, T-40 | 3 | `done` | 1/3 | `e6f59a1` |
| 13 | `services/publish.ts` — the create path end to end | 1, 3, 4, 11, 12 | T-28 … T-38, T-41, T-43 | 3 | `done` | 1/3 | `1de0f71` |
| 14 | `tools/publish.ts` + registration in `tools/index.ts` | 13 | T-42 | 3 | `done` | 1/3 | `a3fd817` |
| — | **M-1 — a real PR on `portfolio` from a real client** | 14 | M-1 | 3 | `pending` | — | — |
| 15 | `lib/github.ts` — `findPullRequest` by head branch; a `ref` on `readFileWithSha` | 11 | none — see design.md → Seams | 4 | `done` | 1/3 | `2c62886` |
| 16 | `services/publish.ts` — the four branch/PR states | 15 | T-44, T-45, T-46, T-48 | 4 | `done` | 1/3 | `5d1c3a1` |
| 17 | `services/publish.ts` — `revise`, the published-slug escape, and updating an existing file | 16 | T-47, T-49, T-50, T-51 | 4 | `done` | 1/3 | `5d1c3a1` |
| 18 | `tools/publish.ts` — the `revise` argument and the description update | 17 | covered by T-42 | 4 | `done` | 1/3 | `a89f58b` |
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
| 3 | M-2, Tasks 10–14, M-1 — the PR path | 5 | `code done, reviewed, M-1 outstanding` | — |
| 4 | Tasks 15–18, M-3 — idempotency and `revise` | 2 | `code done, reviewed, M-3 outstanding` | — |

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
| 2026-08-03 | `src/tools/index.test.ts` line 314 — the `fakeDraftGithub.writeFile` fake | Mechanical signature fix, no behaviour change: added a fourth `_options` parameter to the fake's `writeFile` implementation. The fake's body is untouched — it still writes `{ content, sha: "draft-sha-2" }` into `draftFiles[path]` regardless of what is passed. | `writeFile` on the `Github` type (`src/lib/github.ts`) became a tuple-union overload — a `"portfolio"` write now requires a `branch` in its options, a `"workshop"` write does not. A three-parameter implementation is no longer assignable to that overloaded type, and `bun run typecheck` failed with exactly one error at this line (`TS2345`). This fake only ever writes to `workshop` in this test file (see the comment above it), so the extra parameter is unused, matching `githubFake` in `src/services/publish.test.ts`, which already carries the same fourth parameter for the same reason. |
| 2026-08-03 | `src/services/publish.test.ts` — added `T-61`, `T-62`, `T-63` (pure additions, nothing existing touched) | Slice 3 review found three gaps in test coverage of already-shipped behaviour in `src/services/publish.ts`. **`T-61`** — `design.md` → "`show` and `order`" states the rule that a project needs both in both directions; only the writing-refuses-them direction (T-32) had a test. Added a project publish with `order` omitted, asserting the refusal names both `show` and `order` and that `createBranch`/`writeFile`/`createPullRequest` are never called. **`T-62`** and **`T-63`** cover the two paths that can leave `portfolio` half-written (`design.md` → "This is the only path that can leave `portfolio` half-written", `src/services/publish.ts` lines 226–234): a `writeFile` failure after the branch is cut, and a `createPullRequest` failure after the commit lands. Both assert the refusal names the branch and points at the GitHub branch URL (`github.com/Ashutosh6393/Portfolio-new/tree/publish/...`) rather than the live site URL — pointing at the live site was a real bug this review caught (the post is not published, so its public URL is a 404 and knows nothing about pull requests). `T-63` additionally asserts the refusal does not claim GitHub is "unreachable" (`describeGithubFailure`'s reachable-but-failed branch, `src/services/publish.ts` lines 247–261) — GitHub answered in this scenario. Both `T-62` and `T-63` reject with an error carrying a sentinel string (`ZOD_ISSUE_DUMP_SENTINEL_DO_NOT_LEAK`) and assert the refusal text does **not** contain it — a check that the service does not interpolate an unknown error's `.message`, per `describeGithubFailure`'s own comment and `CLAUDE.md`'s "no raw Zod dump" rule. All three tests passed on first run: this is coverage closing, not TDD-red-then-green — the behaviour was already built (`src/services/publish.ts` lines 231–234), only untested. |
| 2026-08-03 | Every `Github` fake across `src/index.test.ts`, `src/services/discard-draft.test.ts`, `src/services/get-content.test.ts`, `src/services/get-skill.test.ts`, `src/services/list-drafts.test.ts`, `src/services/publish.test.ts`, `src/services/save-draft.test.ts`, `src/tools/index.test.ts` | Added a throwing `findPullRequest` stub to each. Additions only — 110 lines added, **zero removed**, no assertion, test name or fixture value touched, count unchanged at 162. | Task 15 widens `Github` with `findPullRequest`, so every fake must carry it to typecheck — 21 `TS2739` errors otherwise. Same pre-authorised move as the Task 11 row. **The stubs throw rather than returning `null`, and here that matters more than usual: `null` is a meaningful answer from this method — it means "no pull request has ever existed for this branch" — so a stub returning it would let an idempotency test pass while proving nothing.** Written by the test agent; the agent was interrupted by a session limit before it could record the row, so the row was transcribed afterwards by the coder. The coder wrote no test code — verified by `git diff` showing zero deletions across all `*.test.ts`. |
| 2026-08-03 | `src/services/publish.test.ts` — the slice-3 `githubFake` builder. **Escalated by the coder (Task 16/17), not edited by it.** | Made `findPullRequest` configurable (`findPullRequestResult?: PrLike \| null \| Error`, default `null`) instead of the throwing stub the row above recorded, and added `findPullRequest` to `Calls`/`emptyCalls` so tests can assert on it. Six previously-failing tests (T-28, T-29, T-30, T-31, T-62, T-63) needed no other change — they pass once the fake's default answer is truthful. | Task 16 makes `publish` call `deps.github.findPullRequest("portfolio", branch)` on **every** run (design.md → Approach, "found by branch name, never a number recorded anywhere"), to learn what already happened to the slug before deciding create/update/refuse/recreate. The throwing stub's justification — "nothing in this file reaches that path" — expired the moment Task 16 made the path live, exactly the situation the Task 5 row in this table already named. `null` is the *correct*, not merely convenient, default: every fixture in this file describes a slug that has never been published, so "no pull request has ever existed for this branch" is the true answer, not a placeholder. Kept configurable (an explicit result or an `Error`) so slice-4 scenarios that need a different answer still can. |
| 2026-08-03 | `src/tools/index.test.ts` — `fakeGithubForPublish`'s `findPullRequest` stub (T-42) | Same fix as the row above, found by running the full suite after Task 16's tests went green: changed the stub from throwing to resolving `null`. This fake is the one built to actually complete a publish end to end through the MCP handler, so once Task 16 made `findPullRequest` load-bearing, the throw failed T-42's "successful publish" assertion (`isError` became `true`). The three other `findPullRequest` throwing stubs in this file (lines ~103, ~349, ~671, on fakes for `list_content`/`save_draft`/`get_content`, none of which reach the publish path) were left untouched — they still correctly throw if ever touched by mistake. | Identical justification to the row above: the stub's premise ("the publish service under test here does not call `findPullRequest` yet") expired when Task 16 shipped. |
| 2026-08-03 | `src/services/publish.test.ts` — T-41 and its row in the T-43 loop. **Escalated by the coder (Task 16), not edited by it. Deliberate supersession, not a test bent to fit code.** | Removed the old T-41 ("an existing branch refuses cleanly") and the `"an existing branch"` scenario from the T-43 loop (along with the now-dead `expectedCreateBranchCalls` field it needed). Added a replacement test, kept under the same ID, in a new `describe("publish — a leftover branch with no pull request (T-41, superseded by T-44)")`: a branch with no tracked pull request proceeds, writes with no `sha` (a create, not an overwrite), and opens a fresh PR. Net static `test(` count unchanged (one removed, one added); the T-43 loop's dynamic test count drops by one scenario, which `check-test-count.sh` does not track (it counts `test(`/`it(` call sites in source, not runtime invocations) and does not need to, since the scenario's coverage moved rather than vanished. `design.md` → Test cases → Slice 3, T-41 row updated in the same commit to say it is superseded, quoting the reason. | **Verdict: superseded, not broken.** `design.md` → *Edge cases and failure modes* says, in terms that name their own expiry: *"Duplicate submission → the whole of slice 4. Until slice 4 ships, a second publish is a clean refusal (T-41), never a silent overwrite."* Slice 4 (Tasks 16–17) is what "ships" here, and its whole purpose (design.md → Slice plan, row 4: "Saying 'publish it' twice leaves exactly one PR") is to replace T-41's refusal with T-44's update-in-place. The implementation the coder escalated — an existing branch no longer refuses, it proceeds — is exactly what slice 4 was built to do, not a guarantee it broke. What T-41 actually protected (no crash, no silent overwrite) still holds and is now pinned directly: the replacement test asserts the write carries no `sha` (so it cannot be replacing content it never read) and that a PR is still opened rather than the write being dropped silently. |
| 2026-08-03 | `src/services/publish.test.ts` — `githubFake`'s `readFileWithSha`, plus new `T-64`; `src/tools/index.test.ts` — `fakeGithubForPublish`'s `readFileWithSha` | **Slice-4 review found a hollow fake, escalated as a defect in the test fixtures, not the source.** The row above (`2026-08-03`, "Task 16/17… made `findPullRequest` configurable") describes that revision as making the slice-3 fakes "truthful" — but that was only true of `findPullRequest`. `readFileWithSha` was left answering **both** of `publish`'s two calls through it (the workshop draft read, and Task 16's new create-vs-update read against `portfolio`) with the same draft content and `sha: "draft-sha"`, regardless of which repo was asked. Every fixture in both files describes a first publish, where the truth is that `portfolio` does not carry the file yet — so the fake was lying on the one call whose answer decides whether a commit is a create (no `sha`) or an overwrite (a `sha`), and every affected test (T-28, T-29, T-30, T-31, T-39, T-40, the T-43 loop, and T-42 — the only end-to-end handler test) was silently exercising the overwrite path. **Fix, in both fakes:** `readFileWithSha` now discriminates on its `repo` argument, mirroring `statefulGithubFake`'s existing pattern: `"workshop"` still returns the configured draft; `"portfolio"` throws `GithubNotFoundError` by default (configurable via a new `fileOnBranch` option in `publish.test.ts`, since no scenario needed the file-present case). **Checked, not just patched:** re-read every affected test's assertions for whether any depended on the old (wrong) `sha: "draft-sha"` behaviour — none did; none of T-28 … T-43 or T-42 asserts on `write.options.sha` at all, so no existing assertion needed correcting, only the fake's truthfulness. **Added `T-64`** ("a first publish sends no `sha`") in `src/services/publish.test.ts`, the assertion that was impossible to write honestly while the fake lied: a fresh branch with no `fileOnBranch` configured → `calls.writeFile[0]?.options.sha` is `undefined`. Added to `design.md` → Test cases → Slice 4, marked added by review. | The create path is the one that makes `describeGithubFailure`'s "nothing was overwritten" claim (and GitHub's own create-vs-update refusal semantics) actually true — and it was never exercised by a single test before this fix, because every fake handed back a `sha` a first publish would never have. |

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
