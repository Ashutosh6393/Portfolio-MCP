# GitHub Access — Design

The plan. Source of truth for **what** gets built. Nothing gets implemented that is not
described here.

> **This is not an ADR.** The decision and its rationale live in
> [`docs/adr/002-github-access-and-workshop.md`](../../docs/adr/002-github-access-and-workshop.md).
> This document assumes that decision is made and describes how it lands in the codebase.

- **Source ADR:** `docs/adr/002-github-access-and-workshop.md`, amended by
  [`docs/adr/003-skills-and-templates-are-separate.md`](../../docs/adr/003-skills-and-templates-are-separate.md)
- **Status:** approved
- **Approved by:** Ashutosh Verma on 2026-07-31
- **Amended:** 2026-07-31, after Slice 1 — ADR-003 replaced the `workshop` layout and
  `get_skill`'s contract. Slice 2 had not started, so nothing was rebuilt. Slice 1 is
  untouched.

> Implementation does not start until Status is `approved`.

---

## What we're building

The server gains a second external system. A fine-grained personal access token, read
through Bun's `fetch`, lets it reach two GitHub repos. `GET /{secret}/health` reports
`github` alongside `site` and returns 503 when GitHub cannot be reached. One new tool,
`get_skill`, reads the drafting rules and the templates out of `workshop`, and lists what
is available when called with no name.

After this ships, a model on a phone can ask "what skills do I have" and then "load the
linkedin-post skill" and get back real text from a private repo — always including the
author's voice. Nothing is written to GitHub — the token is read-only.

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
- The `skills/` and `templates/` read paths (ADR-003)

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
| P-1 | Private `workshop` repo exists **and has commits**, holding `skills/be-human.md`, `skills/linkedin-post.md`, `skills/twitter-post.md`, `templates/writing.md`, `templates/project.md` (ADR-003) | Ashutosh | **done** — 2026-07-31, verified live. All five files present; both directory listings and a raw read of `be-human.md` return 200 |
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

### The `workshop` layout

Per [ADR-003](../../docs/adr/003-skills-and-templates-are-separate.md). One file per thing,
two directories, because skills and templates vary independently — no skill has a template
and no template has rules of its own:

```
workshop/
  skills/
    be-human.md         voice and style — the base layer, bundled into every named answer
    linkedin-post.md
    twitter-post.md
  templates/
    writing.md
    project.md
```

`writing` and `project` are the [CONTEXT.md](../../CONTEXT.md) words for what the templates
produce.

**Verified live 2026-07-31, and the extension is `.md`, not `.mdx`.** ADR-003 wrote `.mdx`
on the assumption the template should be the shape the site renders; the files were pushed
as `.md`. Nothing depends on it: names resolve from the directory listing, so both work and
neither is written into the code. Recorded because a future reader will otherwise see
`.mdx` in ADR-003 and go looking for a bug.

### `get_skill` — what it does

Two modes, distinguished by whether `name` was given.

**No name** → two calls in parallel, `listDirectory("workshop", "skills")` and
`listDirectory("workshop", "templates")`. Returns both lists, each name stripped of its
extension. Entries of type `dir` are skipped, and so is anything that is not `.md` or
`.mdx` — a `.DS_Store` is not a skill.

**A name** → two round trips.

```
round 1 (2 in parallel)   list skills/ · list templates/
round 2 (2 in parallel)   read skills/be-human.{ext} · read the resolved path
```

Resolving against the listing rather than guessing a path is what makes the extension a
non-issue and what makes the error message free — an unknown name already has both real
lists in hand and never needs a third call to build its answer.

> **Corrected in Task 5.** This block first read `skills/be-human.md` in round 1, on a
> hardcoded path. That contradicted the rule immediately above it, and for no gain: the
> voice moved to round 2 alongside the target, so it is still four calls across two round
> trips and the `.md` is no longer written into the code. One rule, no exception to it.

When the name **is** `be-human`, round 2 reads one file instead of two and it comes back
once, under `voice` — not duplicated under a second key.

**The voice always comes back.** `be-human.md` is attached to every named answer, and this
is the part worth protecting. A model handed the writing template and no voice produces a
correctly-structured document that sounds like nobody — which is the failure
`mcp-design.md` predicts and the whole reason this tool exists. ADR-002 guarded against
half a skill; ADR-003 replaces that with a guarantee about the half that mattered.

If `be-human.md` is missing, that is an **error**, not a degraded answer. Returning
structure without voice silently is exactly the outcome the guarantee exists to prevent.

> **The call count.** ADR-002 budgeted three per `get_skill`. The real cost is **two for a
> list, four for a named skill across two round trips**, and the error path adds nothing.

### The result shape

