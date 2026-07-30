# {Feature Name} — Summary

Written for a **human**, at the point a PR slice is complete — before the PR is raised and
before any automated review has run. It must stand on its own.

Read this, then the diff, then approve the PR.

- **Slice:** {n} of {total} · **Branch:** `feat/{feature-name}`
- **Spec:** `design.md` · **ADR:** `docs/adr/{NNN}-{feature-name}.md`
- **Tasks:** {#}–{#} · **Tests:** {n} added, all passing
- **Size:** {n} files, {n} lines (limit: 5–7 files excl. tests, 500 lines)

---

## TL;DR

{Two or three sentences. What now works that did not before. Plain language — no
implementation detail, no jargon a non-author would have to decode.}

---

## What changed

| File | Change | Why |
|---|---|---|
| `{path}` | {new / modified} | {reason in one line} |

### How it works now

{A short walkthrough of the path through the code — request in, response out, or user
action to result. Enough that the reviewer can read the diff in order rather than
jumping around.}

---

## QA

Questions a reviewer would actually ask, answered before they have to ask them.

**What does this let a user do that they couldn't before?**
{answer}

**What happens when it fails?**
{Error handling — what the user sees, what gets logged, what gets retried.}

**Does this touch existing behaviour?**
{What else could break. "Nothing" is a valid answer if it is true — say why.}

**Any data migration?**
{Migration, whether it is reversible, whether it needs a backfill, whether it locks.}

**Any performance implications?**
{New queries, N+1 risk, indexes added, cache keys and their TTLs.}

**Any security or auth implications?**
{Who can call this, what is validated, what is exposed that was not before.}

**What did we deliberately not do?**
{Scope held back on purpose — points at Deferred work below.}

---

## Verify it yourself

Steps to check this by hand, in under five minutes.

```bash
git checkout feat/{feature-name}
bun install
bun test {scope}
```

1. {Action} → expect {result}
2. {Action} → expect {result}
3. {Failure case: action} → expect {graceful result, not a crash}

---

## Test coverage

| Test | Verifies | File |
|---|---|---|
| T-01 | {behaviour} | `{path}` |

**Covered:** {the important paths, including error and edge cases}

**Not covered:** {gaps, and why they are acceptable — or a link to the deferred item}

### Test revisions in this slice

{Any test changed after being written, with the justification. **"None"** if none — and
"none" is the expected answer. Anything here deserves a closer look at the diff, because
a modified test on a task that was failing is how a suite goes falsely green.}

---

## Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| {what could go wrong in production} | low/med/high | {the metric, log line, or symptom} |

**Rollback:** {How to undo this. Revert the commits, or is there a migration that
complicates it?}

---

## Deferred work

Ideas surfaced during the build that were deliberately not done. This replaces a separate
future-work file — everything deferred lives here.

| Item | Why deferred | Worth doing? |
|---|---|---|
| {idea} | {out of scope / needs its own ADR / not worth it yet} | yes / maybe / no |

Anything marked **yes** that is non-trivial needs its own ADR before it becomes a spec.

---

## Documentation updated

Docs are live — updated in the same commit as the change that made them stale.

- [ ] `{path}` — {what changed}
- [ ] No documentation affected by this slice
