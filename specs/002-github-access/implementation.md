# GitHub Access — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** in-progress — Slice 1, code complete, **Task 3 blocked on P-1**
- **Branch:** `feat/github-access`
- **Spec:** `design.md` · **ADR:** `docs/adr/002-github-access-and-workshop.md`
- **Current task:** 3 — blocked. `workshop` has no commits; see Blocked below.

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

## Prerequisites

Not tasks — neither can be proved by a test in this repo. Both must be true before the
slice they gate can be signed off.

| # | Prerequisite | Gates | State |
|---|---|---|---|
| P-1 | `workshop` exists, private, with `skills/linkedin-post/` and `skills/writing/`, each holding `instructions.md` and `template.mdx` | Slice 2 | **NOT met** — reopened 2026-07-31 in Task 2. The repo exists and the token reads it (metadata 200, `private: true`), but it has **no commits**: `size: 0`, and `contents/` answers 404 "This repository is empty." There is no `skills/` yet. Blocks Slice 2 and Task 3. |
| P-2 | Fine-grained PAT, scoped to `Portfolio-new` and `workshop`, Contents: read-only, set with `fly secrets set` | Slice 1, Task 3 | **done** — 2026-07-31, scope confirmed |

---

## Tasks

In dependency order. Each task must be independently testable and map to test IDs in
`design.md`.

| # | Task | Depends on | Tests | Slice | State | Attempts | Commit |
|---|---|---|---|---|---|---|---|
| 1 | `GITHUB_TOKEN` in the env schema, and in `.env.example` by name only | — | T-01, T-02, T-03 | 1 | `done` | 1/3 | (this commit) |
| 2 | `src/lib/github.ts` — `createGithub`, `listDirectory`, `readFile`, `GithubNotFoundError` — plus the `github` deep check wired into `src/index.ts` | 1 | T-04, T-05, T-06 | 1 | `done` | 1/3 | (this commit) |
| 3 | Set the token on Fly, deploy, verify `checks.github` against the **real** repos | 2, P-2, **P-1** | — (manual) | 1 | `blocked` | 0/3 | — |
| 4 | `skillListSchema` in `lib/github.ts`, and `getSkill`'s list mode | 2 | T-07, T-08, T-09, T-14 | 2 | `pending` | 0/3 | — |
| 5 | `getSkill`'s named mode and its error paths | 4 | T-10, T-11, T-12, T-13 | 2 | `pending` | 0/3 | — |
| 6 | `src/tools/get-skill.ts` and its registration in `src/tools/index.ts` | 5 | T-15, T-16, T-17 | 2 | `pending` | 0/3 | — |
| 7 | Verify `get_skill` on Claude Code, claude.ai, and the mobile app | 6 | — (manual) | 2 | `pending` | 0/3 | — |

### Notes on specific tasks

**Task 2 carries the spec's three live unknowns.** All closed 2026-07-31 against the live
API, before the reader was written. Recorded in `design.md` → Risks 3.

1. ~~Does `Accept: application/vnd.github.raw` return the raw file body?~~ **Yes.** 200,
   `content-type: application/vnd.github.raw`, the file's real bytes — no base64 envelope.
   No decoder is written, as the design says.
2. ~~Does a directory listing carry `name` and `type` as assumed?~~ **Yes.** An array;
   `type` is `"dir"` or `"file"`.
3. ~~What is the site repo's real name?~~ Closed before Task 1: **`Portfolio-new`**.

The same pass turned up the unknown nobody was looking for: **`workshop` is empty.** See
P-1 above and `design.md` → Risk 7.

**Task 3 is blocked on P-1, not on anything in the code.** The `github` check reads both
repo roots, and a repo with no commits answers 404. It will report `unreachable` until
`skills/` is pushed to `workshop`. Deploying before then would verify nothing.

**Task 3 is a human step and cannot be automated.** The token is set by hand, straight into
Fly. It never passes through an agent or a file. Criterion 3 of Slice 1 — the 503 path —
must be *observed*, not assumed: point a repo constant at a name that does not exist, watch
the check fail, put it back.

**Tasks 4 and 5 split one service** so neither exceeds a sane attempt budget. Task 4 ships
`getSkill` answering only the no-name case; Task 5 adds the named branch. The file is
touched twice on purpose.

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
| 1 | Tasks 1–3 — the credential works | 4 | `pending` | — |
| 2 | Tasks 4–7 — `get_skill` | 4 | `pending` | — |

---

## Blocked

