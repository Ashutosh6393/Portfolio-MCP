# Publish — Summary

Written for a **human**, at the point the whole feature is complete — before any PR is
raised and before any automated review has run. It must stand on its own.

Read this, then the diff, then approve.

- **Slices:** 4 of 4, all done · **Branch:** `feat/publish`
- **Spec:** `specs/005-publish/design.md` · **ADR:** `docs/adr/005-publish-opens-a-pull-request.md`
- **Tasks:** all 18 in `implementation.md` are `done`. Two manual checks remain open — see
  Deferred work, it matters more than usual here.
- **Tests:** 90 → 171, 0 fail. Verified by running the suite at the commit before this
  feature started (`8310d5f`, confirmed `90 pass`) and at the tip (`171 pass`) — see Verify
  it yourself.
- **Size:** 32 files touched overall (5,026 insertions, 720 deletions), across four slices
  that were each raised and sized independently. Source only, excluding tests and docs:
  `src/lib/github.ts`, `src/lib/publish.ts`, `src/services/publish.ts`, `src/tools/publish.ts`,
  `src/tools/index.ts` carry the PR path — 794 lines net across slices 3 and 4 combined,
  because `publish.ts` and `github.ts` both grew again in slice 4. Each slice individually
  stayed inside the project's 5–7 file / 500 line PR limit; the four together do not, and
  were never meant to — this document exists precisely so the four can be reviewed as one
  story even though they ship as separate PRs.

This replaces the version that covered slices 1–2 only. That version is now three slices
out of date: `publish` did not exist when it was written, and it has since been built,
reviewed twice more, and fixed twice more.

---

## TL;DR

`publish` — the sixth and last tool — now exists. Ask for a draft to go live and it opens a
real pull request against the public site, on a branch, with a Vercel preview build.
Nothing in this feature can merge that PR. A human still clicks the button.

Four slices got there:

1. **The schema arrives** — a hand-written interpreter reads the site's live publishing
   rules (`lib/validate.ts`), a reading-time estimate is computed from the body, and
   `/{secret}/health` gained a third check so the server notices on its own if the site's
   schema becomes unreachable or changes shape.
2. **Read a published post** — `get_content` can now read something already live on the
   site, not just a draft. This is what makes revising a post from a phone possible before
   `publish` exists to save the edit anywhere. It also made `get_content` **require** a new
   argument, `state` — a breaking change, still in effect (see Breaking change).
3. **Open the PR** — the actual write path. `publish` reads a draft, validates it against
   the schema, renders it into the public repo (`portfolio`) on a branch named
   `publish/{kind}/{slug}`, and opens a pull request. The token that does this was widened
   from read-only to `contents: write` on `portfolio`; the only thing standing between that
   and a bug pushing straight to the live site is a GitHub ruleset on `main`.
4. **Idempotency and revise** — publishing the same slug twice updates the one existing
   pull request instead of opening a second. Touching something already live, or already
   merged, is refused unless the caller explicitly passes `revise: true`.

**Before you approve this, know what's actually proven.** Slices 1 and 2 are proven
against the real site and a real schema fetch. Slices 3 and 4 — everything that writes to
`portfolio` — have been run only against fakes and one manual test of the
branch-protection rule. **No real pull request has ever been opened by this code.** See
Deferred work.

---

## What changed

### Slice 1 — the schema arrives

| File | Change | Why |
|---|---|---|
| `src/lib/reading-time.ts` | new | Turns a draft's body into the `"{n} min"` string the site's schema requires. Floors at `"1 min"` — the schema demands a non-empty string, so `"0 min"` would validate cleanly and still be nonsense. |
| `src/lib/validate.ts` | new | Interprets the site's JSON Schema documents by hand (ADR-005 rejected a library). Checks every keyword the live schema actually uses and refuses any keyword it doesn't recognize, rather than silently skipping it. Returns every error found, not just the first. |
| `src/lib/site.ts` | modified — `fetchSchema` | Fetches `api/schema.json`, the two-key envelope (`{ writing, project }`), parsed with Zod but deliberately not describing what's inside each key — that would be a second, driftable definition of the rules `lib/validate.ts` already interprets. |
| `src/index.ts` | modified — `schema` health check | `/{secret}/health` now runs three checks in parallel: `site`, `github`, `schema`. |

