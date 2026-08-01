# Drafts — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** not-started
- **Branch:** `feat/drafts`
- **Spec:** `design.md` · **ADR:** `docs/adr/004-drafts-are-real-mdx-in-workshop.md`
- **Current task:** none — `design.md` is awaiting human approval. **The loop does not start
  until its Status is `approved` and the seven Open questions are answered.**

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

**None.** Deliberately.

The token gains contents: read **and write** on `workshop` only, set by hand with
`fly secrets set`. ADR-004 → New obligations is explicit: *"Unlike P-2 in spec 002 it does
not block any task."* The serializer and the reader are pure functions that need no
credential, and the write path is proven the first time a draft is saved. The scope change
is folded into **Task 2's live check (M-1)**, which is a task, not a gate.

`portfolio` stays read-only. Nothing in this spec widens it.

---

## Tasks

In dependency order. Each task is independently testable and maps to test IDs in
`design.md`.

| # | Task | Depends on | Tests | Slice | State | Attempts | Commit |
|---|---|---|---|---|---|---|---|
| 1 | `src/lib/draft.ts` — `renderDraft`, `readDraft`, `draftPath`, `isSlug` | — | T-01, T-02, T-03, T-04, T-05, T-06, T-06b | 1 | `pending` | 0/3 | — |
| 2 | `src/lib/github.ts` — `readFileWithSha`, `writeFile`, `deleteFile`, `GithubConflictError`, `GithubAlreadyExistsError`, `fileContentSchema`, header-comment fix — **then verified against the real `workshop` repo** | — | M-1 | 1 | `pending` | 0/3 | — |
| 3 | `saveDraft`'s create path — slug check, published-slug check, reserved-key drop, render, create-only write | 1, 2 | T-07, T-08, T-12, T-13, T-14, T-32 | 2 | `pending` | 0/3 | — |
| 4 | `saveDraft`'s update path and the two conflict refusals | 3 | T-09, T-10, T-11, T-15 | 2 | `pending` | 0/3 | — |
| 5 | `src/services/get-content.ts` — read, parse, the two refusals | 1, 2 | T-19, T-20, T-21 | 2 | `pending` | 0/3 | — |
| 6 | `src/tools/save-draft.ts` and `src/tools/get-content.ts`, both registered in `src/tools/index.ts` | 4, 5 | T-25, T-26, T-27, T-28 | 2 | `pending` | 0/3 | — |
| 7 | Verify the read-modify-write loop on a real client, including from the phone | 6 | M-2 | 2 | `pending` | 0/3 | — |
| 8 | `src/services/discard-draft.ts` — read for the sha, delete, refuse if absent | 2 | T-16, T-17, T-18 | 3 | `pending` | 0/3 | — |
| 9 | `src/tools/discard-draft.ts` and its registration | 8 | T-29, T-30 | 3 | `pending` | 0/3 | — |
| 10 | Verify `discard_draft` on a real client | 9 | M-3 | 3 | `pending` | 0/3 | — |
| 11 | `src/services/list-drafts.ts` — slugs from `drafts/{kind}/` | 2 | T-22, T-23, T-23b | 4 | `pending` | 0/3 | — |
| 12 | `src/tools/list-content.ts` — the `state` argument, the branch, the rewritten description | 11 | T-24, T-31 | 4 | `pending` | 0/3 | — |
| 13 | Verify both `list_content` states on a real client | 12 | M-4 | 4 | `pending` | 0/3 | — |

### Notes on specific tasks

**Tasks 1 and 2 are independent of each other.** Either can go first. Task 1 needs no
credential at all — it is pure functions, and it is where the only genuinely new logic in
this spec lives.

**Task 2 carries the spec's live unknowns and closes them before anything depends on them.**
Same pattern as spec 002's Task 2. Before or immediately after writing the methods, drive
them against the real `workshop` repo and record the answers in `design.md` in the same
commit:

1. What status does GitHub return for a **stale `sha`** on `PUT /contents`? Assumed 409.
2. What status does it return for a **create (no `sha`) over an existing path**? Assumed
   422.
