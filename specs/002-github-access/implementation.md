# GitHub Access — Implementation

Live state. The **source of truth** for where things stand. An agent resuming this feature
reads this file first and picks up from it.

Update it after every task. Never batch updates.

- **Status:** both slices complete, deployed and verified on all three clients. **Done.**
- **Branch:** `feat/github-access-skill` → PR 2, stacked on `feat/github-access` (PR 1).
- **Spec:** `design.md` · **ADRs:** `docs/adr/002-github-access-and-workshop.md`,
  `docs/adr/003-skills-and-templates-are-separate.md`
- **Current task:** none. Nothing outstanding — Task 7's client half was driven by hand on
  2026-07-31 and `get_skill` answered on Claude Code, claude.ai and the mobile app.

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
| P-1 | `workshop` exists, private, and **has commits**, holding `skills/be-human.md`, `skills/linkedin-post.md`, `skills/twitter-post.md`, `templates/writing.md`, `templates/project.md` (ADR-003) | Slice 2, **Task 3** | **done** — 2026-07-31. Pushed and verified live: `skills/` lists all three, `templates/` lists both, and a raw read of `be-human.md` returns 200. Templates are `.md`, not the `.mdx` ADR-003 assumed; irrelevant, names resolve from the listing. |
| P-2 | Fine-grained PAT, scoped to `Portfolio-new` and `workshop`, Contents: read-only, set with `fly secrets set` | Slice 1, Task 3 | **done** — 2026-07-31, scope confirmed |

---

## Tasks

In dependency order. Each task must be independently testable and map to test IDs in
`design.md`.

| # | Task | Depends on | Tests | Slice | State | Attempts | Commit |
|---|---|---|---|---|---|---|---|
| 1 | `GITHUB_TOKEN` in the env schema, and in `.env.example` by name only | — | T-01, T-02, T-03 | 1 | `done` | 1/3 | (this commit) |
| 2 | `src/lib/github.ts` — `createGithub`, `listDirectory`, `readFile`, `GithubNotFoundError` — plus the `github` deep check wired into `src/index.ts` | 1 | T-04, T-05, T-06 | 1 | `done` | 1/3 | (this commit) |
| 3 | Set the token on Fly, deploy, verify `checks.github` against the **real** repos | 2, P-2, P-1 | — (manual) | 1 | `done` | 0/3 | deployed, no code |
| 4 | `entryListSchema` in `lib/github.ts`, and `getSkill`'s list mode over `skills/` and `templates/` | 2 | T-07, T-08, T-09, T-13, T-14 | 2 | `done` | 1/3 | (this commit) |
| 5 | `getSkill`'s named mode — resolve from the listing, bundle the voice — and its error paths | 4 | T-10, T-10b, T-10c, T-10d, T-11, T-12 | 2 | `done` | 1/3 | (this commit) |
| 6 | `src/tools/get-skill.ts` and its registration in `src/tools/index.ts` | 5 | T-15, T-16, T-17 | 2 | `done` | 1/3 | (this commit) |
| 7 | Verify `get_skill` on Claude Code, claude.ai, and the mobile app | 6 | — (manual) | 2 | `done` | 0/3 | deployed, no code |

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

**Tasks 4–6 were re-scoped by ADR-003 before any of them started**, so this is a plan
change, not rework. The shape they build now: two flat directories, names resolved from the
listing rather than by building a path, and `skills/be-human.md` bundled into every named
answer. Read ADR-003 and `design.md` → Approach → `get_skill` before starting Task 4.

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
| 1 | Tasks 1–3 — the credential works | 4 | complete, at the gate | `feat/github-access` |
| 2 | Tasks 4–7 — `get_skill` | 5 | complete, at the gate | `feat/github-access-skill` |

**These are stacked PRs. Review and merge 1 first.** Both slices were built in one session
and together came to 8 source files and 410 lines, over the 5–7 file ceiling, so they were
split back apart at `feat/github-access`'s tip. Slice 2 uses `lib/github.ts` and nothing
else from Slice 1, so the halves review and revert independently.

