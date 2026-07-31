# GitHub Access — Design

The plan. Source of truth for **what** gets built. Nothing gets implemented that is not
described here.

> **This is not an ADR.** The decision and its rationale live in
> [`docs/adr/002-github-access-and-workshop.md`](../../docs/adr/002-github-access-and-workshop.md).
> This document assumes that decision is made and describes how it lands in the codebase.

- **Source ADR:** `docs/adr/002-github-access-and-workshop.md`
- **Status:** approved
- **Approved by:** Ashutosh Verma on 2026-07-31

> Implementation does not start until Status is `approved`.

---

## What we're building

The server gains a second external system. A fine-grained personal access token, read
through Bun's `fetch`, lets it reach two GitHub repos. `GET /{secret}/health` reports
`github` alongside `site` and returns 503 when GitHub cannot be reached. One new tool,
`get_skill`, reads the voice-and-structure instructions and the template for a named skill
out of `workshop`, and lists the available skills when called with no name.

After this ships, a model on a phone can ask "what skills do I have" and then "load the
linkedin-post skill" and get back real text from a private repo. Nothing is written to
GitHub — the token is read-only.

## Why now

[ADR-001](../../docs/adr/001-server-runtime-and-shape.md) moved every GitHub dependency
out of Slice 1 so the mobile-connector experiment was not blocked on setup it did not
need. That experiment succeeded and spec 001 is closed. ADR-002 is the deferral coming
due: it picks the credential, the client, and the `workshop` layout, and scopes this slice
down to the credential plus `get_skill`.

---

## Scope

### In scope

- `GITHUB_TOKEN` — one new environment variable, validated at boot
- `src/lib/github.ts` — the GitHub reader: two methods, `fetch`, no new dependency
- The `github` deep-health check, covering **both** repos
- `get_skill({ name? })` — service, tool, registration, and its specified description
- The `skills/{name}/` read path: `instructions.md` and `template.mdx`

### Out of scope

Carried from ADR-002 → Out of scope, so nobody picks them up mid-build:

- **Draft reads** — `list_content`'s `state` argument, `kind: "post"`, and `get_content`.
  There are no drafts until Slice 3 writes one. `list_content` keeps its
  `writing | project` enum and gains nothing.
- **`save_draft`, `discard_draft`, `publish`** — build slices 3 and 4, unchanged.
- **`schema.json` fetching, MDX parsing, `fromJsonSchema`** — nothing is validated against
  the site's schema until `publish`. The `schema.json` health check arrives with it.
- **Lazy reconciliation and response nudges** — Slice 5. In particular, **do not** append
  the "call `get_skill` first" nudge to `list_content`'s response. That is a Slice 5
  behaviour with its own design.
- **Any write to GitHub.** The token is read-only. Write permission arrives with the tool
  that needs it.
- **Installing `octokit`.** It stays on the approved menu and uninstalled. Re-decided at
  `publish`, not here.
- **The GitHub App.** Rejected in ADR-002 with reasons. Re-proposing it needs a new ADR.
- **Caching, retry, rate-limit handling.** See Risks 5.

Anything discovered mid-build that is not in the in-scope list goes to **Deferred work**
in `summary.md`. It does not get built.

---

## Prerequisites

Neither can be proved by a test inside this repo, and the loop cannot finish without both.

| # | Prerequisite | Owner | State |
|---|---|---|---|
| P-1 | Private `workshop` repo exists, holding `skills/linkedin-post/` and `skills/writing/`, each with `instructions.md` and `template.mdx` | Ashutosh | **done** — 2026-07-31 |
| P-2 | Fine-grained PAT issued, scoped to `Portfolio-new` and `workshop`, **Contents: read-only**, set on Fly with `fly secrets set` | Ashutosh | **done** — 2026-07-31, scope confirmed |

**P-2 never passes through an agent or a file.** Set by hand, straight into Fly's secret
store. See [security.md](../../.claude/rules/security.md).

---

## Approach

### Request flow

```
Elysia
  ├── GET  /health            → 200, no I/O. Unchanged.
  └── /{secret}
        ├── GET  /health       → deep check: site AND github, in parallel
        └── ALL  /mcp          → mounted MCP handler
                                     │
                                     ▼
                            tools/   list-content.ts, get-skill.ts
                                     │
                                     ▼
                            services/  getSkill(deps, args)
                                     │
                                     ▼
                            lib/github.ts  (fetch; the schema lives here)
```

