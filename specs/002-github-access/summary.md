# GitHub Access — Summary

Written for a **human**, at the point a PR slice is complete — before the PR is raised and
before any automated review has run. It must stand on its own.

Read this, then the diff, then approve the PR.

- **Slice:** 1 of 2 · **Branch:** `feat/github-access`
- **Spec:** `design.md` · **ADRs:** `docs/adr/002-github-access-and-workshop.md`,
  `docs/adr/003-skills-and-templates-are-separate.md`
- **Tasks:** 1–3 · **Tests:** 7 added (26 → 33), all passing
- **Size:** 4 files, 130 lines (limit: 5–7 files excl. tests, 500 lines)

---

## TL;DR

The server can reach GitHub. A read-only token is validated at boot, and the deep health
check now reads both repos and says whether that worked.

No tool uses it yet — that is Slice 2. This slice exists so the credential is proved
before anything is built on top of it, which is exactly what happened: it caught an empty
`workshop` that would otherwise have surfaced as a mysterious "skill not found" later.

---

## What changed

| File | Change | Why |
|---|---|---|
| `.env.example` | modified | `GITHUB_TOKEN` by name, and how to create one. No value |
| `src/lib/env.ts` | modified | The token is validated at boot, prefix included |
| `src/lib/github.ts` | **new** | The GitHub reader: two methods, one error class |
| `src/index.ts` | modified | The `github` deep check, and the reader built at boot |

### How it works now

**Boot.** `parseEnv` rejects a missing or wrong-shaped `GITHUB_TOKEN` before the server
starts listening. `createGithub(token)` is called once and passed into `createApp`
alongside `site`, so the token never reaches module scope and a test builds a fake without
one.

**Health.** `GET /{secret}/health` runs three outbound calls in parallel — the site, plus
both repo roots — and reports `site` and `github`. `github` is `ok` only when **both**
repos answer. 200 on all-pass, 503 on any fail, unchanged from how `site` already behaved.

**Reading.** `listDirectory` returns `unknown`, so the parse belongs to the service that
will arrive in Slice 2. `readFile` asks for `Accept: application/vnd.github.raw` and gets
the file's bytes as text — no base64, no 1 MB cliff, no decoder in this repo.

---

## QA

**What does this let a user do that they couldn't before?**
Nothing directly — no tool reads GitHub yet. What it gives *you* is one URL that answers
"can this server reach my repos", which is the question every later slice depends on.

**What happens when it fails?**
A wrong-shaped token fails at boot with a message naming the variable. A repo that cannot
be read makes `checks.github` `unreachable` and the route returns 503. `lib/github.ts`
throws `GithubNotFoundError` on a 404 and a plain `Error` carrying the status otherwise —
the service in Slice 2 branches on the class, never on message text.

Nothing logs the token, the `Authorization` header, or a request URL.

**Does this touch existing behaviour?**
`list_content` is untouched. `checks.site` behaves exactly as before — verified by pointing
GitHub at a repo that does not exist and watching `site` stay `ok` while `github` failed.
The deep-health route gained about a second of wall time; no tool path did.

**Any data migration?**
None. No database in this repo.

**Any performance implications?**
The deep check went from one outbound call to three, run in parallel — 1.27s cold on the
deployed server, ~0.8s warm. Only `/{secret}/health` touches it.

**Any security or auth implications?**
One new secret, set by hand straight into Fly's store — never through an agent or a file.
**Read-only**: no branches, no commits, no PRs, no writes of any kind. Auth is unchanged:
one path secret, one user.

**What did we deliberately not do?**
No `octokit` — ADR-002 argued it out, and it stays uninstalled until `publish`. No base64
decoder, because the raw `Accept` header removed the need. No cache, retry, or rate
limiter. Nothing that watches the token's expiry.

---

## Verify it yourself

```bash
git checkout feat/github-access
bun install
bun test
```

