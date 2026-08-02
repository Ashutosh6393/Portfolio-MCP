# Publish — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** not-started
- **Branch:** `feat/publish`
- **Spec:** `design.md` · **ADR:** `docs/adr/005-publish-opens-a-pull-request.md`
- **Current task:** none

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
| 1 | `lib/reading-time.ts` — words ÷ 200, `{n} min`, floor of one minute | — | T-13, T-14, T-15 | 1 | `pending` | 0/3 | — |
| 2 | `lib/validate.ts` — structure: `type`, `properties`, `required`, `additionalProperties`, and the **unknown-keyword refusal** | — | T-01, T-02, T-03, T-04, T-11, T-12 | 1 | `pending` | 0/3 | — |
| 3 | `lib/validate.ts` — constraints: `minLength`, `enum`, `pattern`, `format`, `minItems`, `items` | 2 | T-05, T-06, T-07, T-08, T-09, T-10 | 1 | `pending` | 0/3 | — |
| 4 | `lib/site.ts` — `fetchSchema` and the two-key envelope schema | — | T-16, T-17 | 1 | `pending` | 0/3 | — |
| 5 | `src/index.ts` — the `schema` health check | 4 | T-18, T-19 | 1 | `pending` | 0/3 | — |
| 6 | `lib/site.ts` — `fetchDocument(kind, slug)` and its response schema | — | T-20 (via 7) | 2 | `pending` | 0/3 | — |
| 7 | `services/get-content.ts` — the `state` argument and the published branch | 6 | T-20, T-21, T-22, T-23, T-24, T-25 | 2 | `pending` | 0/3 | — |
| 8 | `tools/get-content.ts` — `state` in the input schema, description rewritten | 7 | T-26, T-27 | 2 | `pending` | 0/3 | — |
| 9 | `tools/save-draft.ts` — the slug instruction in the description. **Text only.** | — | none — see note | 2 | `pending` | 0/3 | — |
| — | **M-2 — the ruleset refuses a push to `main`.** Blocks slice 3. | — | M-2 | 3 | `pending` | — | — |
| 10 | `lib/github.ts` — generalise `request` to take a path suffix. **Refactor only, no new behaviour.** | M-2 | none — existing suite stays green | 3 | `pending` | 0/3 | — |
| 11 | `lib/github.ts` — `getBranchHead`, `createBranch`, `createPullRequest`; a `branch` option on `writeFile`; narrow the write functions' `repo` parameter | 10 | none — see design.md → Seams | 3 | `pending` | 0/3 | — |
| 12 | `lib/publish.ts` — `publishedPath`, `branchName`, `publicUrl`, `renderPrBody`. Pure. | — | T-39, T-40 | 3 | `pending` | 0/3 | — |
| 13 | `services/publish.ts` — the create path end to end | 1, 3, 4, 11, 12 | T-28 … T-38, T-41, T-43 | 3 | `pending` | 0/3 | — |
| 14 | `tools/publish.ts` + registration in `tools/index.ts` | 13 | T-42 | 3 | `pending` | 0/3 | — |
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
| 1 | Tasks 1–5 — the schema arrives, health reports it | 4 | `pending` | — |
| 2 | Tasks 6–9 — `get_content` reads published content | 4 | `pending` | — |
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
| | | | |

---

## Session notes

Newest first. Keep entries short — this is a handoff, not a diary.

### 2026-08-03

- **Done:** spec scaffolded from ADR-005. Live facts checked against the real site and the
  real `portfolio` repo, then written into `design.md` → *Live facts* and `CLAUDE.md`.
- **State:** awaiting human approval of the slice plan. `design.md` Status stays `draft`
  until then.
- **Next:** answer the three Open questions in `design.md`, get approval, then Task 1.
- **Watch out for:** `content/projects/` is plural, `content/writing/` is singular, and the
  domain word for the former is singular. T-29 exists only to catch getting this backwards.