Same chain as spec 001: `tools → services → lib`. `github.ts` sits beside `site.ts` and is
reached the same way.

### The reader takes its token at construction

`site` is a module singleton because it needs no configuration. `github` needs the token,
so it is a **factory**:

```ts
export function createGithub(token: string): Github { ... }
```

`index.ts` calls it once at boot with `env.GITHUB_TOKEN` and passes the result into
`createApp(env, { site, github })`. The token never reaches module scope, and a test
constructs a fake without one.

`createApp`'s `deps` is already required and undefaulted — spec 001 fought for that
precisely so a test cannot forget to inject and quietly hit the network. Adding `github`
to it means **forgetting to inject GitHub is a compile error**, not a live API call from a
test run. No test is needed for that; the type is the test.

### Two methods, not one

```ts
export type Repo = "portfolio" | "workshop";

export type Github = {
  listDirectory(repo: Repo, path: string): Promise<unknown>;
  readFile(repo: Repo, path: string): Promise<string>;
};
```

Both hit the same endpoint — `GET /repos/{owner}/{repo}/contents/{path}` — and differ only
in the `Accept` header:

| Method | `Accept` | Returns | Why |
|---|---|---|---|
| `listDirectory` | `application/vnd.github+json` | JSON array of entries | Directory listings have no raw form |
| `readFile` | `application/vnd.github.raw` | The file's bytes as text | **No base64, and no 1 MB ceiling** |

The raw header is the reason this is two methods rather than one. The default JSON
response returns file contents base64-encoded, with a 1 MB cliff above which `content`
comes back **empty rather than erroring**. Asking for raw deletes the decode step and the
cliff together. That is a platform feature doing work we would otherwise write and test.

`listDirectory` returns `unknown` on purpose. Same reason as `site.fetchContent`: the parse
belongs to the service, so a test can hand the service a fake returning garbage without a
cast and still exercise the real schema.

### Owner and repo names are constants

Per ADR-002: one user, two repos, they will not change. An environment variable for a value
that never varies is configuration nobody asked for. The owner is `Ashutosh6393`.

**The domain word and the GitHub name are not the same, and the code keeps both:**

```ts
export type Repo = "portfolio" | "workshop";

const repoNames = { portfolio: "Portfolio-new", workshop: "workshop" } as const;
```

`Repo` stays the [CONTEXT.md](../../CONTEXT.md) vocabulary — `portfolio` means "the public
site repo" everywhere in this project, and every doc, ADR, and error message says
`portfolio`. `repoNames` is the one place that word becomes a real GitHub path. Spreading
`"Portfolio-new"` through the codebase would put a deployment detail into the domain
language.

> **Verified 2026-07-31, and it was not the obvious answer.** The account holds
> `Portfolio`, `Portfolio2`, `Portfolio-new`, and `Portfolio-MCP`. `Portfolio-new` is the
> site: its homepage is `ashutoshverma.dev` and its `app/api/` holds exactly `writing`,
> `projects`, and `schema.json`. `Portfolio` is a 2025 GSAP site on GitHub Pages. Guessing
> `portfolio` from the docs would have pointed the reader at the wrong repo — and, per
> Risk 1, that failure arrives looking like a token problem.

### 404 is the only status worth distinguishing

`lib/github.ts` throws on any non-2xx. Two shapes:

- **`GithubNotFoundError`** on 404 — a named class, so the service branches on `instanceof`
  rather than matching a string.
  [errors-and-validation.md](../../.claude/rules/errors-and-validation.md) requires this:
  string-matching an error message breaks the first time someone rewords it.
- A plain `Error` on anything else, carrying the status.

That is the whole error taxonomy. Nothing else needs telling apart, because nothing else
changes what the model should do next.

**The trap, and it is a real one:** GitHub returns **404, not 403**, when a token cannot
see a private repo — deliberately, so the API does not leak which private repos exist. So a
mis-scoped token and a missing path are indistinguishable at the reader. This is why the
env schema checks the token's *format* at boot (below) — it catches the most likely version
of this mistake before it can disguise itself as a missing file.

