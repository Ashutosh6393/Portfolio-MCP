# ADR-002: GitHub access and the workshop repo

- **Date:** 2026-07-31
- **Status:** accepted — **two sections superseded by
  [ADR-003](003-skills-and-templates-are-separate.md)**
- **Deciders:** Ashutosh Verma

> **Superseded in part, 2026-07-31.** *Skill storage* and *The workshop repo* → `skills/`,
> and *The tool*, are replaced by ADR-003: skills and templates are separate directories of
> flat files, no skill carries both halves, and `be-human` is bundled into every named
> answer. The text below is left exactly as decided — it is the record of why
> directory-per-skill looked right before the content existed.
>
> **Everything else here stands:** the credential, the client, the health check, the slice
> scope, and the `drafts/` · `posts/published/` · `archive/` paths.

## Context

[Spec 001](../../specs/001-server-skeleton/) is complete and deployed. The server runs on
Fly at `mcp.ashutoshverma.dev`, hides everything behind a secret URL path, and serves one
tool that reads published content from the site's live JSON routes. It answered the
question it existed to answer: **a custom connector works in the Claude mobile app.**

It touches no GitHub. That was deliberate — [ADR-001](001-server-runtime-and-shape.md)
moved every GitHub dependency out of Slice 1 so the mobile experiment was not blocked on
setup it did not need.

That deferral is now due. [`mcp-design.md`](mcp-design.md)'s build order puts "GitHub
arrives" next: the private `workshop` repo, a GitHub credential, `get_skill`, draft reads,
and the remaining deep-health checks.

What was actually undecided:

1. **How the server authenticates to GitHub.** `mcp-design.md` says "a GitHub App,
   installed on `portfolio` and `workshop`, mint installation tokens on demand, cache for
   the hour." That is one line written before any code existed, and its cost was never
   weighed against the alternative.
2. **What `workshop` looks like.** It does not exist. `get_skill` cannot be specified
   without knowing where a skill lives and what one is made of.
3. **How much ships together.** `mcp-design.md`'s Slice 2 bundles four things. The repo's
   own [git rules](../../.claude/rules/git.md) cap a PR at 5–7 files and 500 lines, and
   Slice 1 already broke that once.

Constraints in play, all from [CONTEXT.md](../../CONTEXT.md) and unchanged:

- **One human user. ~15 tool calls a week.** Scale is not a design input.
- Secrets are env vars on Fly. Nothing is in git.
- The server never clones a repo. Every read goes through the GitHub API.
- The site's part is done and is not touched here.

## Alternatives

### The credential

1. **GitHub App** — what `mcp-design.md` assumed. An installation is scoped per repo and
   per permission, and the tokens it mints expire in an hour, so a leaked token is close
   to worthless by the time anyone finds it. Install and uninstall are visible events.
   *Against:* three environment values including a multi-line PEM private key, JWT
   signing, on-demand token minting, and an hourly cache to make it affordable — a
   lifecycle to write, test, and debug. Setup is a web-console walk ending in a downloaded
   `.pem`. For two repos and one caller, that is a lot of machinery guarding a machine
   that already holds a secret capable of reaching every tool on it.

2. **Fine-grained personal access token** — one environment value, one header, no
   lifecycle at all. Fine-grained tokens are scoped to selected repositories with selected
   permissions, so the blast radius is nearly what an App installation gives.
   *Against:* it expires — one year at most — and **it expires silently**. One day the
   connector starts returning 401 and nothing announced it. It is also a user credential:
   for its lifetime it acts as the user on the repos it names, with no hourly ceiling on
   the damage.

3. **A token now, an App behind an abstraction for later.** Ship the simple thing but hide
   it behind an interface so swapping is one file.
   *Against:* an interface with one implementation, built for a migration nobody has
   scheduled. The layer chain already isolates this to one module; that *is* the seam, and
   inventing a second one to protect it is the speculative generality
   [core-principles.md](../../.claude/rules/core-principles.md) exists to prevent.

### The GitHub client

1. **`octokit`** — listed in ADR-001's dependency table and in
   [tech-stack.yaml](../../tech-stack.yaml). Types every endpoint, handles pagination and
   rate-limit retry, and owns App authentication.
   *Against:* App authentication is the half of it this decision just removed. Pagination
   and retry are answers to volume this server does not have. What is left is types — and
   the repo's own [validation rule](../../.claude/rules/errors-and-validation.md) requires
   parsing third-party responses with Zod regardless, so the types would be checked again
   at runtime anyway.