```ts
type Result =
  | { ok: true; skills: string[]; templates: string[] }
  | { ok: true; voice: string; instructions: string }
  | { ok: true; voice: string; template: string }
  | { ok: true; voice: string }                          // be-human itself
  | { ok: false; error: string };
```

No discriminator tag. The four success shapes are told apart by which key is present —
`"skills" in result`, `"instructions" in result`, `"template" in result` — and TypeScript
is satisfied without inventing a vocabulary word.

The fourth shape was added in Task 5. T-10d requires that asking for `be-human` returns it
**once**, and the alternative was putting the same text under `voice` and `instructions`
together — 6 KB of duplicate in every such answer, and a tool that has to compare two
strings to decide whether to print one or two sections. A tag named `kind` would be actively harmful here: `kind`
already means `project | writing | post` in [CONTEXT.md](../../CONTEXT.md) and must not be
overloaded.

`voice` is `be-human.md`'s text. It is named for what it carries rather than for the file
it came from, so renaming the file later does not rename a field in the tool's contract.

### The tool description

`CONTEXT.md`: the model is the real caller, and tool wording is "part of the product, not
polish". So the description is specified here, not left to whoever writes the file.

The rule from spec 001 holds: **a description may only mention tools that are registered.**
`list_content` is registered, so it may be named. Nothing else may.