### Env validation

```ts
GITHUB_TOKEN: z.string().startsWith("github_pat_")
```

Stricter than `.min(1)`, and deliberately so. Given the 404 trap above, a classic token, a
truncated paste, or an empty string would otherwise surface as "skill not found" — an error
message pointing at exactly the wrong thing. Failing at boot with a message naming the
variable is worth one line.

The cost is stated plainly: **if GitHub ever changes the fine-grained token prefix, the
server refuses to boot.** That is a loud, immediate, one-line fix, which is the failure
mode worth having.

### `get_skill` — what it does

Two modes, distinguished by whether `name` was given.

**No name** → one call, `listDirectory("workshop", "skills")`. Returns the directory names.
Entries of type `file` are skipped, so a `README.md` dropped into `skills/` is not offered
as a skill.

**A name** → two calls, in parallel:

```
skills/{name}/instructions.md
skills/{name}/template.mdx
```

**Both must succeed.** A skill returned without its template is not a partial success, it
is a trap: a model handed voice rules and no template will invent a template, and the
invented one ships. ADR-002 is explicit — "a template with no instructions is a mystery,
and a skill without its template is incomplete."

On a 404 for a named skill, the service makes **one extra call** to list the available
skills, so the error names what does exist. This is the most likely wrong call a model
makes, and it is the difference between recovering in the same turn and guessing again.
That call happens only on the error path.

> **The call count beats what the ADR predicted.** ADR-002 accepted "three API calls per
> `get_skill`". Reading the two paths directly needs no separate existence check, so the
> real cost is **two on the happy path**, one for a list, three only on a miss.

### The result shape

```ts
type Result =
  | { ok: true; skills: string[] }
  | { ok: true; instructions: string; template: string }
  | { ok: false; error: string };
```

No discriminator tag. The two success shapes have no field in common, so `"skills" in
result` narrows them and TypeScript is satisfied without inventing a vocabulary word. A tag
named `kind` would be actively harmful here — `kind` already means
`project | writing | post` in [CONTEXT.md](../../CONTEXT.md) and must not be overloaded.

### The tool description

`CONTEXT.md`: the model is the real caller, and tool wording is "part of the product, not
polish". So the description is specified here, not left to whoever writes the file.

The rule from spec 001 holds: **a description may only mention tools that are registered.**
`list_content` is registered, so it may be named. Nothing else may.

```
Get a skill: the voice and structure rules for drafting one kind of
content, together with the template it goes into.

With no name, returns the list of available skills.
With a name, returns that skill's instructions and its template together.

Call this before drafting anything. The instructions carry voice rules
that are not otherwise in your context, and drafting without them
produces generic output that reads nothing like the author.

Skills are private. They are separate from the published content that
list_content returns.
```

The third paragraph is doing the real work. `mcp-design.md` names the exact failure to
expect: on mobile there is no skill system, so the model drafts in generic voice and never
calls this tool. The description is the first of the two nudges. The second lives in
Slice 5 and is not built here.

### Errors

Unchanged from spec 001, and load-bearing: **tool failures are returned as tool results,
never thrown, and the HTTP status stays 200.** A thrown error gives the client a bare "tool
failed" and the conversation dead-ends. A returned sentence lands in context and the model
can act on it in the same turn.

### Data model

**No change.** No database, no migration.

### API surface

| Method | Route | Purpose | Auth |
|---|---|---|---|
| `GET` | `/health` | Liveness. Unchanged | public |
| `GET` | `/{secret}/health` | Deep check. Now reports `site` **and** `github` | secret path |
| `ALL` | `/{secret}/mcp` | MCP endpoint. Now advertises two tools | secret path |

The `github` check is `"ok"` when **both** repos are reachable, `"unreachable"` otherwise.
One entry, not two — `mcp-design.md` says one URL should tell you which *layer* is dead,
and two repos are not two layers. The response is still 200 on all-pass and 503 on any
fail, exactly as the `site` check already behaves.

Checking `portfolio` matters even though no tool reads it this slice: it is what catches a
token scoped to only one repo, which is the mistake P-2 is most likely to produce.

### Validation