### Slice 2 — read a published post

| File | Change | Why |
|---|---|---|
| `src/lib/site.ts` | modified — `fetchDocument`, `SiteNotFoundError` | Fetches one published document by kind and slug. |
| `src/services/get-content.ts` | modified — `state` required | `"draft"` keeps the existing GitHub read unchanged. `"published"` reads through `site.fetchDocument` instead — never GitHub, since a `portfolio` file is a hand-written JS object literal and reading it as a draft would return `null` or a plausible-looking wrong value. |
| `src/tools/get-content.ts` | modified — `state` in the input schema | Mirrors `list_content`, which has required `state` since spec 004. No default — a default on one tool but not the other costs a turn every time a model has to guess which behaviour it's getting. |
| `src/tools/save-draft.ts` | modified — description text only | Adds the instruction to ask the human for a slug rather than deriving one from the title. No behaviour changed. |

### Slice 3 — open the PR

| File | Change | Why |
|---|---|---|
| `src/lib/github.ts` | generalised `request`, four new methods (`getBranchHead`, `createBranch`, `createPullRequest`, later `findPullRequest`), `writeFile` narrowed into an overload | `request` used to hardcode `/contents/{path}`; it now takes a path suffix so the new endpoints share the same auth header and status mapping. The `writeFile` overload makes `branch` a **compile error to omit** on a `portfolio` write — the ruleset on `main` is the real guarantee, this is the guard that stops a future caller reaching it by accident. |
| `src/lib/publish.ts` | new | Pure helpers: the published file path (`content/projects/` is **plural**, unlike the domain word), the branch name, the PR title, and the PR body text — specified in `design.md`, not left to the coder to word. |
| `src/services/publish.ts` | new | The service: read the draft, validate, attach `show`/`order` (projects only, after validation — the schema forbids the keys), render, branch, commit, open the PR. Every step returns a refusal rather than throwing. |
| `src/tools/publish.ts` | new | The MCP tool. Turns a refusal into `isError: true`, HTTP still 200. |
| `src/tools/index.ts` | modified — registration | Wires `publish` in alongside the other five tools. |

### Slice 4 — idempotency and revise

| File | Change | Why |
|---|---|---|
| `src/lib/github.ts` | modified — `findPullRequest` | Finds an open, closed, or merged pull request by branch name — never by a number recorded anywhere, because recording it would invalidate the draft's `sha`. |
| `src/services/publish.ts` | modified — the four branch/PR states, `revise` | A leftover branch with no PR proceeds rather than refusing (writes fresh, opens a PR). A branch with an open PR updates it. A merged PR, or an already-published slug, refuses unless `revise: true` is passed. A closed-unmerged PR is reopened as a new one, and the result says so. |
| `src/tools/publish.ts` | modified — `revise` argument, `status`-aware response | The `revise` argument, and a response that distinguishes "opened", "updated" (same PR, no duplicate), and "recreated". |

---

## The three reviews — read this before the rest

Three review passes ran across this feature, one after each of slices 2, 3, and 4. None
was a formality. Each found something that would have shipped a real defect had it gone
unreviewed.

### After slice 2 — a bug that would have blocked every publish, permanently