**Task 3 — deploy and verify `checks.github` against the real repos.** Blocked on P-1, not
on an attempt budget. No code attempt was made or needed.

- **What is true:** the token is valid and correctly scoped. `Portfolio-new` metadata and
  `contents/` both answer 200; `workshop` metadata answers 200 with `private: true`, so the
  token can see the private repo.
- **What is not:** `workshop` has no commits. `size: 0`, and
  `GET /repos/Ashutosh6393/workshop/contents/` answers 404 "This repository is empty."
- **Consequence:** `checks.github` is `unreachable` on a healthy setup, so Slice 1
  acceptance criterion 2 cannot be observed and Slice 2 has nothing to read.
- **Unblocks when:** `skills/linkedin-post/` and `skills/writing/`, each with
  `instructions.md` and `template.mdx`, are pushed to `workshop` — which P-1 already
  required. Then re-run Task 3.
- **Not a code change.** Nothing in `lib/github.ts` or the health check needs to differ.

---

## Test revisions

Every deliberate change to a test, with justification. Written by the **test agent only**.
A revision on a task that was failing gets extra scrutiny from the human reviewer.

| Date | Test | Change | Why |
|---|---|---|---|
| 2026-07-31 | The eight `createApp` calls, `src/index.test.ts` | Replaced the inline `{ site: fakeSite }` with a shared `testDeps` holding both fakes. No assertion changed, no test body touched. | Task 2 adds `github` to `createApp`'s deps, which by design makes a missing injection a compile error. Pure plumbing, and the same revision spec 001 made when `deps` became required — its note is three lines above this one in the file. |
| 2026-07-31 | `testEnv`, `src/index.test.ts` | Added `GITHUB_TOKEN` to the shared environment const. No assertion changed, no test body touched. | Task 1 adds the variable to `Env`, so an environment without it stops type-checking — `bun test` was green while `bun run typecheck` failed in all eight `createApp` calls. One const, one field. No route under test reads its value. |
| 2026-07-31 | Spec 001 T-03 (both cases), `src/lib/env.test.ts` | Added `GITHUB_TOKEN` to the environment object each one passes to `parseEnv`. No assertion changed. | Task 1 makes `GITHUB_TOKEN` required. Their input was a complete environment when written and stopped being one; without this they would fail on a missing variable instead of on PORT coercion and defaulting, which is what they exist to assert. Landed before Task 1's red test, while the suite was still green — the revision passes against the old schema and the new one. |

---

## Session notes

Newest first. Keep entries short — this is a handoff, not a diary.

### 2026-07-31 — Task 2

- **Done:** `src/lib/github.ts` — `createGithub`, `listDirectory`, `readFile`,
  `GithubNotFoundError` — and the `github` deep check in `src/index.ts`, covering both
  repos in parallel with the site check. 3 tests added (33 total, was 30).
- **Verified live before writing anything:** the raw `Accept` header works, so no base64
  decoder exists; listings carry `name` and `type`. Both recorded in `design.md`.
- **Found:** `workshop` is empty. P-1 is reopened and Task 3 is blocked on it. Nothing in
  the code needs to change — see Blocked above.
- **Next:** a human pushes `skills/` to `workshop`, then Task 3. Slice 2 (Tasks 4–7) cannot
  start before that either.

### 2026-07-31 — Task 1

- **Done:** `GITHUB_TOKEN` in `envSchema` with a `github_pat_` prefix check, and in
  `.env.example` by name only. 4 tests added (30 total, was 26). Two test revisions, both
  input-only, both landed as their own commits ahead of the code — see the table above.
- **Next:** Task 2. Before writing `lib/github.ts`, verify the two live unknowns against
  the real API and record the answers in `design.md` in the same commit.

### 2026-07-31

- **Done:** Spec scaffolded from ADR-002. Four files written, branch created off
  `docs/adr-002`. P-1 and P-2 both satisfied. Open question 1 closed — the site repo is
  `Portfolio-new`.
- **State:** `design.md` **approved** by Ashutosh Verma on 2026-07-31. No open questions,
  no unmet prerequisites. The loop is clear to start.
- **Next:** Task 1 — `GITHUB_TOKEN` in the env schema and `.env.example`. Red test first
  (T-01, T-02, T-03).
- **Watch out for:** GitHub returns **404, not 403**, for a private repo the token cannot
  see. A mis-scoped token and a missing file are the same response. Never write an error
  message that claims a skill does not exist as a certainty. The token's scope is confirmed
  correct, so a 404 in Task 3 means a wrong path or a wrong repo constant — not the
  credential.