Slice 2's file count is 5, not the 4 planned: `fly.toml` rode along with it. The VM drop to
256mb belongs to neither slice and had to go somewhere.

---

## Blocked

Nothing is blocked. Task 3's block cleared on 2026-07-31 when P-1 was satisfied — the five
files were pushed and `workshop` stopped answering 404. It was never a code problem, and no
code changed.

---

## Test revisions

Every deliberate change to a test, with justification. Written by the **test agent only**.
A revision on a task that was failing gets extra scrutiny from the human reviewer.

| Date | Test | Change | Why |
|---|---|---|---|
| 2026-07-31 | `postJsonRpc`, `src/tools/index.test.ts` | Passed `github` alongside `site` into the single `createHandler` call the helper makes. No assertion changed, no test body touched. | Task 6 registers `get_skill`, so `createHandler`'s deps grew — the same required-injection design as `createApp`. One call site, one field. |
| 2026-07-31 | The eight `createApp` calls, `src/index.test.ts` | Replaced the inline `{ site: fakeSite }` with a shared `testDeps` holding both fakes. No assertion changed, no test body touched. | Task 2 adds `github` to `createApp`'s deps, which by design makes a missing injection a compile error. Pure plumbing, and the same revision spec 001 made when `deps` became required — its note is three lines above this one in the file. |
| 2026-07-31 | `testEnv`, `src/index.test.ts` | Added `GITHUB_TOKEN` to the shared environment const. No assertion changed, no test body touched. | Task 1 adds the variable to `Env`, so an environment without it stops type-checking — `bun test` was green while `bun run typecheck` failed in all eight `createApp` calls. One const, one field. No route under test reads its value. |
| 2026-07-31 | Spec 001 T-03 (both cases), `src/lib/env.test.ts` | Added `GITHUB_TOKEN` to the environment object each one passes to `parseEnv`. No assertion changed. | Task 1 makes `GITHUB_TOKEN` required. Their input was a complete environment when written and stopped being one; without this they would fail on a missing variable instead of on PORT coercion and defaulting, which is what they exist to assert. Landed before Task 1's red test, while the suite was still green — the revision passes against the old schema and the new one. |

---

## Session notes

Newest first. Keep entries short — this is a handoff, not a diary.

### 2026-07-31 — Task 7 closed, spec complete

- **`get_skill` driven by hand on all three clients** — Claude Code, claude.ai, and the
  mobile app. All three list and return skills. That was the riskiest unknown in the whole
  plan (`docs/adr/mcp-design.md` → Build order): a custom connector cannot be tested
  locally on mobile. It works.
- **Spec 002 is complete.** Nothing outstanding on either slice.

### 2026-07-31 — split into two PRs, deployed and verified

- **Deployed.** Two attempts failed identically on Fly's depot builder
  (`context deadline exceeded`) — infrastructure, not code. `--depot=false` released first
  try. The same failure signature twice was the signal to change method, not retry again.
- **Verified in production:** deep health 200 with `site` and `github` both `ok`;
  `tools/list` returns `list_content` **and** `get_skill`; `get_skill` lists three skills
  and two templates; an unknown name answers HTTP 200 with `isError: true` naming what
  exists.
- **Not verified in production: the 503 path.** Observed locally against the real API by
  pointing a repo constant at a name that does not exist. Reproducing it on the deployed
  server would mean deliberately breaking production.
- **Branch split.** Slice 1 stayed on `feat/github-access`; Slice 2's four commits were
  rebased onto its tip as `feat/github-access-skill`. The doc conflicts were resolved to
  the incoming side and the combined state fixed here, in one commit, rather than by hand
  in each replayed commit.
- **Outstanding:** the client half of Task 7. Only a human can drive Claude Code, claude.ai
  and the mobile app.

### 2026-07-31 — Task 6

