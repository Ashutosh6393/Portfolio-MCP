# Publish — Design

The plan. Source of truth for **what** gets built. Nothing gets implemented that is not
described here.

> **This is not an ADR.** The decision and its rationale live in
> [`docs/adr/005-publish-opens-a-pull-request.md`](../../docs/adr/005-publish-opens-a-pull-request.md).
> This document assumes that decision is made and describes how it lands in the codebase.

- **Source ADR:** `docs/adr/005-publish-opens-a-pull-request.md`
- **Status:** approved
- **Approved by:** Ashutosh Verma, 2026-08-03

> Implementation does not start until Status is `approved`.

---

## What we're building

The sixth and last tool. `publish` takes a draft out of `workshop`, validates its metadata
against the site's live schema, renders it into `portfolio` on a branch, and opens a pull
request you merge by hand. On the way, `get_content` learns to read published content, so a
post already on the site can be pulled down, edited and re-published without a laptop.

After this ships, a writing goes from an idea on a train to a Vercel preview URL with no
laptop involved, and the merge button is still the only thing that makes it real.

## Why now

Five tools are live and drafts work end to end. `publish` was always last — it is the only
tool that writes to the public repo, so everything else had to be proven first. See ADR-005.

---

## Scope

### In scope

- A schema interpreter in `lib`, fed by the site's live `api/schema.json`
- `readingTime`, computed by the server from the body
- `/{secret}/health` gaining its third and last check, `schema`
- `get_content` gaining `state: "published" | "draft"`
- `save_draft`'s description gaining the slug instruction
- `publish({ kind, slug, show?, order?, revise? })` — validation, branch, commit, PR
- `show` and `order` as required arguments for `kind: "project"`
- A PR body that leads with the permanent URL and the supplied homepage values
- The GitHub token widened to `contents: write` on `portfolio`, and a ruleset on its `main`
- Narrowing the write functions so the type stops permitting an arbitrary repo

### Out of scope

- **The social post archive** — ADR-005 decision 3. Needs its own ADR.
- **An MDX parse** — ADR-005 decision 2. The Vercel preview build is the check.
- **Lazy reconciliation** — archiving a draft when its PR merges. Slice 5 of `mcp-design.md`.
- **The response nudges and the Claude Project** — also Slice 5.
- **Merging anything.** Permanently.
- **Renaming or deleting a published post.** By hand, with a redirect.
- **Validating a draft at `save_draft` time.** ADR-004 settled it; `save_draft`'s logic is
  untouched here and only its description text changes.

Anything discovered mid-build that is not in the in-scope list goes to **Deferred work**
in `summary.md`. It does not get built.

---

## Approach

`publish` is one service with four steps and no branching until the last one.

```
read the draft from workshop         (github.readFileWithSha + readDraft)
  |
validate metadata                    (site.fetchSchema -> lib/validate)
  |
assemble the published metadata      (+ readingTime, + show/order for projects)
  |
render, branch, commit, open PR      (lib/publish + github)
```

Every step returns a refusal rather than throwing, in the union every service here already
uses: `{ ok: true; ... } | { ok: false; error: string }`.

### Live facts, already checked — do not re-derive

Verified against the real site and the real repo on 2026-08-03.

| Fact | Value |
|---|---|
| Published writing path | `content/writing/{slug}.mdx` |
| Published project path | `content/projects/{slug}.mdx` — **plural**, unlike the domain word `project` |
| Default branch | `main` |
| `readingTime` format on live posts | `"16 min"`, `"14 min"` — `{n} min` |
| Schema keywords in use | `$schema`, `type`, `properties`, `required`, `additionalProperties`, `minLength`, `minItems`, `items`, `enum`, `format`, `pattern` — **eleven, not ten** |
| `$schema` | Both documents carry `"$schema": "https://json-schema.org/draft/2020-12/schema"` as a top-level key. Zod's `toJSONSchema` always emits it. It names the dialect and constrains nothing. |
| `stack.items` | `{ "type": "string", "minLength": 1 }` — `items` carries a **constraint**, not just a `type` |
| `format` values in use | `date` (on `writing.date`, alongside a `pattern`), `uri` (on `repo`, `demo`) |
| Live projects | `scaffold-ai` (`show: true, order: 1`), `yapper` (`show: true, order: 2`) |
| Live writings | six, none carrying `show` or `order` |

