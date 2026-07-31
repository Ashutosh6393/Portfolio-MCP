# GitHub Access — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** not-started
- **Branch:** `feat/github-access`
- **Spec:** `design.md` · **ADR:** `docs/adr/002-github-access-and-workshop.md`
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

## Prerequisites

Not tasks — neither can be proved by a test in this repo. Both must be true before the
slice they gate can be signed off.

| # | Prerequisite | Gates | State |
|---|---|---|---|
| P-1 | `workshop` exists, private, with `skills/linkedin-post/` and `skills/writing/`, each holding `instructions.md` and `template.mdx` | Slice 2 | **done** — 2026-07-31 |
| P-2 | Fine-grained PAT, scoped to both repos, Contents: read-only, set with `fly secrets set` | Slice 1, Task 3 | pending |

---

## Tasks

In dependency order. Each task must be independently testable and map to test IDs in
`design.md`.

| # | Task | Depends on | Tests | Slice | State | Attempts | Commit |
|---|---|---|---|---|---|---|---|
| 1 | `GITHUB_TOKEN` in the env schema, and in `.env.example` by name only | — | T-01, T-02, T-03 | 1 | `pending` | 0/3 | — |
| 2 | `src/lib/github.ts` — `createGithub`, `listDirectory`, `readFile`, `GithubNotFoundError` — plus the `github` deep check wired into `src/index.ts` | 1 | T-04, T-05, T-06 | 1 | `pending` | 0/3 | — |
| 3 | Set the token on Fly, deploy, verify `checks.github` against the **real** repos | 2, P-2 | — (manual) | 1 | `pending` | 0/3 | — |
| 4 | `skillListSchema` in `lib/github.ts`, and `getSkill`'s list mode | 2 | T-07, T-08, T-09, T-14 | 2 | `pending` | 0/3 | — |
| 5 | `getSkill`'s named mode and its error paths | 4 | T-10, T-11, T-12, T-13 | 2 | `pending` | 0/3 | — |
| 6 | `src/tools/get-skill.ts` and its registration in `src/tools/index.ts` | 5 | T-15, T-16, T-17 | 2 | `pending` | 0/3 | — |
| 7 | Verify `get_skill` on Claude Code, claude.ai, and the mobile app | 6 | — (manual) | 2 | `pending` | 0/3 | — |

### Notes on specific tasks

**Task 2 carries the spec's three live unknowns.** Before writing the reader, confirm each
against the real API and record the answer in `design.md` in the same commit:

1. Does `Accept: application/vnd.github.raw` return the raw file body? (Risk 3 — the whole
   no-base64 design depends on it.)
2. What is the site repo's real name? (Risk 2 / Open question 1.)
3. Does a directory listing carry `name` and `type` as assumed?

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

### 2026-07-31

- **Done:** Spec scaffolded from ADR-002. Four files written, branch created off
  `docs/adr-002`.
- **State:** Awaiting the human gate on the slice plan. `design.md` Status is still
  `draft`.
- **Next:** Answer Open question 1 (the site repo's real name), set `design.md` Status to
  `approved`, then start Task 1.
- **Watch out for:** GitHub returns **404, not 403**, for a private repo the token cannot
  see. A mis-scoped token and a missing file are the same response. Never write an error
  message that claims a skill does not exist as a certainty.
