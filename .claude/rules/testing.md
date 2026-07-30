---
name: testing
load_when: Writing or changing any test, or running the TDD loop.
---

# Testing

Runner: `bun:test`. Tests colocated as `*.test.ts` beside the code under test.

---

## The loop

Every task, in this order:

```
1. RED    — write the failing test first
2. verify — it fails for the RIGHT reason
3. GREEN  — write the minimal code to pass
4. re-run — confirm pass, then full suite
5. commit
```

**Step 2 matters more than it looks.** A test failing on a missing import is not a red
test, it's a broken one. Confirm the failure message is the one you expect before writing
any implementation.

If a new test passes immediately, something is wrong — the behaviour already exists, or
the test asserts nothing. Investigate. A free pass is not progress.

---

## Attempt budget

Retries are capped by **progress**, not just count.

| Condition | Action |
|---|---|
| Same failure signature twice in a row | **Stop immediately.** Don't spend the rest of the budget. |
| 3 code attempts on one task | **Stop.** Task too large, or the test is wrong. |
| Environmental failure (missing dep, bad import, config, flake) | Fix it. Does **not** consume an attempt. |

Budget is **per task** and resets each task. It never carries over.

An identical error twice means the problem isn't understood. Each further attempt
contorts the implementation to satisfy an assertion nobody has understood yet.

### On exhaustion

Stop and escalate. The question is **not** "how do I make this pass?" It is:

> **Is the test correct?** Does this assertion encode what the spec actually says, or a
> misunderstanding of it?

Report: the failing test, the exact error from each attempt, what was tried, your
hypotheses. Then stop — don't start the next task, because tasks are dependency-ordered
and you'd be building on something known to be broken.

---

## Test ownership

**The agent writing implementation code must never create, edit, delete, skip, or weaken
a test file.**

Not to fix a failure. Not on the last attempt. Not "temporarily".

This is the escape hatch every coding agent eventually finds: on attempt three, with
pressure to go green, weakening the assertion is the shortest path — and it produces a
passing suite that proves nothing.

If you believe a test is wrong, **stop and escalate**. Tests change only through a
deliberate revision with a written justification, landing as its own visible commit.

---

## What to test

Tests describe **business behaviour**, not implementation. Test names explain:

- expected behaviour
- edge cases
- regressions

```ts
// Good
test("rejects a booking when the slot is already taken")
test("returns 401 when the session has expired")

// Bad
test("calls createBooking")
test("works")
```

Cover the error paths and edge cases, not just the happy path:

- empty, null, and boundary inputs
- concurrent access, duplicate submission
- third-party or DB failure — what does the user see?
- authorization: what happens for the wrong user?

## Layer boundaries

- **Services** — tested with `lib` passed in as a fake object literal. No network.
- **`lib`** — the GitHub client and site fetcher are thin wrappers over someone else's
  API. Don't unit-test them against a mock of that API; that tests the mock.
- **Tools** — tested through the MCP handler, not by calling the tool function directly.

There is no repository layer and no database in this repo. See
[code-style.md](code-style.md) for the chain.

Mock the boundary, not the internals. A test that mocks the thing it's testing tests
nothing.