> **Corrected 2026-08-03, after slice 2's review.** The two rows above marked
> `$schema` and `stack.items` were originally recorded wrongly: this table said "exactly
> ten keywords" and "no nesting past one array of strings". Both were false, and the
> interpreter built to that description refused every real document. The values above were
> re-fetched from the live route rather than re-derived. The lesson is recorded rather than
> quietly patched: a "do not re-derive this" fact is only as good as the one check behind
> it, and nothing in the suite compared the interpreter against the actual response until
> the review did.

The plural `projects` directory is the single most likely thing to get wrong. The site's own
API routes have the same asymmetry — `/api/writing` and `/api/projects` — and
`list_content`'s description already says a project is live at `/projects/{slug}`.

### The published file format

`renderDraft` from `lib/draft.ts` is reused unchanged for the published file. It emits
JSON-shaped metadata — quoted keys, no trailing comma, no semicolon — while the eight posts
already in `portfolio` are hand-written JS object literals with unquoted keys.

Both are valid JavaScript, so MDX compiles either, and the site imports the object rather
than parsing it. Writing a second serializer to match the hand-written style would mean
hand-rolling JS string escaping and a second definition of the file format, for cosmetics.

**The cost, stated so it is not a surprise:** the first `revise` of a hand-written post
rewrites its whole metadata block in the diff — same values, quoted keys. It looks like a
bigger change than it is. Every post published through the tool from then on is stable.

`readDraft` is **never** pointed at a file from `portfolio`. Those are JS object literals
and it would return `null` or, worse, plausible-looking wrong metadata. Published reads go
through the site's API, which imports the real object — that is decision 7's whole point.

### Data model

No change. There is no database.

### API surface

| Method | Route | Purpose | Auth |
|---|---|---|---|
| `GET` | `/{secret}/health` | gains a third check, `schema` | secret path |

The MCP tool surface:

| Tool | Change |
|---|---|
| `publish` | **new** |
| `get_content` | gains required `state: "published" \| "draft"` |
| `save_draft` | description text only — no behaviour change |

New GitHub API calls, all on `portfolio`:

| Call | Purpose |
|---|---|
| `GET /git/ref/heads/main` | the base sha a branch is cut from |
| `POST /git/refs` | create `publish/{kind}/{slug}` |
| `PUT /contents/{path}` with `branch` | commit the file to that branch |
| `POST /pulls` | open the PR |
| `GET /pulls?head={owner}:{branch}&state=all` | find an existing PR (slice 4) |

`lib/github.ts`'s `request` helper currently hardcodes `/contents/{path}`. It is generalised
to take a path suffix so the three non-contents endpoints share the same status mapping and
the same auth header. That is a refactor of an existing file and it lands **before** any new
method uses it.

### Validation

Four boundaries, each guarded once.

| Boundary | Guarded by |
|---|---|
| Tool arguments | Zod, in `tools/publish.ts` — `kind` enum, `slug` string, `show` boolean, `order` number, `revise` boolean |
| The slug as a path | `isSlug` from `lib/draft.ts`, in the service, before any network call |
| Draft metadata | `lib/validate.ts` against the fetched `schema[kind]` |
| The site's schema response | a Zod schema in `lib/site.ts` for the two-key envelope |

**`lib/validate.ts` is the new piece.** It takes a schema document and a metadata object and
returns `string[]` — empty means valid. It is pure: no fetch, no throw for a validation
failure, no dependency. It follows `lib/draft.ts`, the precedent for a pure `lib` module.

Two rules inside it:

1. **An unknown keyword is an error, never a skip.** If `schema[kind]` carries a keyword the
   interpreter does not implement, it returns an error saying so. A partial validator that
   silently ignores what it does not understand is the failure mode this design refuses.
2. **Every error is collected, not just the first.** A model that fixes one field per turn
   costs four round trips on a new writing. All the missing fields come back at once.

`show` and `order` are **not** validated against the schema — they are absent from it by
design (`additionalProperties: false`), which is exactly why they are attached afterwards.

`readingTime` is computed, never taken from the draft. `save_draft` already strips it, so a
draft never carries one; publish supplies it before validation, and the schema then requires
it to be present, which is what closes the loop.

### `show` and `order`

Required arguments when `kind` is `"project"`, refused when `kind` is `"writing"` — the
writing schema has neither key and `additionalProperties: false` would reject them.

Order of operations, load-bearing in both directions:

```
metadata = { ...draft.metadata, readingTime }     // writings only
validate(schema[kind], metadata)                  // show/order absent — must be
metadata = { ...metadata, show, order }           // projects only
render
```

Attach before validating and every project publish fails. Skip the attach and a featured
project leaves the homepage.

### The PR body

Specified text, not the implementer's to invent. It is the last place a wrong slug or a
wrong homepage value is catchable, so **it is asserted by a test** — unlike tool
descriptions in this project, which have always been review-only.

For a writing:

```
-> ashutoshverma.dev/writing/{slug}
   This URL is permanent after merge.

Publishing writing/{slug} from the workshop draft.
readingTime: {n} min — computed from the body, not supplied.
```

For a project, the homepage block is inserted after the URL block:

```
-> ashutoshverma.dev/projects/{slug}
   This URL is permanent after merge.

   Homepage: show: {true|false}, order: {n}
   Supplied, not computed. Fix them in this diff before merging if wrong.

Publishing project/{slug} from the workshop draft.
```

The PR **title** is `Publish {kind}: {slug}`.

### Tool descriptions