2. **`fetch`** — global in Bun, already how the site fetcher works. Reading a file from
   GitHub with a token is a URL, one header, and a base64 decode.
   *Against:* re-decided at `publish`, which needs branches, commits, and pull requests —
   four or five endpoints instead of two. That is where a client library starts to earn
   its place, and this defers the question rather than answering it.

### Skill storage

1. **One file per skill, template in a fenced block.** One API call.
   *Against:* it invents a delimiter contract, and therefore a parser, and therefore a way
   for a skill to be silently half-read when someone edits the fence on a phone.

2. **A directory per skill: instructions and template as separate files.** No parser, no
   delimiter, and each half is independently editable in GitHub's web UI from a phone.
   *Against:* three API calls per `get_skill` instead of one.

## Decision

**A fine-grained personal access token, read through `fetch`, against a `workshop` repo
laid out as one directory per skill. This slice ships `get_skill` and one health check,
and nothing else.**

### The credential

A fine-grained PAT, scoped to `portfolio` and `workshop`, contents read-only for now.
Supplied as a single environment variable, validated at boot alongside the existing path
secret, and set by hand with `fly secrets set` — it never passes through an agent or a
file.

The App loses because its advantage is **containing a leak**, and there is no leak path it
closes that matters here. The token lives in one place: Fly's secret store on a machine
that already holds `MCP_SECRET_PATH`. Anyone who can read one can read the other, and the
path secret is the thing that grants access to every tool. Buying an hourly ceiling on the
second credential, at the cost of a token lifecycle to write and maintain, protects
against an attacker who has already won.

What the App would genuinely have bought — a credential that cannot outlive its usefulness
— is given up knowingly. See Tradeoffs.

**Option 3 is rejected outright, not deferred.** The service layer already takes its
dependencies as an argument and `lib/` is already the only layer that talks to the outside
world. Swapping the credential later means rewriting one module, which is the smallest
this can be made. An interface over it would add indirection today to save nothing
tomorrow.

### The client

**No new dependency. `fetch`, as the site fetcher already does.**

`octokit` stays on the approved menu in `tech-stack.yaml` and stays uninstalled — the same
standing as Postgres, Prisma, and Redis in this repo. **Revisit at `publish`, where the
endpoint count roughly triples**; that is a real decision point and it gets a real answer
then, not a guess now.

### The workshop repo

Created private, by hand, before the spec is built. Layout — the parts this slice needs,
plus the paths `mcp-design.md` already committed to for later slices:

```
skills/{name}/          instructions and template as two files
drafts/{kind}/{slug}    Slice 3 — save_draft
posts/published/{id}    Slice 4 — publish
archive/                Slice 5 — lazy reconciliation
```

Only `skills/` is read this slice. The rest is written down so the layout is decided once
rather than three times.

Owner and repository names are **constants in the code, not environment variables.** There
is one user and two repos and they will not change; an env var for a value that never
varies is configuration nobody asked for.

### The tool

`get_skill({ name? })`, exactly as `mcp-design.md` specifies it: no name returns the list
of available skills, a name returns that skill's instructions **and** its template
together. Templates are not a separate tool — a template with no instructions is a
mystery, and a skill without its template is incomplete.

### The health check

ADR-001 lists three deep checks: mint a GitHub App token, fetch `schema.json`, reach both
repos. **This decision collapses the first two.** There is no token to mint, and a
successful read of a repo *is* the proof that the token is valid — so one check replaces
two. `schema.json` is not fetched until `publish` exists, so its check arrives with it.

After this slice the deep check reports `site` and `github`. That is the whole list until
Slice 4.

## Tradeoffs

- **The token expires, silently, within a year.** Nothing watches it. The deep health
  check is the only thing that will ever say so, and only when a human opens it. This is
  the App's real advantage, given up on purpose, and it is the single most likely way this
  server breaks in a way nobody expects.
- **For its lifetime, the token acts as the user** on both repos, with no hourly ceiling
  on what a leak costs. Fine-grained scoping limits *which* repos, not *how long*.
- **`publish` will re-open the client question**, and may well install `octokit` after
  this ADR argued against it. That is not a reversal — the endpoint count is genuinely
  different there — but it means two shapes of GitHub call may coexist briefly.