| Boundary | Schema | Lives in |
|---|---|---|
| Environment, at boot | `envSchema`, extended | `src/lib/env.ts` |
| Tool arguments | `z.object({ name: z.string().optional() })` | `src/tools/get-skill.ts` |
| GitHub directory listings | `skillListSchema` | `src/lib/github.ts` |
| GitHub file bodies | **none** | — |

The last row is deliberate. `readFile` returns `response.text()`, which is already `string`.
There is nothing to parse and no schema that would mean anything. Adding one would be
ceremony.

### Existing code to reuse

The buy-vs-build check:

- **`fetch`** — global in Bun, already how `site.ts` works. No HTTP client.
- **`site.ts`'s shape** — `github.ts` copies it: schemas exported from `lib`, `unknown`
  returned to the service, parse in the service.
- **The deep-health block in `index.ts`** — extended with a second check, not rewritten.
- **`list-content.ts`'s error strings** — the same voice. A sentence that names the system
  that failed and what the model can do about it.
- **No base64 decode** — the raw `Accept` header removes the need. Do not write one.
- **No retry, no cache, no rate limiter.** See Risks 5.

---

## Files touched

Keep this current. It is how PR slices get sized.

| Path | Change | Layer | Slice |
|---|---|---|---|
| `.env.example` | modify | config | 1 |
| `src/lib/env.ts` | modify | lib | 1 |
| `src/lib/github.ts` | new | lib | 1 |
| `src/index.ts` | modify | entry | 1 |
| `src/lib/github.ts` | modify | lib | 2 |
| `src/services/get-skill.ts` | new | service | 2 |
| `src/tools/get-skill.ts` | new | tool | 2 |
| `src/tools/index.ts` | modify | tool | 2 |

**Slice 1: 4 files. Slice 2: 4 files.** Both inside the 5–7 file and 500-line limits, with
room to spare. Spec 001 broke the limit in its first slice and had to flag it at the gate;
this one does not.

---

## Test cases

Every task in `implementation.md` maps to one or more of these IDs. If a behaviour is not
listed here, there is no test for it, and it does not get built.

### Seams

**No new seams.** Both already exist and were proven in spec 001 — ADR-002 says so
explicitly, and this spec adds nothing to that list.

| Level | How | Covers |
|---|---|---|
| Unit | Call the schema / service directly, `github` passed as an object literal | T-01…T-03, T-07…T-14 |
| HTTP | `app.handle(new Request(...))` — in process, nothing listens | T-04…T-06 |
| MCP | A real JSON-RPC body through `createHandler({...}).fetch` | T-15…T-17 |

Three rules carried from [testing.md](../../.claude/rules/testing.md), all unchanged:

- **`lib/github.ts`'s `fetch` is not unit-tested against a mock of GitHub.** It is a thin
  wrapper over someone else's API; testing it against a mock of that API tests the mock.
  Its Zod schema is ours and is tested directly, exactly as `site.test.ts` does.