Added 2026-08-03, after slice 2's review. `CLAUDE.md` says descriptions are "specified in
`design.md`, not authored here", and this section did not exist — so the instruction to
"check it by eye against `design.md`" had nothing to check against. These are now the
authoritative texts. They supersede the `save_draft` and `get_content` blocks in
[spec 004's design](../004-drafts/design.md).

Nothing asserts these in a test, by long-standing choice. Change the file and this section
in the same commit or they drift silently.

**`get_content`** — rewritten, not patched. `state` changes what the tool is:

```
Read one item back: a draft from the private workshop repo, or a post
already live on the site.

state:
  "published"  live on ashutoshverma.dev. Returns its metadata and body.
               No sha — there is no draft to overwrite.
  "draft"      unpublished, in the private workshop repo. Returns its
               metadata, body and sha.

kind:
  "writing"  a blog entry
  "project"  a portfolio project page

Call this before changing a draft. Editing is read, change, save: get the
draft here, edit the metadata or the body, then call save_draft with the
same kind and slug and the sha this returned. Pass the sha back unchanged
— it is how the server knows the draft has not moved underneath you.

To revise something already published, read it with state "published",
then call save_draft with no sha at all — that is a create. If a draft
already exists at that slug the create is refused, and you should read
that draft instead.

For the catalogue rather than one item, use list_content.
```

**`save_draft`** — the slug paragraph only. Everything else is spec 004's, unchanged:

```
slug is the kebab-case URL segment the draft is filed under. It must not
already be published. It becomes the permanent public URL once the post
is merged, so if the human has not named one, ask — do not derive it
from the title.
```

### `get_content` gains `state`

Mirrors `list_content` exactly, including that `state` is **required**, not defaulted.
`list_content` has shipped that way since spec 004, and a default on one but not the other
is the kind of asymmetry that costs a turn every time.

| `state` | Source | Returns |
|---|---|---|
| `"draft"` | `github.readFileWithSha` on `workshop`, then `readDraft` | `{ metadata, body, sha }` — unchanged |
| `"published"` | `site.fetchDocument(kind, slug)` — the `api/{kind}/{slug}` route | `{ metadata, body }`, **no `sha`** |

A published read has no `sha` because there is no draft to overwrite. The next step is
`save_draft` with no `sha` at all, which is a create — and if a draft already exists at that
slug, that create is refused and the model is told to read the draft instead. Existing
behaviour, correct here.

### `readingTime`

`Math.ceil(words / 200)`, formatted `{n} min`, where words are whitespace-separated runs.

**A body of zero or very few words returns `"1 min"`, never `"0 min"`.** The schema requires
`minLength: 1`, so `"0 min"` would pass validation and ship a nonsense value to a reader.
This is the one rule in the module that is not arithmetic.

No stripping of MDX syntax, code fences or JSX before counting. That would be a second
parser — the thing this feature spent an ADR avoiding — and the count is an estimate whose
consumer is a human glancing at a byline.

### Existing code to reuse

The buy-vs-build check. Almost all of it already exists.

| Need | Use | Not |
|---|---|---|
| Render the MDX file | `renderDraft` from `lib/draft.ts` | a second serializer |
| Read the draft | `github.readFileWithSha` + `readDraft` | anything new |
| Guard the slug | `isSlug` from `lib/draft.ts` | a new regex |
| The draft's path in `workshop` | `draftPath` from `lib/draft.ts` | string interpolation |
| Is the slug published? | the `listContent` service | a new site call |
| Current `show`/`order` | the `listContent` service — `content.json` carries them | a new route |
| Validate against the schema | `lib/validate.ts`, new | `ajv` (ADR-005 decision 1) |
| Error shape | the `{ ok: true } \| { ok: false; error }` union | a new one |
| Error branching | `instanceof` on the `Github*Error` classes | message matching |

**No new dependency.** `tech-stack.yaml` is not touched. If a task looks like it needs one,
that is a blocked task, not a `bun add`.

---

## Files touched

Keep this current. It is how PR slices get sized.

| Path | Change | Layer | Slice |
|---|---|---|---|
| `src/lib/validate.ts` | new | lib | 1 |
| `src/lib/reading-time.ts` | new | lib | 1 |
| `src/lib/site.ts` | modify — `fetchSchema` | lib | 1 |
| `src/index.ts` | modify — the `schema` health check | app | 1 |
| `src/lib/site.ts` | modify — `fetchDocument` | lib | 2 |
| `src/services/get-content.ts` | modify — `state` | service | 2 |
| `src/tools/get-content.ts` | modify — schema + description | tool | 2 |
| `src/tools/save-draft.ts` | modify — description text only | tool | 2 |
| `src/lib/github.ts` | modify — generalise `request`, 4 new methods, narrow `repo` | lib | 3 |
| `src/lib/publish.ts` | new — paths, branch name, PR body | lib | 3 |
| `src/services/publish.ts` | new | service | 3 |
| `src/tools/publish.ts` | new | tool | 3 |
| `src/tools/index.ts` | modify — register | tool | 3 |
| `src/services/publish.ts` | modify — idempotency, `revise` | service | 4 |
| `src/tools/publish.ts` | modify — the `revise` argument | tool | 4 |

Excluding tests, each slice must stay within **5–7 files / 500 lines**.

---

## Slice plan

| # | Slice | Blast radius | Acceptance criteria | Test IDs |
|---|---|---|---|---|
| 1 | **The schema arrives** | `src/lib/validate.ts`, `src/lib/reading-time.ts`, `src/lib/site.ts`, `src/index.ts` | `GET /{secret}/health` reports `schema: ok` against the live site, and 503 when it cannot be fetched. The interpreter rejects a keyword it does not know rather than passing it. No tool changes. | T-01 … T-19 |
| 2 | **Read a published post** | `src/lib/site.ts`, `src/services/get-content.ts`, `src/tools/get-content.ts`, `src/tools/save-draft.ts` | From a phone, `get_content` returns one of your live posts with its metadata and body. `save_draft`'s description tells the model to ask before choosing a slug. Drafts read exactly as before. | T-20 … T-27 |
| 3 | **Open the PR** | `src/lib/github.ts`, `src/lib/publish.ts`, `src/services/publish.ts`, `src/tools/publish.ts`, `src/tools/index.ts` | A draft becomes a real PR on `portfolio` with a Vercel preview, opened from a real client. The PR body names the permanent URL and, for a project, the supplied `show`/`order`. A second publish of the same slug refuses cleanly rather than overwriting. | T-28 … T-43, M-1, M-2 |
| 4 | **Idempotency and revise** | `src/services/publish.ts`, `src/tools/publish.ts` | Saying "publish it" twice leaves exactly one PR and says "updated". A merged post cannot be touched without `revise: true`. Revising `yapper` keeps it featured. | T-44 … T-51, M-3 |

Slices 1 and 2 are deliberately ahead of slice 3 so nothing waits on a setting in a browser.
Slice 3 carries every external prerequisite and all of the new risk.

---

## Test cases

Every task in `implementation.md` maps to one or more of these IDs. If a behaviour is not
listed here, there is no test for it, and it does not get built.

### Slice 1 — the schema arrives

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-01 | Valid writing metadata passes | unit | the live writing schema + all four required fields → validate → `[]` |
| T-02 | A missing required field is named | unit | metadata with no `summary` → validate → one error naming `summary` |
| T-03 | Every error is collected, not just the first | unit | metadata missing `date` **and** `summary` → validate → two errors |
| T-04 | An unknown key is refused | unit | valid metadata plus `tags` → validate → an error naming `tags` (`additionalProperties: false`) |
| T-05 | `minLength` is enforced | unit | `title: ""` → validate → an error naming `title` |
| T-06 | An enum is enforced and lists the allowed values | unit | `status: "done"` → validate → an error naming `status`, `shipped` and `wip` |
| T-07 | `pattern` is enforced | unit | `date: "2026-13-45"` → validate → an error naming `date` |
| T-08 | `format: uri` is enforced | unit | `repo: "not a url"` → validate → an error naming `repo` |
| T-09 | `minItems` is enforced | unit | `stack: []` → validate → an error naming `stack` |
| T-10 | `items` type is enforced | unit | `stack: [1, 2]` → validate → an error naming `stack` |
| T-11 | **An unknown keyword refuses, never silently passes** | unit | a schema carrying `maxLength` → validate anything → an error naming the keyword, and **not** `[]` |
| T-12 | An optional field may be absent | unit | a project with no `demo` → validate → `[]` |
| T-13 | 200 words is `"1 min"` | unit | a 200-word body → readingTime → `"1 min"` |
| T-14 | 201 words rounds up | unit | a 201-word body → readingTime → `"2 min"` |
| T-15 | An empty body is `"1 min"`, never `"0 min"` | unit | `""` → readingTime → `"1 min"` |
| T-16 | The schema envelope is parsed | unit | the live two-key shape → fetchSchema → both keys present |
| T-17 | A malformed schema response is an error, not a crash | unit | `{}` from the site → fetchSchema → refuses, naming the shape |
| T-18 | Health reports `schema` | integration | site returns a valid schema → `GET /{secret}/health` → 200, `checks.schema === "ok"` |
| T-19 | Health fails when the schema is unreachable | integration | the schema fetch throws → `GET /{secret}/health` → 503, `checks.schema === "unreachable"` |

### Slice 2 — read a published post

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-20 | A published writing reads back | unit | the site returns metadata + body → `getContent(state: "published")` → both, and **no `sha`** |
| T-21 | A draft read is unchanged | unit | an existing draft → `getContent(state: "draft")` → `{ metadata, body, sha }` as before |
| T-22 | The slug guard applies to published reads too | unit | a traversal slug + `state: "published"` → refused before the site is called |
| T-23 | An unknown published slug refuses | unit | the site 404s → a refusal naming kind and slug |
| T-24 | An unreachable site refuses | unit | fetch throws → a refusal naming `ashutoshverma.dev` |
| T-25 | GitHub is never called for a published read | unit | `state: "published"` → the github fake throws if touched, and is not touched |
| T-26 | Through the MCP handler | integration | `get_content` with `state: "published"` → the body comes back, `isError` unset |
| T-27 | `state` is required | integration | `get_content` with no `state` → rejected by the input schema |

### Slice 3 — open the PR

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-28 | A writing publishes | unit | a valid draft → publish → branch `publish/writing/{slug}` cut from `main`, file at `content/writing/{slug}.mdx`, PR opened, URL returned |
| T-29 | **A project publishes to `content/projects/`** | unit | a valid project draft → publish → the path is plural |
| T-30 | `readingTime` is computed and injected | unit | a draft with no `readingTime` → publish → the written file carries `{n} min` |
| T-31 | `show`/`order` are attached after validation | unit | a project draft + `show: true, order: 2` → publish → the file carries both, and validation saw neither |
| T-32 | A writing refuses `show`/`order` | unit | `kind: "writing"` with `show` → refused, nothing written |
| T-33 | Invalid metadata refuses before any write | unit | a draft with no `summary` → publish → a refusal naming `summary`, and **no** GitHub write of any kind |
| T-34 | An already-published slug refuses | unit | the slug is in `content.json` → a refusal, no branch created |
| T-35 | A missing draft refuses | unit | no draft at that slug → a refusal naming kind and slug |
| T-36 | An unparseable draft refuses | unit | the metadata block will not parse → a refusal, nothing written |
| T-37 | An unreachable schema refuses | unit | `fetchSchema` throws → a refusal saying it cannot validate, nothing written |
| T-38 | The slug guard runs first | unit | a traversal slug → refused before the site, the schema or GitHub is touched |
| T-39 | **The PR body names the permanent URL** | unit | a writing publish → the body contains `ashutoshverma.dev/writing/{slug}` and says it is permanent |
| T-40 | **The PR body names the supplied `show`/`order`** | unit | a project publish → the body contains both values and says they were supplied, not computed |
| T-41 | An existing branch refuses cleanly | unit | the branch already exists → a refusal naming it, not a crash and not a silent overwrite |
| T-42 | Through the MCP handler | integration | `publish` → the PR URL comes back; a refusal is `isError: true` at HTTP 200 |
| T-43 | Nothing is written to `portfolio` on any refusal | unit | each refusal path above → the github fake records zero writes |

### Slice 4 — idempotency and revise

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-44 | Branch + open PR → update, same PR | unit | publish twice → the second updates the branch and returns the **same** PR number, saying "updated" |
| T-45 | Publishing twice leaves exactly one PR | unit | two publishes → `createPullRequest` called once |
| T-46 | A merged PR refuses without `revise` | unit | the PR for that branch is merged → a refusal saying `revise` is needed |
| T-47 | A merged PR + `revise: true` proceeds | unit | the same, with `revise` → a new branch and a new PR |
| T-48 | A closed, unmerged PR is recreated and says so | unit | PR closed, not merged → a new PR, and the result says it was recreated |
| T-49 | A published slug + `revise: true` proceeds | unit | the slug is in `content.json`, `revise` passed → publish continues |
| T-50 | `revise` updates an existing file rather than creating | unit | the file exists on the branch → the commit carries its `sha` |
| T-51 | `revise` on a featured project keeps it featured | unit | `yapper` + `show: true, order: 2` → the written file carries both |

### Manual verification

None of these can be asserted from a test suite. All run against the real repos.

| ID | Verifies | When |
|---|---|---|
| M-2 | **The ruleset refuses a direct push to `main`** on `portfolio`, with the widened token. A deliberate attempt, by hand. The ruleset is already configured — this proves it actually refuses *this* token, which is a different claim. | **Before slice 3's code is written** |
| M-1 | A real PR opens on `portfolio` from a real client, the preview build runs, and the file lands at the right path — including the plural `projects` for a project | End of slice 3 |
| M-3 | Publishing twice from a phone leaves exactly one PR | End of slice 4 |

### Edge cases and failure modes

- **Empty body** → `readingTime` is `"1 min"`, not `"0 min"` (T-15).
- **Empty metadata** → every required field is reported at once (T-03), not one per turn.
- **Duplicate submission** → the whole of slice 4. Until slice 4 ships, a second publish is
  a clean refusal (T-41), never a silent overwrite.
- **The site is down** → `publish` refuses. It cannot validate without the schema and it
  cannot check whether the slug is published. It does not guess and it does not proceed.
- **GitHub is down** → a returned error naming GitHub. Nothing queued, nothing retried.
- **A 404 from GitHub** never claims the file is absent — it may be the token's scope
  (`CLAUDE.md`).
- **Wrong user** — not applicable. One user, one secret path, no per-resource authorization.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **The token can push to `main` once widened** | A bug commits straight to the live site, bypassing the only gate in the design | The ruleset on `main` is a **prerequisite**, proven by M-2 **before** slice 3 code is written. Not a follow-up. |
| The `projects` / `project` plural is mistyped | The file lands where the site does not read; the PR looks fine and the post never appears | T-29 exists only for this. Also called out in `CLAUDE.md`. |
| The interpreter silently passes what it does not understand | An invalid post ships and the schema layer becomes theatre | T-11 — the highest-value test in slice 1 |
| `show`/`order` attached before validation | Every project publish fails with a confusing "unknown key" error | T-31 asserts the ordering, not just the outcome |
| The model invents `show`/`order` rather than asking | A live project moves on the homepage | Nothing in code can catch this. The PR body (T-40) is the only mitigation and it depends on a human reading two lines. Stated in ADR-005 → Tradeoffs. |
| `renderDraft` reformats a hand-written post's metadata on first `revise` | A noisy diff that looks like a bigger change than it is | Accepted, documented above. Values identical; only quoting changes. |
| Generalising `github.ts`'s `request` breaks the five shipped methods | Every tool breaks at once | The refactor lands as its own task **before** any new method uses it, and the existing suite must stay green across it |
| `readDraft` gets pointed at a `portfolio` file | Plausible-looking wrong metadata, silently | Published reads go through the site's API, never GitHub. `CLAUDE.md` → Don't. |
| **`format: "date"` is a no-op.** If the site ever drops the `pattern` on `writing.date` and keeps only the `format`, dates stop being checked — silently | A malformed date reaches the site and the post sorts wrongly or fails to render | Accepted knowingly (Open questions). The code comment names the dependency, so anyone reading `validate.ts` sees that the `pattern` is doing the work. Nothing detects the site dropping it. |

---

## Open questions

All three resolved on 2026-08-03. Kept rather than deleted — the answers are decisions the
implementation depends on.

- [x] **Does the ruleset exist on `portfolio`'s `main`?** **Yes, already in place.** M-2 is
      therefore a *verification* step, not a setup step, and it still runs by hand before
      slice 3. A ruleset that exists and a ruleset that actually refuses the push with this
      token are different claims, and only the second one is the guarantee.
- [x] **`format: date` handling.** **Implement `format: "uri"` only. `format: "date"` is
      accepted as satisfied, with a comment in the code saying why** — the `pattern` beside
      it in the live schema is strictly stronger, and a second date parser could disagree
      with the site's own regex and produce a refusal nobody can explain. See the risk below
      for what this costs.
- [x] **`readingTime` for a near-empty body.** **`"1 min"`, and never a refusal.** No
      minimum word count. `"0 min"` would satisfy the schema's `minLength: 1` and ship
      nonsense to a reader, which is why the floor exists; a length threshold is an
      arbitrary number that would one day refuse a deliberately short post.