1. `bun test` → 33 pass, 0 fail
2. `bun run typecheck && bun run lint && bun run docs:check` → all clean
3. `GET /{secret}/health` → 200 with `{"checks":{"site":"ok","github":"ok"}}`
4. Failure case: point `repoNames.workshop` at a name that does not exist, hit the same
   route → **503**, `github` is `unreachable`, and `site` is still `ok`. Put it back

---

## Test coverage

| Test | Verifies | File |
|---|---|---|
| 002-T-01 | Boot fails naming `GITHUB_TOKEN` when it is missing | `src/lib/env.test.ts` |
| 002-T-02 | A classic `ghp_` token and an empty string are both refused | `src/lib/env.test.ts` |
| 002-T-03 | A well-formed token lands on the parsed object | `src/lib/env.test.ts` |
| 002-T-04 | Both repos reachable → 200, `github` and `site` both `ok` | `src/index.test.ts` |
| 002-T-05 | GitHub down → 503, `github` fails, `site` untouched | `src/index.test.ts` |
| 002-T-06 | One repo reachable is not enough → still 503 | `src/index.test.ts` |

**Covered:** the boot guard, both health outcomes, and the independence of the two checks.

**Not covered:** `lib/github.ts`'s `fetch` is not unit-tested against a mock of GitHub —
[testing.md](../../.claude/rules/testing.md) forbids it, because testing a thin wrapper
against a mock of the API tests the mock. It was exercised against the **live** API
instead: the raw `Accept` header, the listing shape, both repos, and both health paths.

### Test revisions in this slice

**Two. Both input-only; not one assertion changed.** Both landed as their own commits ahead
of the code, and both are justified in `implementation.md` → Test revisions.

| What | Why |
|---|---|
| Spec 001's two T-03 cases | Their environment lacked `GITHUB_TOKEN` once it became required |
| `testEnv` and the eight `createApp` calls in `index.test.ts` | `Env` and `deps` each grew a required field |

Both are the same event: a required dependency was added and the fakes had to carry it.
That is the design working — forgetting to inject is now a compile error rather than a live
call to api.github.com from a test run.

---

## Risks and things to watch

| Risk | Likelihood | What to watch |
|---|---|---|
| The token expires silently, within a year | certain, eventually | `checks.github` flips to `unreachable`. **Nothing announces it** — ADR-002 gave that up knowingly |
| A bad or mis-scoped token is indistinguishable from a missing file | low now, high after any token change | GitHub answers 404, not 403, for a repo it cannot see. The boot-time prefix check catches the common versions early |
| A repo with no commits answers 404 like a missing one | already hit once | Cost about an hour this build. A commitless `workshop` reported `unreachable` on a perfectly good token |

**Rollback:** revert the commits. No migration, no state, nothing to undo outside this repo.

---

## Deferred work

| Item | Why deferred | Worth doing? |
|---|---|---|
| Health check distinguishing "empty repo" from "unreachable" | A state that ends with the first commit; special-casing it is complexity for a transient | no |
| Something that warns before the token expires | ADR-002 rejected the App that would have solved it | maybe — needs its own ADR |

---

## Documentation updated

- [x] `docs/adr/003-skills-and-templates-are-separate.md` — new; supersedes ADR-002's skill
      storage and tool contract, after the real `workshop` content turned out not to pair up
- [x] `docs/adr/002-github-access-and-workshop.md` — status marked superseded in part; body
      left intact, per the append-only rule
- [x] `docs/adr/README.md` — index
- [x] `CONTEXT.md` — `skill` no longer claims to include a template; `template` and `voice`
      added
- [x] `specs/002-github-access/design.md` — Risk 3 closed, Risk 7 added, P-1 corrected, and
      the layout replaced by ADR-003
- [x] `specs/002-github-access/CLAUDE.md` — live facts, and the patterns Slice 2 needs
- [x] `specs/002-github-access/implementation.md` — task states, revisions, session notes