- **The tool is exercised through the MCP handler,** never by calling the tool function.
- **Services take `deps` as an argument.** Every unit test below passes a fake `Github`
  object literal. No mocking framework, no `mock.module()`.

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-01 | Boot fails without a token | unit | No `GITHUB_TOKEN` → parse env → throws, message names the variable |
| T-02 | Boot fails on a wrong-shaped token | unit | `GITHUB_TOKEN` set to a classic `ghp_…` token → parse env → throws, message states the expected `github_pat_` prefix |
| T-03 | Valid env parses | unit | All vars set, token `github_pat_`-prefixed → parse env → typed object, type from `z.infer` |
| T-04 | Deep health passes | http | Fake github reaching both repos, site up → `GET /{secret}/health` → 200, `checks.github` is `ok` **and** `checks.site` is still `ok` |
| T-05 | Deep health fails loudly on GitHub | http | Fake github throwing, site up → `GET /{secret}/health` → 503, body names `github` as the failed check, `site` still `ok` |
| T-06 | Both repos are checked, not one | http | Fake github succeeding on `workshop`, throwing on `portfolio` → `GET /{secret}/health` → 503, `checks.github` is `unreachable` |
| T-07 | Listing skills | unit | Fake returning two `dir` entries → `getSkill({github}, {})` → both names present |
| T-08 | Loose files in `skills/` are not skills | unit | Fake returning one `dir` and one `file` entry (`README.md`) → `getSkill({github}, {})` → only the directory name; `README.md` absent |
| T-09 | No skills yet | unit | Fake returning `[]` → `getSkill({github}, {})` → an `ok` result with an empty list, **not** an error |
| T-10 | Fetching a named skill | unit | Fake returning two distinct file bodies → `getSkill({github}, {name:"writing"})` → both `instructions` and `template` present, non-empty, and not swapped |
| T-11 | Unknown skill name | unit | Fake 404-ing on `instructions.md`, listing two skills → error result naming the bad name **and** listing the two that exist |
| T-12 | Half a skill is a failure | unit | Fake returning `instructions.md` but 404-ing on `template.mdx` → error result naming the missing template; **no partial success, no invented template** |
| T-13 | GitHub is down | unit | Fake throwing a non-404 error → error **result** naming GitHub, nothing thrown |
| T-14 | Listing comes back in an unexpected shape | unit | Fake returning `[{nope:1}]` → error result, no crash, no `undefined` leaking into the response |
| T-15 | The tool is advertised | mcp | — → `tools/list` → includes `get_skill` with a non-empty description and an **optional** `name` argument; `list_content` still listed |
| T-16 | The tool answers through the handler | mcp | `tools/call get_skill {name:"writing"}` → 200, text content carrying both the instructions and the template |
| T-17 | A tool failure is a tool result | mcp | `tools/call get_skill {name:"nope"}` → `isError: true` with an actionable sentence; **HTTP status still 200** |

### Edge cases and failure modes

- **Empty `skills/`.** A valid answer, not an error — T-09. The tool says so in words, the
  same way `list_content` answers an empty catalogue.
- **A `README.md` inside `skills/`.** Skipped by type, not by name — T-08. Filtering on a
  filename would break the day a second loose file appears.
- **A skill directory with only one of the two files.** An error, never a partial result —
  T-12. This is the one edge case with a genuinely bad outcome if it half-succeeds.
- **A mis-scoped token looks exactly like a missing file** (GitHub answers 404, not 403,
  for private repos). Mitigated at boot by the format check, not at read time. Risk 1.
- **A file over 1 MB.** Not reachable with a skill, and the raw `Accept` header removes the
  ceiling anyway. Nothing is built for it.
- **Concurrent calls.** Still not a concern — no shared state, no writes, one user.
- **Authorization.** Still one user and one path secret. Unchanged by this slice.
- **A tool failure must never become an HTTP error.** Asserted in T-13 and T-17.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **1. A bad token is indistinguishable from a missing file.** GitHub answers 404, not 403, for a private repo the token cannot see. "Your token is wrong" arrives disguised as "no such skill". | A confusing debugging session, most likely right after P-2 | The `github_pat_` format check at boot catches the common versions (classic token, truncated paste, empty). The `github` health check catches the rest — but only when a human opens it. Accepted, and written here so the next reader is not surprised. |
| ~~**2. The site repo's real name is unverified.**~~ **Closed 2026-07-31.** It is `Portfolio-new`, not `portfolio` — confirmed by its `ashutoshverma.dev` homepage and its `app/api/{writing,projects,schema.json}` tree. Three other `Portfolio*` repos exist on the account, so this was a real coin-flip and the docs would have lost it. | — | — |
| ~~**2b. The token may be scoped to the wrong `Portfolio`.**~~ **Closed 2026-07-31.** The PAT names `Portfolio-new` and `workshop`, confirmed by the token's owner. Had it been scoped to `Portfolio`, the failure would have surfaced as a 404 and read as Risk 1 — which is why it was worth checking before Task 1 rather than discovering it in Task 3. | — | — |
| **3. `Accept: application/vnd.github.raw` is assumed, not verified.** The whole no-base64 design rests on it. | The reader needs a decode step after all — a small change, but in Slice 1 | Verify in **Task 2**, first thing, against the real API. Spec 001's precedent: SDK and API assumptions get checked in the task that first depends on them, never assumed. If it does not hold, add the decode and record the correction here. |
| **4. The token expires silently, within a year.** Carried from ADR-002 → Tradeoffs. Nothing watches it. | The connector starts returning errors and nothing announced it | **Nothing is built for this, on purpose.** The `github` health check is the only thing that will ever say so. It was the App's real advantage and it was given up knowingly. Do not "fix" this inside the slice. |
| **5. Rate limits.** 5,000 requests/hour for an authenticated token; this server makes ~15 tool calls a week at two calls each. | None | Stated so nobody builds a cache or a retry for it. Three orders of magnitude of headroom is not a design input. |
| **6. Cold start now does more work.** The deep check goes from one outbound call to three. | Only affects `/{secret}/health`, which no tool call touches | The three run in parallel. No tool path got slower. Note the timing in Task 3 alongside the Slice 1 verification. |