```
Get a skill: the rules for drafting one kind of content, or the template
one kind of content goes into. Both come with the author's voice.

With no name, returns the available skills and templates.
With a name, returns that skill's rules or that template — always
together with the voice they are meant to be written in.

Call this before drafting anything. The voice is not otherwise in your
context, and drafting without it produces generic output that reads
nothing like the author.

Skills and templates are private. They are separate from the published
content that list_content returns.
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

Both repos are reached with `listDirectory(repo, "")` — the repo root. One caveat, found
live in Task 2 and recorded because it will look like a bug otherwise: **a repo with no
commits answers 404**, so the check reports `unreachable` for a `workshop` that exists and
is perfectly readable. That is the state the repo is in right now (Risk 7). It resolves the
moment `skills/` is pushed, which P-1 requires anyway, so nothing in the code special-cases
it.

### Validation

| Boundary | Schema | Lives in |
|---|---|---|
| Environment, at boot | `envSchema`, extended | `src/lib/env.ts` |
| Tool arguments | `z.object({ name: z.string().optional() })` | `src/tools/get-skill.ts` |
| GitHub directory listings | `entryListSchema` | `src/lib/github.ts` |
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
| T-07 | Listing skills and templates | unit | Fake listing `be-human.md`, `linkedin-post.md` and `writing.mdx` → `getSkill({github}, {})` → `skills` holds both skill names, `templates` holds `writing`; **extensions stripped from every name** |
| T-08 | Only markdown files are offered | unit | Fake listing one `.md` `file`, one `.DS_Store` `file`, and one `dir` → `getSkill({github}, {})` → only the `.md` name; the other two absent |
| T-09 | Nothing there yet | unit | Fake returning `[]` for both → `getSkill({github}, {})` → an `ok` result with two empty lists, **not** an error |
| T-10 | Fetching a named skill | unit | Fake listing `linkedin-post.md` and returning distinct bodies → `getSkill({github}, {name:"linkedin-post"})` → `instructions` and `voice` both present, non-empty, and **not swapped**; no `template` key |
| T-10b | Fetching a named template | unit | Fake listing `writing.mdx` → `getSkill({github}, {name:"writing"})` → `template` and `voice` both present and not swapped; **no `instructions` key** |
| T-10c | The extension is never guessed | unit | Fake listing the template as `writing.md`, not `.mdx` → `getSkill({github}, {name:"writing"})` → resolves and returns it |
| T-10d | Asking for the voice itself | unit | `getSkill({github}, {name:"be-human"})` → returned once, under `voice`, with no `instructions` or `template` key; `be-human.md` read **exactly once**. (Said `as instructions` when written; corrected in Task 5 — see The result shape) |
| T-11 | Unknown name | unit | Fake listing two skills and one template, name matching neither → error result naming the bad name **and** listing what does exist, in one turn and with no extra call |
| T-12 | The voice is missing | unit | Fake resolving the name but 404-ing on `skills/be-human.md` → error result naming the missing voice; **no partial success, no structure returned without it** |
| T-13 | GitHub is down | unit | Fake throwing a non-404 error → error **result** naming GitHub, nothing thrown |
| T-14 | Listing comes back in an unexpected shape | unit | Fake returning `[{nope:1}]` → error result, no crash, no `undefined` leaking into the response |
| T-15 | The tool is advertised | mcp | — → `tools/list` → includes `get_skill` with a non-empty description and an **optional** `name` argument; `list_content` still listed |
| T-16 | The tool answers through the handler | mcp | `tools/call get_skill {name:"linkedin-post"}` → 200, text content carrying both the rules and the voice |
| T-17 | A tool failure is a tool result | mcp | `tools/call get_skill {name:"nope"}` → `isError: true` with an actionable sentence; **HTTP status still 200** |

### Edge cases and failure modes

- **Empty `skills/` and `templates/`.** A valid answer, not an error — T-09. The tool says
  so in words, the same way `list_content` answers an empty catalogue.
- **A `.DS_Store` or a stray directory inside `skills/`.** Skipped by type and extension,
  never by name — T-08. A name-based blocklist breaks the day a second stray file appears,
  and ADR-003 accepted that a genuine stray `.md` will be offered as a skill.
- **A missing `be-human.md`.** An error, never a partial result — T-12. This is the one
  edge case with a genuinely bad outcome if it half-succeeds: structure with no voice is
  the failure the tool exists to prevent, and it fails silently unless it is made loud.
- **A name that is both a skill and a template.** Not defended against. One author, five
  files; if it ever happens the skill wins because `skills/` is checked first, and that is
  recorded here rather than built into a guard.
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
| ~~**3. `Accept: application/vnd.github.raw` is assumed, not verified.**~~ **Closed 2026-07-31, Task 2.** It holds. `GET /repos/Ashutosh6393/Portfolio-new/contents/package.json` with that header returned 200, `content-type: application/vnd.github.raw`, and the file's actual bytes — no base64 wrapper, no `content`/`encoding` envelope. The no-decode design stands as written. Directory listings were checked in the same pass: an array whose entries carry `name` and `type`, and `type` is `"dir"` or `"file"` exactly as assumed. | — | — |
| ~~**7. `workshop` is empty, so the `github` health check fails today.**~~ **Closed 2026-07-31.** The five files were pushed; both repo roots now answer 200. Left in place because the symptom is worth recognising again: an existing, readable, *commitless* repo answers 404 exactly like a missing one. Original entry below. |  |  |
| **7 (original). `workshop` is empty, so the `github` health check fails today.** Found in Task 2 against the live API: the repo exists and the token can see it (`private: true`, metadata 200) but holds no commits — `size: 0`, and `contents/` answers 404 "This repository is empty." | `checks.github` reports `unreachable` on a correctly-scoped token, and Task 3 cannot pass | **Not a code problem and nothing is built for it.** P-1 is unmet, not wrong: pushing the five files in Approach → The `workshop` layout fixes it and is a prerequisite of Slice 2 regardless. Special-casing an empty repo would be complexity for a state that exists only until the first commit lands. Re-verify Task 3 after P-1 is genuinely satisfied. |
| **8. `be-human.md` is a single point of failure.** Every named `get_skill` call reads it, and its absence is a hard error by design. | One missing or renamed file breaks every named call, not just one | Deliberate, and the alternative is worse: a silent fall-back returns structure with no voice, which is the exact failure the tool exists to prevent and the one nobody would notice. T-12 pins the loud behaviour. The error names the file, so the fix is obvious from the message. |
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

- [x] ~~**2. What are the two files inside `skills/{name}/` called?**~~ **Overtaken by
      ADR-003, 2026-07-31.** The question assumed every skill has two files. None does:
      `linkedin-post`, `twitter-post` and `be-human` are rules with no template, and
      `writing` and `project` are templates with no rules. So there is no `skills/{name}/`
      directory at all — `skills/` and `templates/` hold flat files, and the extension is
      resolved from the listing rather than fixed by this spec. `.mdx` on the templates
      survives, for the reason it was chosen: the file edited on a phone is the shape the
      site renders. See Approach → The `workshop` layout.
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
   `be-human`, `linkedin-post` and `twitter-post` as skills, and `writing` and `project` as
   templates.
2. "Load the linkedin-post skill" returns the real rules from `workshop` **and** the voice,
   both complete, in one response.
3. "Give me the writing template" returns the real template and the voice — and a draft
   written from it sounds like the author, not like generic Markdown.
4. Asking for a name that does not exist returns a sentence naming what does — and the
   model retries correctly in the same turn without being told to.
5. A `workshop` missing `skills/be-human.md` produces an error, not a half-answer.
6. Every failure above still returns HTTP 200.

**Test IDs:** T-07, T-08, T-09, T-10, T-10b, T-10c, T-10d, T-11, T-12, T-13, T-14, T-15,
T-16, T-17

---

Slice 1 is both the walking skeleton and the riskiest work, which is unusual and is the
reason for the split. It is the only part with an external prerequisite (P-2) and a human
deploy step, and every unknown in this spec lives in it: whether the token is scoped right,
whether the repo constants are correct, whether the raw header behaves. Slice 2 is ordinary
code that cannot start until those answers exist.