- **Done:** `src/tools/get-skill.ts` and its registration. 4 tests added (48 total, was
  44). The description is the specified text, verbatim.
- **`name` is optional** in the input schema — a required one would make the listing mode
  unreachable, which is the mode a model needs first.
- **Rendering:** voice first under its own heading, then the rules or the template.
  Asking for `be-human` prints one section, not two.
- **Next:** Task 7 — verify on Claude Code, claude.ai and mobile. Needs the deploy, which
  is still failing on Fly's builder queue rather than on anything in this repo.

### 2026-07-31 — Task 5

- **Done:** `getSkill`'s named mode. 6 tests added (44 total, was 38).
- **Two corrections to `design.md`, both recorded there:**
  1. The voice is resolved from the listing like everything else, not read on a hardcoded
     `skills/be-human.md`. The original sketch contradicted its own "never guess a path"
     rule, and moving it to round 2 costs nothing — still four calls, two round trips.
  2. Asking for `be-human` returns it under `voice` alone. The spec said `instructions`,
     which would have meant the same 6 KB under two keys in every such answer.
- **Refactor:** the first green used `template as Entry`. Replaced with a resolved `target`
  that carries its own `isSkill` flag, so there is no unchecked cast — `code-style.md`
  bans them and the ban is worth more than the two lines it cost.
- **Next:** Task 6, the tool and its registration.

### 2026-07-31 — Task 4

- **Done:** `entryListSchema` in `lib/github.ts`, and `getSkill`'s no-name mode listing
  `skills/` and `templates/` in parallel. 5 tests added (38 total, was 33).
- **`type` is `z.string()`, not an enum.** GitHub also returns `symlink` and `submodule`;
  an enum would fail a whole listing over one odd entry. Callers filter on `"file"`. Same
  reasoning as `status` in `site.ts`.
- **T-13 was pulled forward** from Task 5 — the GitHub-failure catch is shared between both
  modes, so it existed the moment the list mode did and would have gone untested otherwise.
- **Next:** Task 5, the named mode: resolve from the listing, bundle the voice, error paths.

### 2026-07-31 — Task 3, local half

- **P-1 satisfied.** The five files are in `workshop`. Templates landed as `.md`, not the
  `.mdx` ADR-003 assumed — no consequence, because names resolve from the listing. Recorded
  in `design.md` and the feature `CLAUDE.md` so nobody hunts a bug over it.
- **Both health paths observed, not assumed,** through the real handler against the live
  site and the live repos:
  - 200 · `{"site":"ok","github":"ok"}` · ~1.0s cold, ~0.8s warm
  - Repo constant pointed at a name that does not exist → 503 ·
    `{"site":"ok","github":"unreachable"}` · and `site` stayed `ok`, so the two checks are
    genuinely independent. The edit was reverted and `src/` verified clean.
- **Cold-start note (Risk 6):** the deep check runs three outbound calls in parallel and
  costs ~1s end to end. No tool path touches this route.
- **Outstanding:** `fly deploy`, then the same check against the deployed URL. `fly secrets
  list` confirms `GITHUB_TOKEN` and `MCP_SECRET_PATH` are both already set.

### 2026-07-31 — ADR-003, spec amended

- **What changed:** the real `workshop` content is five files that do not pair up —
  `be-human`, `linkedin-post` and `twitter-post` are rules with no template; `writing` and
  `project` are templates with no rules of their own. ADR-002's "one directory per skill,
  both halves or neither" cannot hold, so ADR-003 supersedes those two sections.
- **New shape:** `skills/` and `templates/` as flat files; `get_skill` serves both; names
  resolve from the listing so the extension is never guessed; `be-human` rides along with
  every named answer, and its absence is a hard error.
- **Cost:** none in code. Slice 2 had not started, so this is a plan change. Slice 1 is
  untouched — `lib/github.ts` never knew the layout. `design.md` test cases T-07…T-17 were
  rewritten and three added (T-10b, T-10c, T-10d).
- **Still blocked on P-1,** now against the new file list.

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