3. Is the commit attributed to the author rather than a bot, with no `author` field sent?
4. Does the widened token actually permit the write? A still-read-only token answers
   **404**, not 403 — see `design.md` → Risk 5.

**The token scope change belongs to Task 2 and gates nothing else.** Tasks 3–13 are written
against fakes and do not need it. If the token has not been widened yet, Task 2's code half
still lands; only M-1 waits, and only slice 1's PR sign-off waits with it. **This is not a
`blocked` state** — do not stop the loop for it.

**Task 2 is partly a human step.** The token is set by hand, straight into Fly. It never
passes through an agent or a file, and no agent reads `.env` to check it. See
[security.md](../../.claude/rules/security.md).

**Tasks 3 and 4 split one service** so neither exceeds a sane attempt budget, exactly as
spec 002 split `getSkill`. Task 3 ships `saveDraft` handling only a create; Task 4 adds the
`sha` path and the two conflict refusals. The file is touched twice on purpose.

**Task 6 is two tool files in one task** because they share one registration edit and one
MCP test file, and splitting them would mean two commits touching `src/tools/index.ts` for
no gain. Both are thin — a description, a schema, and rendering the result.

**Tasks 7, 10 and 13 cannot be automated.** Only a human can drive Claude Code, claude.ai
and the mobile app. Each closes its slice.

**Task 12 does not touch `src/services/list-content.ts`.** The `state: "draft"` branch calls
the new `listDrafts` service. Leaving the published path untouched is what makes
"unchanged" provable from the diff instead of argued in review.

**Expect one test revision at Task 12.** `registerListContent`'s `deps` widens from
`{ site }` to `{ site; github }`, so `src/tools/index.test.ts`'s handler helper may need the
field. That is input-only plumbing of the kind spec 002 recorded twice — it goes in the
table below, as its own commit, ahead of the red test.

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
| 1 | Tasks 1–2 — the format, and the ability to write | 2 | `pending` | — |
| 2 | Tasks 3–7 — `save_draft` and `get_content` | 5 | `pending` | — |
| 3 | Tasks 8–10 — `discard_draft` | 3 | `pending` | — |
| 4 | Tasks 11–13 — `list_content`'s `state` | 2 | `pending` | — |

Slices 2, 3 and 4 each depend only on slice 1, never on each other. If 3 or 4 has to be
reverted, the rest stands.

`get_content` sits in slice 2 rather than slice 4, where ADR-004's sketch put it, because
`save_draft`'s description and both of its refusal messages name it — and a description may
only name a registered tool. `design.md` → Open questions → G-2. Writes still come before
reads.

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

### 2026-08-01

- **Done:** Spec scaffolded from ADR-004. `design.md`, `CLAUDE.md` and this file written.
  No prerequisites recorded — the token scope change is a human step that gates no task,
  per ADR-004 → New obligations.
- **State:** `design.md` is **draft**, with seven open questions. Two are gaps in the ADR
  that the spec closes (G-1, empty metadata breaks the delimiter; G-2, the description rule
  moves `get_content` into slice 2); five are assumptions the spec makes where the ADR left
  room. **The loop does not start until they are answered and Status is `approved`.**
- **Next:** human review of `design.md`. Then Task 1 — `src/lib/draft.ts`, red test first
  (T-01 through T-06b).
- **Watch out for:**
  - `JSON.stringify(metadata, null, 2)` — the `2` is what puts the closing `}` at column 0.
    Remove it and the reader fails on the serializer's own output, silently, and only for
    files written after the change.
  - `JSON.stringify({}, null, 2)` is `"{}"` on one line, with no `}` line at all. Empty
    metadata is reachable through `save_draft`'s own contract. Hence the `{\n}` guard.
  - GitHub answers **404, not 403**, for a write the token may not make. A token that was
    never widened looks exactly like a missing path — that is Task 2's fourth check.
  - `atob` throws on GitHub's wrapped base64. Use `Buffer.from(x, "base64")`.
