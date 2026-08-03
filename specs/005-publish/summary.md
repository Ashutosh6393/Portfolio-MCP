# Publish — Summary

Written for a **human**, at the point a PR slice is complete — before the PR is raised and
before any automated review has run. It must stand on its own.

Read this, then the diff, then approve the PR.

- **Slice:** 1 of 4 · **Branch:** `feat/publish`
- **Spec:** `specs/005-publish/design.md` · **ADR:** `docs/adr/005-publish-opens-a-pull-request.md`
- **Tasks:** 1–5 · **Tests:** 19 added (T-01 … T-19), all passing
- **Size:** 4 files, 316 insertions / 2 deletions (limit: 5–7 files excl. tests, 500 lines)

---

## TL;DR

`publish` — the sixth and last tool — does not exist yet. This slice builds the two
pieces underneath it that have no caller yet: a schema checker that reads the site's
live publishing rules and reports every problem with a draft's metadata at once, and a
reading-time estimate computed from a post's body. `/{secret}/health` gains a third
check so the server notices, on its own, if the site's schema ever becomes unreachable
or changes shape. Nothing a user can trigger changes yet — no tool is new or different.

---

## What changed

| File | Change | Why |
|---|---|---|
| `src/lib/reading-time.ts` | new | Turns a draft's body into the `"{n} min"` string the site's schema will require. Floors at `"1 min"` — the schema demands a non-empty string, so `"0 min"` would validate cleanly and still be nonsense. |
| `src/lib/validate.ts` | new | Interprets the site's JSON Schema documents by hand (ADR-005 decision 1 rejected a library — ten keywords in use, no `$ref`, no composition). Checks `type`, `properties`, `required`, `additionalProperties`, `minLength`, `enum`, `pattern`, `format`, `minItems`, `items`. Returns every error found, not just the first. |
| `src/lib/site.ts` | modified — `fetchSchema` | Fetches `api/schema.json` and parses the two-key envelope (`{ writing, project }`) with Zod. Deliberately does **not** describe what's inside each key — that would be a second, driftable definition of the rules `lib/validate.ts` already interprets. |
| `src/index.ts` | modified — `schema` health check | `/{secret}/health` now runs three checks in parallel: `site`, `github`, `schema`. `schema` is its own entry rather than folded into `site`, because it can fail for a different reason (the route's shape changed) than the site being down, and wants a different fix. |

### How it works now

Nothing user-facing changed. This slice is invisible outside `/{secret}/health`.

The path that exists today: a request hits `GET /{secret}/health`. The route fires
`site.fetchContent`, two `github.listDirectory` calls, and — new in this slice —
`site.fetchSchema`, all in parallel. `fetchSchema` calls `api/schema.json` on the live
site and parses the response as `{ writing: {...}, project: {...} }`; if the fetch or
the shape fails, that promise rejects and `checks.schema` becomes `"unreachable"`. Any
one check failing turns the response into a 503; all three passing is a 200.

The path that does **not** exist yet: nothing calls `lib/validate.ts` or
`lib/reading-time.ts`. Both are built and tested standing alone, ready for the
`publish` service in slice 3 to call `validate(schema[kind], metadata)` and
`readingTime(body)`.

---

## QA

Questions a reviewer would actually ask, answered before they have to ask them.

**What does this let a user do that they couldn't before?**
Nothing directly. It lets the *server* notice, at `/health`, if the site's schema
becomes unreachable or changes shape — useful for debugging slice 3 later, not useful
to a phone conversation today.

**What happens when it fails?**
`fetchSchema` throws on a non-2xx response or on a body that doesn't have both a
`writing` and a `project` key (Zod rejects it). The health route catches that and
reports `checks.schema: "unreachable"` with an overall 503 — the same pattern the
existing `site` and `github` checks already use, so there's no new failure shape at
that route. `validate()` never throws; a schema keyword it doesn't recognise becomes an
error string in the returned array, not an exception. `readingTime()` cannot fail — it
has no branch that isn't arithmetic.

**Does this touch existing behaviour?**
`/{secret}/health` now does one more parallel fetch per request and can now 503 for a
reason it couldn't before (schema unreachable) even when `site` and `github` are both
fine. T-19 pins that this is possible and that it doesn't false-positive the other two
checks. No tool changed. No existing service changed except the `Site` type widening
(next answer).

**Any data migration?**
None. No database in this repo.

**Any performance implications?**
One new outbound fetch per `/health` call, run in parallel with the two that already
exist, so it doesn't add wall time. `CLAUDE.md` puts real traffic here around
15 calls/week — no cache or rate limiter was added, matching the project's stated
position that one isn't warranted at that volume.

**Any security or auth implications?**
None. No new route, no new auth path. The health route stays behind the existing secret
path prefix.

**What did we deliberately not do?**
No tool was touched — `publish` doesn't exist yet, `get_content` and `save_draft` are
untouched, matching this slice's acceptance criteria ("No tool changes"). See Deferred
work.

---

## Verify it yourself

Steps to check this by hand, in under five minutes.

```bash
git checkout feat/publish
bun install
bun test src/lib/validate.test.ts src/lib/reading-time.test.ts src/lib/site.test.ts src/index.test.ts
```

1. Run `bun test` (full suite) → expect `109 pass, 0 fail`.
2. Open `src/lib/validate.test.ts`, find `T-11` ("An unknown keyword refuses, never
   silently passes") → confirm the assertion checks for a non-empty error array, not
   `[]`. This is the single test the design calls out as highest-value.
3. Failure case: run `bunx tsc --noEmit` → expect clean, no output. This is what
   proves the `Site` type widening (`fetchSchema` added) didn't leave a fake somewhere
   half-updated, rather than a crash at runtime.

I ran all three of these while preparing this summary: 109/109 pass, `tsc --noEmit`
clean, `biome check` clean, `bun run docs:check` reports docs in sync.

---

## Test coverage

| Test | Verifies | File |
|---|---|---|
| T-01 … T-04, T-11, T-12 | Structure keywords (`type`, `properties`, `required`, `additionalProperties`), unknown-keyword refusal, optional-field-absent | `src/lib/validate.test.ts` |
| T-05 … T-10 | Constraint keywords (`minLength`, `enum`, `pattern`, `format: uri`, `minItems`, `items`) | `src/lib/validate.test.ts` |
| T-13 … T-15 | `readingTime` arithmetic and the `"1 min"` floor on an empty body | `src/lib/reading-time.test.ts` |
| T-16, T-17 | The schema envelope parses; a malformed response names the missing keys | `src/lib/site.test.ts` |
| T-18, T-19 | `/health` reports `schema: ok`; `/health` 503s with `checks.schema: "unreachable"` when the schema fetch fails, while `site`/`github` stay `ok` | `src/index.test.ts` |

**Covered:** every one of the ten schema keywords the live site actually uses, both
directions of the unknown-keyword rule (a document-level keyword and a property-level
keyword), the reading-time floor, and both branches of the new health check.

**Not covered — and this matters for reading the acceptance criteria honestly:**
T-18 and T-19 run `/health` against a **fake** `Site`, not the live
`ashutoshverma.dev/api/schema.json`. Nobody in this session hit the deployed server or
the real site to confirm `schema: ok` actually comes back against the true live schema.
The interpreter itself (T-01 … T-12) was written against the live schema's shape as
recorded in `CLAUDE.md` → *Facts already established*, but the health route's live
behaviour is unverified. If that matters before approving, it's a `curl` against the
real deployment — not a code change.

### Test revisions in this slice

Two, both already recorded in `implementation.md` → Test revisions. Flagging them here
rather than burying them, since anything other than "none" deserves a closer look.

1. **Widening `Site` broke 11 existing fakes.** Task 4 added `fetchSchema` to the
   `Site` type. Every hand-written `Site` fake across `src/index.test.ts`,
   `src/services/list-content.test.ts`, `src/services/save-draft.test.ts`, and
   `src/tools/index.test.ts` stopped typechecking (`TS2741`, missing property). The fix
   was additive: a `fetchSchema` stub added to each, and every stub **throws** rather
   than resolving a plausible value, so a test that accidentally exercises the publish
   path fails loudly instead of quietly passing. No assertion, test name, or fixture
   value was touched; the count only grew. Worth flagging: `implementation.md` (Task
   11's note) expected this kind of stub to land as its own commit *ahead of* the code
   that needs it — that wasn't possible here, because a stub referencing `fetchSchema`
   doesn't typecheck until `Site` carries the method, and `Site` carrying the method
   breaks the fakes that don't have it yet. Both sides had to land together, in
   `30008b5`.
2. **The shared `fakeSite` in `src/index.test.ts` had to change its default from
   throwing to resolving.** It was given a throwing `fetchSchema` in revision 1, on the
   reasoning that "nothing in this file reaches the publish path." Task 5 made
   `/health` call `fetchSchema()` on *every* request, which broke that reasoning: three
   pre-existing, unrelated tests (T-05, T-16, and 002-T-04, which assert on
   `checks.site` / `checks.github`) started getting an incidental 503 from the shared
   fake instead of the 200 they were testing for. The fix: the shared default now
   resolves `{ writing: {}, project: {} }` (a healthy site), and T-19 was given its own
   inline `Site` whose `fetchSchema` throws, so the 503-on-bad-schema behaviour is still
   proven — just no longer riding on the shared fake's failure. I diffed both revisions
   against the actual commits; they match this description exactly, and no assertion
   was weakened in either. Test count did not drop.

---

## Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| `format: "date"` is a deliberate no-op — accepted as satisfied whenever a schema uses it, because the live schema pairs `writing.date` with a stronger `pattern` that does the real checking. If the site ever drops that `pattern` and keeps only the `format`, dates stop being validated and nothing detects it. | low | Already an accepted, documented risk (`design.md` → Risks). Not fixable from this slice — would need a change to `checkFormat` in `src/lib/validate.ts` the day the site's schema actually changes shape. |
| The health route's behaviour against the real site is unverified this session (see Test coverage → Not covered) | low | Run `curl https://<host>/{secret}/health` after deploy and confirm `checks.schema` is present and `"ok"`. |

**Rollback:** Revert the five commits (`98eb726`, `da25fc0`, `8b9b286`, `30008b5`,
`2215d76`). No migration, no data written anywhere — this slice touches no state
outside the running process.

---

## Deferred work

Ideas surfaced during the build that were deliberately not done. This replaces a separate
future-work file — everything deferred lives here.

Nothing new was discovered mid-build and skipped. One item, already recorded in
`design.md` → Risks, is repeated here so it isn't lost between slices:

| Item | Why deferred | Worth doing? |
|---|---|---|
| Detecting when the site's schema drops the `pattern` next to `format: "date"` (which would silently stop dates being validated) | Out of this slice's scope, and there's no live signal to detect it with — it would need a human reading a future schema diff, or a monitor comparing schema versions over time | maybe — only if the site's schema is ever actually changed this way |

Anything marked **yes** that is non-trivial needs its own ADR before it becomes a spec.

---

## Documentation updated

Docs are live — updated in the same commit as the change that made them stale.

- [x] `specs/005-publish/design.md` — Status flipped `draft` → `approved` (Ashutosh
      Verma, 2026-08-03), at the start of this session, since implementation was gated
      on approval.
- [x] `specs/005-publish/implementation.md` — task states, commits, session notes, and
      the two test revisions above, each updated as its task landed, per this
      project's convention.