- **Three API calls per `get_skill`,** on top of a ~5.7s cold start. Fine at 15 calls a
  week; it is a real cost and it is being accepted, not overlooked.
- **Draft reads slip another slice.** `list_content` keeps its `writing | project` enum
  and gains no `state` argument, so `mcp-design.md`'s full tool signature stays
  unrealized. This is the right order anyway — there are no drafts to read until
  `save_draft` exists in Slice 3 — but the tool description will be wrong for longer than
  the design doc implies.
- **`workshop` becomes a hand-managed prerequisite.** The spec cannot be built until the
  repo exists and holds at least one skill, and no test can prove that from inside this
  repo.

## Consequences

### Corrections owed in the same commit

- **`mcp-design.md`'s Runtime section is now false.** It names a GitHub App, its
  permissions, and hourly installation-token caching. It is reference, not a numbered
  decision, so it gets corrected in place with a pointer here.
- **`tech-stack.yaml`'s `github:` entry is now false.** It names `octokit` with the role
  "GitHub App installation tokens". `octokit` stays listed and uninstalled; the role text
  and the App reference change.
- **ADR-001's health-check list is amended, not superseded.** Its Consequences section
  names "mint a GitHub token" as one of three deep checks. That check no longer exists.
  ADR-001's actual decision — runtime, layer chain, hosting — is untouched and stands, so
  this is an amendment recorded here rather than a new ADR replacing it.

### New obligations

- One new environment variable, validated at boot with the existing env schema, added to
  `.env.example` **by name only**, and set on Fly by hand.
- The deep health check gains a `github` entry and must return 503 when it fails, matching
  the behaviour the site check already has.
- A tool description for `get_skill`, written in the spec rather than invented by whoever
  writes the file — the same treatment `list_content` got, for the same reason: the model
  is the real caller and the wording is the interface. `mcp-design.md`'s open item 3 stays
  open for the four tools that do not exist yet.

### Testing seams — no new ones

This slice adds no seam. Both already exist and were proven in spec 001:

- **Services take dependencies as an argument.** The new service takes the GitHub reader
  the same way `listContent` takes the site reader, and a test passes an object literal.
- **`createApp(env, deps)` already takes a required, undefaulted `deps`.** The GitHub
  reader joins the site reader in it. Making it required was fought over in spec 001
  precisely so a test cannot forget to inject and quietly hit the network — the same
  protection now covers GitHub.
- **The GitHub reader itself is not unit-tested against a mock of GitHub.**
  [testing.md](../../.claude/rules/testing.md) is explicit: a thin wrapper over someone
  else's API, tested against a mock of that API, tests the mock. Its Zod parse is ours and
  is tested. Its `fetch` is not.
- **The tool is exercised through the MCP handler,** never called directly.

### Proposed slices

A sketch for `to-spec` to refine, not a plan:

1. **The credential works.** Env var, the GitHub reader, the `github` health check. No new
   tool. Deployed and verified against the real repo, because a credential that only works
   in a test suite has not been verified at all.
2. **`get_skill`.** Service, tool, registration.

Splitting here is not ceremony. Slice 1 is the only part with an external prerequisite and
a human deploy step, and it is worth knowing the token works before anything depends on
it.

### Out of scope

Deliberately, so nobody picks them up:

- **Draft reads** — `list_content`'s `state` argument, `kind: "post"`, and `get_content`.
  There are no drafts until Slice 3 writes one.
- **`save_draft`, `discard_draft`, `publish`** — Slices 3 and 4, unchanged.
- **`schema.json` fetching, MDX parsing, `fromJsonSchema`** — nothing is validated against
  the site's schema until `publish`.
- **Lazy reconciliation and response nudges** — Slice 5.
- **Any write to GitHub.** The token is read-only this slice. Write permission arrives
  with the tool that needs it.
- **The GitHub App.** Rejected above with reasons. Re-proposing it needs a new ADR, not a
  pull request.

### Fixed alongside, in its own commit

`CONTEXT.md`'s "Current state" section was stale — it said "prototype, no server code yet"
and "Next: Slice 1", both untrue since spec 001 merged. That staleness predates this
decision and was not caused by it, so it is corrected in a **separate commit** on the same
branch rather than folded into this one. The diff for this decision stays traceable to
this decision.