`design.md` and `CLAUDE.md` both recorded the site's live schema wrongly: "exactly ten
keywords", "no nesting past one array of strings." Both were false — the real schema
carries `$schema` as an eleventh top-level key (Zod's `toJSONSchema` always emits it), and
`stack.items` carries a `minLength` constraint, not just a bare type.

Because `lib/validate.ts` was built to correctly refuse any keyword it doesn't recognize,
it refused **every valid post**, including the live ones. Had `publish` (slice 3) shipped
on top of this unfixed, every publish attempt would have failed forever, blaming the
site's schema for a bug in this repo's reading of it. The review also found the test suite
structurally incapable of catching this — the only happy-path assertions ran against a
four-keyword hand-written fixture, never the real document.

Fixed before slice 3 started: the interpreter now recognizes `$schema` as an annotation
that constrains nothing, checks scalar constraints inside `items`, and the fixtures were
replaced with the real, captured `api/schema.json`. `design.md` and `CLAUDE.md` were
corrected to match the re-checked live facts.

### After slice 3 — a stale header and a message pointing at the wrong URL

`github.ts`'s header comment still said the token was read-only on `portfolio` — the exact
file that now writes to a public repo, telling the next reader the opposite of the truth.
And the message shown when a write failed after the branch was already cut pointed at the
**live site URL**, which is wrong on its face: the post isn't published, so that URL is a
404 that knows nothing about pull requests. Both fixed. The `writeFile` overload (see
above) was also introduced at this point, so a `portfolio` write without a `branch` is now
a compile error, not a convention someone has to remember.

### After slice 4 — three findings, all fixed

1. **Task 18's `status` branching had never actually landed.** A prior edit failed
   silently and the commit message claimed behaviour the code didn't have. A second
   publish reported "Pull request #42 opened" — which was simply false; nothing was
   opened. Fixed: the response now distinguishes created/updated/recreated correctly.
2. **The PR body goes stale on an update.** GitHub does not rewrite a pull request's body
   when its branch gains a commit, and `design.md` names that body as the **only**
   mitigation for a model inventing `show`/`order`. This is mitigated, not fixed: the tool
   now restates the just-written values in its own response and says the body describes
   the first publish only. An actual fix needs `PATCH /pulls/{n}`, which needs its own ADR.
3. **`findPullRequest` read `merged` off only the latest pull request**, which bypassed
   `revise` on exactly the path it exists to guard: merge PR #42, then open and close #57
   on the same branch, and the old code reported "never merged" — silently letting a live
   post be amended without `revise`. Fixed: it now checks whether **any** PR in that
   branch's history was ever merged.

The review also caught that two fakes were answering both the workshop draft read and the
new portfolio branch read with the same draft content, which meant every "first publish"
test actually exercised the overwrite path (a `sha` was always sent) rather than the
create path. Fixed, and a new test (`T-64`) pins that a first publish sends no `sha`.

---

## QA

**What does this let a user do that they couldn't before?**
Publish a draft with one call: `publish({ kind, slug, show?, order? })` opens a real pull
request on the public repo. Read something already live with `get_content({ state:
"published" })`. Revise something live or already-merged by passing `revise: true`.

**What happens when it fails?**
Every failure is a refusal, never a throw reaching the model: `{ ok: false, error: string }`
from the service, turned into `isError: true` (HTTP still 200) by the tool. Specifically:
invalid metadata returns every missing/wrong field at once, not one per turn. An
unreachable site schema refuses rather than guessing at validity. A write that fails after
the branch was already cut names the branch and points at its GitHub URL, and says the
branch and any commit on it survive — nothing is deleted, so a retry finds it rather than
duplicating work. A 404 from GitHub is never reported as "the file doesn't exist" — it
might be the token's scope, and the message says both are possible.

**Does this touch existing behaviour?**
Yes, in one place: `get_content` now requires `state` (carried over from slice 2, still in
effect — see Breaking change below). `save_draft`'s behaviour is unchanged, only its
description text changed. `list_content` and `discard_draft` are untouched.

**Any data migration?**
None. No database in this repo.

**Any auth implication? This is the one that matters most in this feature.**
The GitHub token was widened from read-only to `contents: write` on `portfolio`, the
public repo. That is a real increase in blast radius: a bug here can now write to a
public, customer-facing repository. The mitigation is a GitHub ruleset on `portfolio`'s
`main` that requires every change to go through a pull request, and it was **verified to
refuse this exact token** (M-2, see below) — not merely assumed to exist. On the code
side, `writeFile` is typed so a `portfolio` write cannot omit a branch; it's a compile
error, not a rule someone has to remember. No tool in this repo merges, approves, or
closes a pull request — that action was deliberately left out of scope, permanently.

**What did we deliberately not do?**
No MDX parse (the Vercel preview build is the check, per ADR-005). No new dependency — the
schema interpreter is hand-written, same as before. No caching, retry, or rate limiter
(~15 calls/week against a much higher GitHub limit). No merge capability, ever. See
Deferred work for what was surfaced but explicitly not built.

---

## M-2 — the one manual check that has run, and why it's the load-bearing one

**M-2 passed, 2026-08-03.** A direct push of an empty commit to `Portfolio-new`'s `main`,
using the server's actual token (not the repo owner's own git credentials — an admin is
usually on the ruleset's bypass list, so testing as the admin would have proven nothing
about the token the server runs as):

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
```

This was the prerequisite for all of slice 3 — the feature does not start writing to a
public repo on the assumption a safety net exists; it checks first that the net catches
the exact thing that could fall into it.

One thing to flag: **the token used for this check was exposed in the session
transcript** during the test. `implementation.md`'s session notes say it was rotated
immediately afterward. That's a self-report inside this repo's own record, not something
this summary independently confirmed — worth a second look before this ships, given it's
a credential to a public write-capable token.

---

## Breaking change

**`get_content` now requires `state`.** Any existing caller — a saved prompt, a Claude
Project instruction, a script — that calls it with only `kind` and `slug` is rejected by
the input schema before the service runs. Deliberate: it mirrors `list_content`, which has
required `state` since spec 004. There's no migration path other than updating the caller
to pass `state: "draft"` (the old behaviour) or `state: "published"` (the new one).

---

## Verify it yourself

Under five minutes, run against the working tree as it stands (all 18 tasks committed,
nothing staged or pending).

```bash
git checkout feat/publish
bun install
bun test
```

1. Full suite → `171 pass, 0 fail`. I confirmed the baseline independently: checked out
   `8310d5f` (the commit immediately before this feature starts) into a separate
   worktree, ran `bun install` there, and got `90 pass, 0 fail`. The 81-test increase is
   real.
2. `bunx tsc --noEmit` → clean, no output. This is what proves the `Github`/`Site` type
   widening across all four slices didn't leave a fake half-updated anywhere.
3. `bunx biome check .` → clean, no fixes needed.
4. `bun run docs:check` → "Docs are in sync."
5. Open `src/services/publish.ts` and find the `writeFile` call inside the try block →
   confirm `branch` is always passed and never optional for a `portfolio` write. Then open
   `src/lib/github.ts`'s `writeFile` signature and confirm the type makes that a compile
   error to get wrong, not a convention.
6. **Failure case worth trying by hand:** call `get_content` with just `{ kind: "writing",
   slug: "anything" }`, no `state` → confirm the MCP layer rejects it before the service
   runs. That's the breaking change from slice 2, still in effect.

I ran all of the above while preparing this summary. All pass as described.

**What this can't verify:** none of these five checks touch the real GitHub API or the
real site. See Deferred work — that's the gap that actually matters before this goes live.

---

## Test revisions

Roughly ten, all recorded with justification in `implementation.md` → Test revisions. No
assertion was ever weakened to reach green, and the count never dropped — it only grew,
90 → 171. Grouped:

- **Throwing stubs added to `Github`/`Site` fakes, several times over**, each time the
  interpreter for either type widened (new methods on `Github`: `getBranchHead`,
  `createBranch`, `createPullRequest`, later `findPullRequest`; new methods on `Site`:
  `fetchSchema`, `fetchDocument`). Every stub throws rather than returning a plausible
  value, so an accidental call into the publish path fails loudly instead of passing
  quietly. Purely additive — no assertion, name, or fixture value touched.
- **A fixture's stated justification expired when a later task made its path live.**
  Twice: once when `/health` started calling `fetchSchema()` on every request (a shared
  fake's throwing stub broke three unrelated tests), and once when `publish` started
  calling `findPullRequest()` on every run (the same throwing-stub pattern, same fix —
  make the default answer the true one, `null`, and keep a configurable override for the
  tests that need something else).
- **Mechanical migrations when an argument became required.** `state` becoming required
  on `getContent`/`get_content` meant six existing calls plus one MCP-level call needed
  `state: "draft"` added, so they kept testing exactly what they tested before.
- **Two genuine judgement calls, not mechanical:**
  - **T-41 retired, superseded by slice 4.** The old T-41 asserted "an existing branch
    refuses cleanly" — true only until slice 4 shipped, and `design.md`'s own wording
    scoped it that way ("until slice 4 ships, a second publish is a clean refusal"). Slice
    4's whole purpose is to replace that refusal with an update-in-place. Retired with a
    citation to the `design.md` line that had already named its own expiry, and replaced
    with a test pinning what still has to hold: no crash, no silent overwrite, a fresh PR
    if none exists.
  - **T-43's existing-branch assertion corrected after the coder escalated, not edited by
    it.** The coder hit a test asserting `createBranch` is called zero times on a branch
    that (by definition of the scenario) already exists, found that impossible to satisfy
    without a speculative pre-check nothing in the spec asked for, stopped, and reported it
    rather than changing the test itself. The test agent then corrected the assertion.

---

## Deferred work

This is the section that matters most before approving a PR that writes to a public repo.

- ~~**M-1 has never run.**~~ **M-1 passed, 2026-08-03**, against the real `Portfolio-new`
  through the MCP handler. Pull request #1 opened; the file landed at
  `content/projects/m1-scratch.mdx` (**plural**) while the branch stayed
  `publish/project/m1-scratch` (**singular**); the PR body came out byte-identical to the
  specified template; `main` was never touched. The first attempt failed **403** — the
  token had `Contents: write` but not `Pull requests: write`, which are separate
  permissions. See [ADR-006](../../docs/adr/006-the-token-needs-two-permissions.md). That
  failure also exercised the half-written recovery path (T-62/T-63) on its first real
  outing, and the retry exercised branch-exists-no-PR.
- ~~**M-3 has never run.**~~ **M-3 passed, 2026-08-03.** The draft was edited through
  `get_content` → `save_draft` with its sha and published again. The result said
  **"updated"**, returned the **same** PR #1, and GitHub showed exactly one pull request
  with three commits on it. PR closed unmerged, branch deleted, draft discarded.
- **`delete_branch_on_merge` on `portfolio` is OFF** — confirmed by the owner on
  2026-08-03 — **and one test (T-47) assumes it's on.** That is not GitHub's default. Since
  it is off: merge a PR, then `revise` the same slug, and the
  code hits `createBranch` throwing `AlreadyExists` and updates the stale branch in place
  instead of cutting a fresh one from current `main`. Not destructive — a human still
  merges — but the diff in that PR would be based on a stale `main`, not today's. Recorded
  in `design.md` → Known-unverified facts. Check the setting on the real repo before
  relying on `revise` after a merge.
- **The PR body goes stale on an `updated` publish**, described above under the slice 4
  review. Mitigated by the tool restating values in its response; not fixed. A real fix
  needs `PATCH /pulls/{n}`, which is a new GitHub call and needs its own ADR before it's
  built.
- **`format: "date"` is still a deliberate no-op.** It's accepted as satisfied because the
  live schema pairs it with a stronger `pattern` that does the real checking. If the site
  ever drops that `pattern` and keeps only `format: "date"`, dates stop being validated
  and nothing in this repo would notice.
- **The token used during M-2 was exposed in a session transcript.** Recorded as rotated
  immediately in `implementation.md`'s own notes — that's a self-report, not something
  this summary independently confirmed. Worth checking before this ships.
- **Out of scope throughout, per `design.md`, and not touched anywhere in this feature:**
  the social post archive, an MDX parse, lazy reconciliation (archiving a draft when its
  PR merges), merging anything, and renaming or deleting a published post.

---

## Rollback

No data migration, nothing written anywhere by these changes themselves — the risk is
entirely in what the deployed tool can do going forward, not in what shipping the code
does. Each slice was raised as its own PR and none depends on a later one for its own
tests to pass, so any slice can be reverted independently. Reverting slice 3 or 4 removes
the `publish` tool's write capability entirely; reverting slice 2 alone reintroduces the
old `get_content` behaviour and removes the breaking change.