---

## Open questions

Resolve before Status becomes `approved`. Unanswered questions here are the most common
cause of a blocked task later.

**None open.** All four are resolved below.

Resolved during planning, recorded so they are not re-opened:

- [x] **1. What is the site repo actually called on GitHub?** **`Portfolio-new`.** Verified
      2026-07-31 against the account: it is the only `Portfolio*` repo whose homepage is
      `ashutoshverma.dev` and whose `app/api/` holds `writing`, `projects`, and
      `schema.json`. `Portfolio` is a 2025 GSAP site on GitHub Pages; `Portfolio2` has no
      API routes. The domain word `portfolio` is unchanged everywhere — only
      `repoNames` in `lib/github.ts` knows the real name. See Approach → Owner and repo
      names.

- [x] **2. What are the two files inside `skills/{name}/` called?** ADR-002 said
      "instructions and template as two files" and never named them. Decided 2026-07-31:
      **`instructions.md` and `template.mdx`**. `.mdx` on the template so the file edited
      on a phone is the shape the site actually renders. `workshop` was created against
      this layout.
- [x] **3. What is the environment variable called?** `GITHUB_TOKEN`. No prefix, no
      namespace — there is one token and it will never be ambiguous.
- [x] **4. Does the `github` check cover one repo or both?** Both. ADR-001's surviving deep
      check is literally "reach both repos", and checking `portfolio` is what catches a
      token scoped to only one — the most likely P-2 mistake.

---

## Slice plan

### Slice 1 — the credential works

**Blast radius:** `.env.example`, `src/lib/env.ts`, `src/lib/github.ts`, `src/index.ts`,
plus their tests. **Nothing under `src/services/` or `src/tools/`.** No new tool is
registered, and `list_content` is not touched.

**Acceptance criteria**

1. The process refuses to start with a missing or wrong-shaped `GITHUB_TOKEN`, and the
   message says which variable and what shape.
2. `GET /{secret}/health` on the **deployed** server returns 200 with `checks.github` set
   to `ok`, having genuinely read both real repos.
3. With a repo unreachable, the same route returns **503** and names `github`. Verified,
   not assumed.
4. `checks.site` still behaves exactly as it did before. Nothing about spec 001 regressed.
5. The `Accept: application/vnd.github.raw` assumption is confirmed against the live API
   and written down either way.

**Test IDs:** T-01, T-02, T-03, T-04, T-05, T-06

### Slice 2 — load a skill from a phone

**Blast radius:** `src/lib/github.ts` (the schema only), `src/services/get-skill.ts`,
`src/tools/get-skill.ts`, `src/tools/index.ts`, plus their tests. **No config changes, no
deploy changes, no edits to `list_content` or its description.**

**Acceptance criteria**

1. In Claude Code, claude.ai, **and** the mobile app: "what skills do I have" returns
   `linkedin-post` and `writing`.
2. "Load the linkedin-post skill" returns the real instructions and the real template from
   `workshop`, both complete, in one response.
3. Asking for a skill that does not exist returns a sentence naming the skills that do —
   and the model retries correctly in the same turn without being told to.
4. A skill directory missing its `template.mdx` produces an error, not a half-answer.
5. Every failure above still returns HTTP 200.

**Test IDs:** T-07, T-08, T-09, T-10, T-11, T-12, T-13, T-14, T-15, T-16, T-17

---

Slice 1 is both the walking skeleton and the riskiest work, which is unusual and is the
reason for the split. It is the only part with an external prerequisite (P-2) and a human
deploy step, and every unknown in this spec lives in it: whether the token is scoped right,
whether the repo constants are correct, whether the raw header behaves. Slice 2 is ordinary
code that cannot start until those answers exist.
