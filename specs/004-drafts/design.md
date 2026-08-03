# Drafts — Design

The plan. Source of truth for **what** gets built. Nothing gets implemented that is not
described here.

> **This is not an ADR.** The decision and its rationale live in
> [`docs/adr/004-drafts-are-real-mdx-in-workshop.md`](../../docs/adr/004-drafts-are-real-mdx-in-workshop.md).
> This document assumes that decision is made and describes how it lands in the codebase.

- **Source ADR:** `docs/adr/004-drafts-are-real-mdx-in-workshop.md` (accepted 2026-08-01
  after a review that narrowed the scope — the ADR body is the reviewed text)
- **Status:** approved
- **Approved by:** Ashutosh Verma, 2026-08-01 — all seven open questions confirmed as
  written, no alternatives taken

> Implementation does not start until Status is `approved`.

---

## What we're building

The server gains the ability to **write**. A draft becomes a real MDX file at
`workshop/drafts/{kind}/{slug}.mdx`, with its metadata in a JSON-shaped
`export const metadata = {...}` block that the server both writes and reads back. Three new
tools ship — `save_draft`, `get_content`, `discard_draft` — and `list_content` gains a
`state` argument so drafts can be listed alongside published content.

After this ships, a model on a phone can draft a writing with `get_skill`, save it, read it
back, edit it, save it again over the same file, and throw it away — without a laptop and
without a diff to read. Nothing is published: `portfolio` stays read-only and no PR is
opened.

## Why now

[Spec 002](../../specs/002-github-access/) proved the token, the reader, and the tool
shape. `mcp-design.md`'s build order puts cheap writes next, and ADR-004 answers the
question every slice so far has dodged — **what is a draft, on disk?** The draft reads
ADR-002 pushed down (`list_content`'s `state`, `get_content`) come with it, because there
is nothing to read until something writes.

---

## Scope

### In scope

- `src/lib/draft.ts` — the serializer and the reader, as pure functions, plus the draft
  path and the slug check
- `src/lib/github.ts` — `writeFile`, `deleteFile`, `readFileWithSha`, and the conflict
  error classes. Its header comment's "no writing (the token is read-only)" line is fixed
  in the same commit
- `save_draft({ kind, slug, metadata, body, sha? })` — service, tool, registration, the
  published-slug check, and the `sha` refusals
- `get_content({ kind, slug })` — service, tool, registration. Returns
  `{ metadata, body, sha }` for a draft
- `discard_draft({ kind, slug })` — service, tool, registration
- `list_content({ kind, state })` — a new `state` argument and the rewritten description
- The four tool descriptions, verbatim, below

### Out of scope

Carried from ADR-004 → Out of scope, so nobody picks them up mid-build:

- **`publish`** — validation, `api/schema.json`, MDX body parsing, branches, PRs,
  idempotency, `revise`. `publish` asks the user for the slug and for `show`/`order` on a
  project, sets `date`, and derives the rest. **None of that is built here.**
- **Any validation of metadata.** `save_draft` does not fetch `api/schema.json`, does not
  carry a copy of the site's schema, and adds no required-field check of its own. A draft
  with a title and nothing else saves without complaint. A second definition of "valid" is
  the thing `api/schema.json` exists to prevent.
- **Write access to `portfolio`.** The token stays read-only there.
- **`kind: "post"`.** A social post is never stored. `kind` is `"writing" | "project"`
  everywhere in this slice — in the tool schemas, in the path, in the type. Do not add a
  third value "for later".
- **Lazy reconciliation** — checking whether a draft's PR merged and archiving it. There
  are no PRs until `publish` exists.
- **`get_content` on published content.** The site has per-slug routes
  (`GET /api/writing/{slug}`), so this is possible later — but ADR-004 scopes `get_content`
  as a draft read, and a published item has no `sha`, so the read-modify-write contract the
  tool exists to serve would not hold for it.
- **The `get_skill` response nudges** and the Claude Project. A later feature. In
  particular, **do not** append "call `get_skill` first" to any response here.
- **Any undo, trash, or draft history.** Git is the history.
- **Installing a dependency.** No JS parser, no `eval`, no MDX library. The reader is a
  span and a `JSON.parse`.

Anything discovered mid-build that is not in the in-scope list goes to **Deferred work**
in `summary.md`. It does not get built.

---

## Prerequisites

**None.** The token's scope change — contents: read **and write** on `workshop` only — is a
human step set by hand with `fly secrets set`, and ADR-004 is explicit that **no task waits
on it**: the serializer and the reader are pure functions, and the write path is proven the
first time a draft is saved. It is folded into Task 2's live check (M-1), not recorded as a
`P-*` gate.

`portfolio` stays **read-only**. Do not widen it.

---

## Approach

### Request flow

```
Elysia
  └── /{secret}
        └── ALL /mcp  → mounted MCP handler
                            │
                            ▼
                   tools/   list-content · get-skill · save-draft
                            get-content · discard-draft
                            │
                            ▼
                 services/  saveDraft(deps, args)   ← takes site AND github
                            getContent(deps, args)
                            discardDraft(deps, args)
                            listDrafts(deps, args)
                            │
                            ▼
                      lib/  github.ts (fetch, now writes)
                            draft.ts  (pure: render, read, path, slug)
                            site.ts   (unchanged)
```

Same chain as before: `tools → services → lib`. `draft.ts` is the first `lib` module that
touches no network at all.

### The draft file

```
workshop/drafts/{kind}/{slug}.mdx        kind is "writing" | "project"
```

```mdx
export const metadata = {
  "title": "What CRDTs taught me",
  "summary": "A short one.",
  "date": "2026-07-31"
}

The body starts here, plain MDX.
```

**The serializer is `JSON.stringify(metadata, null, 2)`, and the indent is load-bearing,
not cosmetic.** With indent 2, the top-level closing brace is the only `}` at column 0 —
every nested object or array closes on an indented line. With no indent, `JSON.stringify`
emits one line and there is no `}` line at all, so the reader would fail on the
serializer's own output. Anyone "tidying" that argument breaks the format silently, which
is why T-05 asserts the exact rendered text.

Three things fall out for free and are not written by hand:

- **Quoted keys** — valid JavaScript, renders identically on the site, and what makes the
  block `JSON.parse`-able. Cosmetically unlike the hand-written posts in `portfolio`; that
  is a `publish` concern (ADR-004), not solved here.
- **Absent keys, not empty strings** — `JSON.stringify` drops `undefined` values. Serializer
  rule 2 from `mcp-design.md` is satisfied by the platform. Do not write a filter for it.
- **Strings can hold anything** — newlines and braces inside a value are escaped, so no
  value can forge the closing delimiter.

**One guard is written by hand.** `JSON.stringify({}, null, 2)` returns the two characters
`{}` — a single line, with no line that is exactly `}`. Empty metadata is reachable
(`save_draft` accepts any JSON object, including `{}`), so the serializer writes `{\n}` in
that one case. `JSON.parse("{\n}")` is `{}`, so the round trip holds. See Open questions →
G-1: this is a hole in the ADR's format that the spec closes with one line.

### The reader

```ts
readDraft(text: string): { metadata: Record<string, unknown>; body: string } | null
```

The whole parser:

1. Find the first `{`.
2. Find the first line after it that is **exactly** `}` (no leading or trailing
   whitespace).
3. `JSON.parse` the span between them, inclusive.
4. The body is everything after that line, with leading newlines stripped.

Anything that does not work — no `{`, no terminating `}` line, `JSON.parse` throws — returns
`null`. **`null`, not an error object and not a throw**, because ADR-004 forbids surfacing
the parse error: there is nothing a phone user can do with a character offset, so there is
nothing to carry. The service turns `null` into the specified refusal.

**A body containing a line that is exactly `}` is safe.** The metadata block always comes
first, so its closer is always the *first* such line and the body is never scanned. A draft
containing a fenced JS block survives the round trip unchanged (T-04).

**Round trip is the property that matters:** `readDraft(renderDraft(m, b))` deep-equals
`{ metadata: m, body: b }` for any JSON-serializable object `m` and any body `b` that does
not begin with a newline. Leading blank lines in a body are not preserved — that is what
lets a hand-edited file with different spacing still read back, and blank lines before the
first MDX element mean nothing. No trailing newline is appended to the file; the body is
written exactly as given.

**This parser reads only blocks the server wrote.** If a future slice ever reads an MDX file
from `portfolio` — one a human wrote — this is the wrong tool and will look like the right
one. That sentence goes in `draft.ts`'s header comment (ADR-004 → Tradeoffs).

### The refusal when a block will not parse

Exactly one message, and it never quotes the parse error:

> The metadata block in `drafts/{kind}/{slug}.mdx` is not in a shape this server can read.
> Fix it in GitHub and save the draft again.

This path should never fire: every draft in `workshop` was written by the serializer. The
refusal exists so that if it ever does, it fails loudly instead of returning
plausible-looking wrong metadata. It never guesses and never returns a body with empty
metadata.

### `lib/github.ts` gains three methods and two errors

```ts
export type Github = {
  listDirectory(repo: Repo, path: string): Promise<unknown>;
  readFile(repo: Repo, path: string): Promise<string>;
  readFileWithSha(repo: Repo, path: string): Promise<{ content: string; sha: string }>;
  writeFile(repo: Repo, path: string, content: string,
            options: { message: string; sha?: string }): Promise<void>;
  deleteFile(repo: Repo, path: string,
             options: { message: string; sha: string }): Promise<void>;
};
```

- **`readFileWithSha` cannot use the raw `Accept` header.** The `sha` only comes back on the
  JSON response, whose `content` is base64. ADR-002 said "no base64 decoder exists or is
  needed"; ADR-004 amends that — **one decode line returns.** Use
  `Buffer.from(json.content, "base64").toString("utf8")`. **Not `atob`**: GitHub wraps the
  base64 at 60 characters and `atob` throws on the embedded newlines. The 1 MB cliff comes
  back with the JSON response too; a draft is text, so nothing is built for it.
- **`writeFile` and `deleteFile` are `PUT` / `DELETE` on the same contents endpoint.**
  Content is sent base64: `Buffer.from(text, "utf8").toString("base64")`.
- **No `author` field is sent.** A fine-grained PAT *is* the user, so GitHub already
  attributes the commit correctly. `mcp-design.md`'s "set the commit author" rule was
  written for the GitHub App that ADR-002 rejected and is moot (ADR-004 → Commit
  authorship). Do not implement it.
- **Commit messages are specified, not invented:** `save draft: {kind}/{slug}` and
  `discard draft: {kind}/{slug}`.

Two new error classes join `GithubNotFoundError`, because the service must branch on them
and [errors-and-validation.md](../../.claude/rules/errors-and-validation.md) forbids
matching message strings:

| Class | Thrown on | Means |
|---|---|---|
| `GithubConflictError` | 409 | The `sha` did not match — the file changed underneath |
| `GithubAlreadyExistsError` | 422 on a create (no `sha` sent) | A file is already at that path |

**Both status codes are verified.** M-1 drove them against the real `workshop` repo on
2026-08-02 and the live API returned exactly what was assumed: **409** for a stale `sha` on
`PUT`, **422** for a create with no `sha` over an existing path. Nothing in the mapping had
to change.

M-1's other four answers, recorded here so nobody re-derives them:

- The widened token permits the write. A create succeeded rather than answering the 404 that
  Risk 5 warns a still-read-only token would give.
- `readFileWithSha` decodes correctly, including a file long enough to trigger GitHub's
  base64 wrap at 60 characters — the case `atob` would have thrown on.
- `deleteFile` removes the file; a following read raises `GithubNotFoundError`.

Both eyeball checks were made in GitHub's web UI on 2026-08-02 and both passed: the scratch
commits are attributed to **Ashutosh6393**, not a bot or `web-flow`, and `portfolio` took no
commits at all. Attribution needs no `author` field — a fine-grained PAT already is the
user, which is what makes `mcp-design.md`'s "set the commit author" rule moot rather than
skipped.

### `save_draft` — what it does

`saveDraft(deps: { site: Site; github: Github }, args: { kind, slug, metadata, body, sha? })`

The first service that depends on both external systems.

1. **Slug shape.** `isSlug(slug)` from `lib/draft.ts` — kebab-case only. Refuse otherwise.
   This is a trust boundary, not content validation: the slug becomes a path in a repo the
   server can now write to and delete from. See Open questions → A-4.
2. **Is the slug already published?** Call the existing `listContent({ site }, { kind })`
   service and look for a matching slug. This reads **the site**, not `api/schema.json` —
   it answers "am I about to shadow something that already exists?", which cannot wait for
   `publish`, not "is this shape valid?", which does.
3. **Site unreachable → refuse.** `listContent` already returns `{ ok: false, error }` for
   both an unreachable site and an unexpected shape. `save_draft` cannot prove the slug is
   free, and guessing risks a draft that quietly shadows a published writing. ADR-004 states
   the cost: a drafting tool now depends on the site being up.
4. **Drop the reserved keys.** `show`, `order` and `readingTime` are removed from `metadata`
   before rendering, silently and without refusing. `show`/`order` come from the human at
   publish time; `readingTime` is computed from the body at publish time. Serializer rules 1
   and 3 from `mcp-design.md`, which ADR-004 says stand unchanged. Dropping three named keys
   is not a required-field check and creates no second definition of valid. See Open
   questions → A-1 for why this sits in the service and not in `renderDraft`.
5. **Render and write.**
   `writeFile("workshop", draftPath(kind, slug), renderDraft(...), { message, sha })`.

The two refusals, both specified:

- **`sha` mismatch** (`GithubConflictError`) — *"That draft changed since you read it.
  Call get_content for {kind}/{slug} again and re-apply the edit before saving."* A refusal,
  never a retry. With one user and one client this should never fire; it is the wall that
  makes "the `sha` rules are the entire defence" true rather than aspirational.
- **No `sha`, path taken** (`GithubAlreadyExistsError`) — *"A draft already exists at
  {kind}/{slug}. Call get_content to read it, then save again with the sha it returns."*
  A save with no `sha` is a create. To overwrite, you must have read first.

**One file per draft, always.** An edit never creates a second one.

### `get_content` — what it does

`getContent(deps: { github: Github }, args: { kind, slug })` → `{ metadata, body, sha }`.

`readFileWithSha` on the draft path, then `readDraft` on the text. Three outcomes: the
content, a 404 refusal naming the slug, or the unparseable-block refusal above. The `sha`
travels all the way out to the model — it is the input to the next `save_draft` and the
whole read-modify-write contract, so the tool prints it (T-28).

### `discard_draft` — what it does

`discardDraft(deps: { github: Github }, args: { kind, slug })`.

`readFileWithSha` for the `sha`, then `deleteFile` with it. There is no delete-by-path in
the contents API. A 404 on the read is a refusal — *"There is no draft at {kind}/{slug}."*

**`discardDraft` never calls `readDraft`.** A draft whose metadata block is broken is
exactly the one you most want to be able to throw away (T-18).

### `list_content` gains `state`

`state` is a **required** argument: `"published" | "draft"`. See Open questions → A-3.

- **`state: "published"`** routes to the existing `listContent` service. **Unchanged** —
  `src/services/list-content.ts` and its tests are not touched by this spec, which is what
  makes "behaves as it does today" provable from the diff rather than argued.
- **`state: "draft"`** routes to a new `listDrafts(deps: { github }, { kind })` service:
  one `listDirectory("workshop", "drafts/{kind}")`, entries filtered to `type === "file"`
  and `.mdx`, extension stripped. **Slugs only** — reading a title out of every draft would
  cost one API call per draft, and the slug is a kebab-case title. `get_content` is how you
  read one.
- **A missing `drafts/{kind}/` directory is an empty list, not an error.** GitHub 404s a
  directory that does not exist, and it will not exist until the first draft of that kind is
  saved. This is the failure most likely to be mistaken for a bug (T-23).

`kind` stays `"writing" | "project"`. Posts are not stored, so they are never listed.

`registerListContent`'s `deps` widens from `{ site }` to `{ site; github }`. `tools/index.ts`
already passes the whole `deps` object, so it needs no change for this.

### The tool descriptions

`CONTEXT.md`: the model is the real caller, and tool wording is "part of the product, not
polish." ADR-004 requires all four to be specified here rather than invented by whoever
writes the file. **Verbatim. Do not reword.**

The rule from spec 001 holds and it constrains the slice order: **a description may only
mention tools that are registered.** See Open questions → G-2.

> **Superseded for `save_draft` and `get_content` by
> [spec 005](../005-publish/design.md) → Tool descriptions (2026-08-03).** Spec 005 added
> the slug instruction to `save_draft`'s slug paragraph and rewrote `get_content` wholesale
> for the `state` argument. The blocks below are spec 004's originals, kept because ADRs
> and specs are append-only — they are no longer what ships. `discard_draft` and
> `list_content` below are unchanged and still authoritative.

#### `save_draft`

```
Save a draft of a writing or a project to the private workshop repo.

Drafts are not validated and they are not published. Any JSON object is
accepted as metadata — a draft with only a title is fine. Missing fields
are asked for when you publish, not here.

kind:
  "writing"  a blog entry
  "project"  a portfolio project page

slug is the kebab-case URL segment the draft is filed under. It must not
already be published.

Saving without a sha creates a new draft, and fails if one already exists
at that slug. To change an existing draft, call get_content first, edit
what it returns, and pass its sha back here. That is the only way to
overwrite a draft: nothing can be replaced that was not read first.

Do not set show, order or readingTime. Those are not yours to choose and
they are dropped.
```

#### `get_content`

```
Read one draft back out of the private workshop repo: its metadata, its
body, and its sha.

Call this before changing a draft. Editing is read, change, save: get the
draft here, edit the metadata or the body, then call save_draft with the
same kind and slug and the sha this returned. Pass the sha back unchanged
— it is how the server knows the draft has not moved underneath you.

kind:
  "writing"  a blog entry
  "project"  a portfolio project page

This reads drafts only. For published content, list_content returns the
catalogue.
```

#### `discard_draft`

```
Delete a draft from the private workshop repo.

This cannot be undone from here. There is no trash and no restore, so if
there is any doubt about which draft this is, read it with get_content
first.

kind:
  "writing"  a blog entry
  "project"  a portfolio project page

It removes drafts only. Published content is not reachable from this
server.
```

#### `list_content` — rewritten, not patched

```
List content by kind and state.

state:
  "published"  live on ashutoshverma.dev. One entry per item with its
               slug, title and summary — the catalogue, not the text.
  "draft"      unpublished, in the private workshop repo. Slugs only.
               Call get_content to read one.

kind:
  "writing"  a blog entry, live at /writing/{slug}
  "project"  a portfolio project page, live at /projects/{slug}

Neither state returns the body of anything. Social posts are not stored
anywhere and are never listed.
```

### Errors

Unchanged from spec 001 and 002, and still load-bearing: **tool failures are returned as
tool results, never thrown, and the HTTP status stays 200.** A thrown error gives the client
a bare "tool failed" and the conversation dead-ends. A returned sentence lands in context
and the model can act on it in the same turn.

Every service in this slice returns `{ ok: true, ... } | { ok: false; error: string }` and
never rejects.

### Data model

**No change.** No database, no migration. The file in `workshop` is the whole model.

### API surface

| Method | Route | Purpose | Auth |
|---|---|---|---|
| `GET` | `/health` | Liveness. Unchanged | public |
| `GET` | `/{secret}/health` | Deep check. **Unchanged** — `site` and `github`, no new entry | secret path |
| `ALL` | `/{secret}/mcp` | MCP endpoint. Now advertises five tools | secret path |

**No new health check.** No new external system arrives — this is the same GitHub reached
with a wider token scope, and the existing `github` check already proves the credential
works. A check that a *write* works would have to write something.

### Validation

| Boundary | Schema | Lives in |
|---|---|---|
| Tool arguments — `kind` | `z.enum(["writing", "project"])` | each tool file |
| Tool arguments — `slug` | `z.string()` at the tool, `isSlug` in the service | `src/lib/draft.ts` |
| Tool arguments — `metadata` | `z.record(z.string(), z.unknown())` | `src/tools/save-draft.ts` |
| Tool arguments — `state` | `z.enum(["published", "draft"])` | `src/tools/list-content.ts` |
| GitHub directory listings | `entryListSchema` (exists) | `src/lib/github.ts` |
| GitHub contents JSON (`content` + `sha`) | a new `fileContentSchema` | `src/lib/github.ts` |
| Draft metadata **content** | **none, deliberately** | — |

The last row is the ADR's decision, not an omission. `z.record(z.string(), z.unknown())` at
the tool boundary rejects an array, a string, or a number where an object is required —
that is parsing an argument's *type*, which is different from validating a draft's
*content*, and it is the only thing standing between the model and `JSON.stringify`.

### Existing code to reuse

The buy-vs-build check:

- **`JSON.stringify` / `JSON.parse`** — the entire serializer and the entire parser. No
  dependency, no `eval`, no regex-per-field.
- **`listContent`** — `saveDraft` calls it for the published-slug check rather than
  re-implementing fetch-and-parse against the site's schemas. See Open questions → A-2.
- **`src/lib/github.ts`'s private `read` helper** — the new methods extend it rather than
  adding a second `fetch` block. It already handles 404 and the non-2xx throw.
- **`Buffer`** — global in Bun. No base64 library.
- **`src/tools/get-skill.ts`'s shape** — every new tool file is that file with a different
  service. Specified description as a `const`, `inputSchema` as a `z.object`, `isError` on
  refusal.
- **No cache, no retry, no rate limiter.** Unchanged from ADR-002 — 15 calls a week against
  5,000 an hour.

---

## Files touched

Keep this current. It is how PR slices get sized.

| Path | Change | Layer | Slice |
|---|---|---|---|
| `src/lib/draft.ts` | new | lib | 1 |
| `src/lib/github.ts` | modify | lib | 1 |
| `src/services/save-draft.ts` | new | service | 2 |
| `src/services/get-content.ts` | new | service | 2 |
| `src/tools/save-draft.ts` | new | tool | 2 |
| `src/tools/get-content.ts` | new | tool | 2 |
| `src/tools/index.ts` | modify | tool | 2 |
| `src/services/discard-draft.ts` | new | service | 3 |
| `src/tools/discard-draft.ts` | new | tool | 3 |
| `src/tools/index.ts` | modify | tool | 3 |
| `src/services/list-drafts.ts` | new | service | 4 |
| `src/tools/list-content.ts` | modify | tool | 4 |

**Slice 1: 2 files. Slice 2: 5. Slice 3: 3. Slice 4: 2.** All inside the 5–7 file and
500-line limits. `src/services/list-content.ts` appears nowhere — it is deliberately not
touched.

---

## Test cases

Every task in `implementation.md` maps to one or more of these IDs. If a behaviour is not
listed here, there is no test for it, and it does not get built.

### Seams

**One new seam, and it is the cheap kind.** ADR-004 → Testing seams: the serializer and the
reader are **pure functions in `lib/`**, tested directly with no injection, no fake, and no
network. It is the highest-value seam in the slice and the only genuinely new logic in it.

Everything else is a seam that already exists and was proven in specs 001 and 002:

| Level | How | Covers |
|---|---|---|
| Unit — pure | Call `renderDraft` / `readDraft` directly | T-01…T-06b |
| Unit — service | Call the service, `github` and `site` passed as object literals | T-07…T-23b, T-32 |
| MCP | A real JSON-RPC body through `createHandler({...}).fetch` | T-24…T-31 |
| Manual | A human, against the real repo and a real client | M-1…M-4 |

Three rules carried from [testing.md](../../.claude/rules/testing.md), all unchanged:

- **`lib/github.ts`'s `fetch` is not unit-tested against a mock of GitHub** — including the
  new write methods. It is a thin wrapper over someone else's API, and testing it against a
  mock of that API tests the mock. Its Zod schemas are ours; the writer's status-code
  mapping is proven live in M-1, not against a fake.
- **Tools are exercised through the MCP handler**, never by calling the tool function.
- **Services take `deps` as an argument.** Every unit test below passes plain object
  literals. No mocking framework, no `mock.module()`.

### The format — `src/lib/draft.ts`

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-01 | The round trip | unit | Metadata holding a string, a number, a nested object and an array of strings; a multi-line body → `readDraft(renderDraft(m, b))` → deep-equals `{ metadata: m, body: b }`; **nested closers never end the block** |
| T-02 | Absent optionals are absent keys | unit | Metadata with one key set to `undefined` → `renderDraft` → the rendered text contains neither the key nor an empty string for it; `readDraft` returns an object without the key |
| T-03 | Empty metadata survives | unit | `renderDraft({}, body)` → `readDraft` of the result → `{ metadata: {}, body }`, **not `null`** |
| T-04 | A body containing a line that is exactly `}` | unit | Body holding a fenced block whose own line is exactly `}` → round trip → the body comes back byte-identical, metadata unaffected |
| T-05 | The rendered shape is pinned | unit | `renderDraft({ title: "x" }, "body")` → the exact text: `export const metadata = {`, a **quoted** key indented two spaces, a line that is exactly `}`, a blank line, then the body |
| T-06 | A block that will not parse is refused | unit | A file whose block has a trailing comma → `readDraft` → `null`. **Assert failure only** — ADR-004 is explicit that enumerating which malformation gives which message is not worth a test |
| T-06b | A block with no terminating `}` line | unit | A file whose block never closes at column 0 → `readDraft` → `null`, nothing thrown. A different code path in our function, not a second flavour of malformation |

### `save_draft` — `src/services/save-draft.ts`

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-07 | A new writing draft | unit | Fake site with no matching slug, fake github accepting the write → `saveDraft({site,github},{kind:"writing",slug:"a-post",metadata,body})` → `ok`; written to **`drafts/writing/a-post.mdx`**, with `renderDraft`'s exact output and **no `sha`** |
| T-08 | A new project draft | unit | Same, `kind:"project"` → written to **`drafts/project/a-thing.mdx`** |
| T-09 | Updating with a matching sha | unit | `sha:"abc"` supplied, writer accepts → `ok`; the writer received **that exact sha** |
| T-10 | A sha mismatch refuses | unit | Writer throws `GithubConflictError` → `{ ok:false }` whose message says the draft changed and names `get_content`; nothing thrown |
| T-11 | A create over an existing path refuses | unit | No `sha`, writer throws `GithubAlreadyExistsError` → `{ ok:false }` telling the model to read it first with `get_content`; **not silently overwritten** |
| T-12 | An already-published slug refuses | unit | Fake site returning an item with that slug → `{ ok:false }` naming the slug; **`writeFile` was never called** |
| T-13 | The site being unreachable refuses | unit | Fake site throwing → `{ ok:false }` naming the site; **`writeFile` was never called**. It cannot prove the slug is free, so it does not guess |
| T-14 | Reserved keys are dropped, not refused | unit | Metadata carrying `show`, `order`, `readingTime` **and** a title → `ok`; the written text contains none of the three and still contains the title |
| T-15 | Any other GitHub failure | unit | Writer throws a plain `Error` → error **result** naming GitHub, nothing thrown |
| T-32 | A slug that is not a slug | unit | `slug:"../../../etc/passwd"` → `{ ok:false }`; `writeFile` never called. The slug becomes a path in a repo the server can now write to |

### `get_content` — `src/services/get-content.ts`

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-19 | Reading a draft back | unit | Fake github returning a rendered draft and `sha:"abc"` → `getContent` → `{ ok:true, metadata, body, sha:"abc" }`, metadata parsed, body exact |
| T-20 | A draft that is not there | unit | Fake throwing `GithubNotFoundError` → `{ ok:false }` naming kind and slug |
| T-21 | A block that will not parse | unit | Fake returning a file with a broken block → `{ ok:false }` whose message says to fix it in GitHub and save again, and which **does not contain the underlying parse error**; no partial result, no empty-metadata body |
| T-33 | A slug that is not a slug | unit | `slug:"../../../../Portfolio-new/contents/package.json?"` → `{ ok:false }`; **`readFileWithSha` never called**. The slug becomes a path in a URL, and a traversal escapes the drafts directory and the repo |

T-33 was added after the slice 2 review found the guard missing — `design.md` specified `getContent` with no slug check, so this is a hole in the spec, not a deviation by the coder.

### `discard_draft` — `src/services/discard-draft.ts`

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-16 | Discarding an existing draft | unit | Fake returning `sha:"abc"` for `drafts/writing/a-post.mdx` → `discardDraft` → `ok`; `deleteFile` called with that path **and that sha** |
| T-17 | Discarding a draft that is not there | unit | Read throws `GithubNotFoundError` → `{ ok:false }` naming kind and slug; **`deleteFile` never called** |
| T-18 | Discarding a draft with a broken block | unit | Fake returning a file whose metadata will not parse → `ok`, deleted. **The one you most want to be able to throw away must not need parsing** |
| T-34 | A slug that is not a slug | unit | `slug:"../../../../Portfolio-new/contents/package.json?"` → `{ ok:false }`; **neither `readFileWithSha` nor `deleteFile` is called**. Same trust boundary as T-32 and T-33, and this one deletes |
| T-35 | The delete itself failing | unit | `deleteFile` throws a plain `Error` → error **result** naming GitHub, nothing thrown. The read succeeded, so this is a failure of the delete, not of finding the draft |

T-34 was added before slice 3's code, closing the guard gap reactively fixed for `getContent` by T-33 — `discardDraft` deletes, so writing the test ahead of the implementation this time instead of after a review found it missing.

T-35 was added by the slice 3 reviewer: `readFileWithSha` is wrapped in `try`/`catch` but `deleteFile` is not, so `discardDraft` rejects instead of returning its union.

### `list_content` — `src/services/list-drafts.ts`

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-22 | Listing drafts | unit | Fake listing `a.mdx`, `b.mdx`, `.DS_Store` and a `dir` under `drafts/writing` → `listDrafts` → `["a","b"]`, extensions stripped, the other two absent |
| T-23 | No drafts directory yet | unit | Fake throwing `GithubNotFoundError` for `drafts/project` → `{ ok:true, slugs: [] }`, **not an error**. It does not exist until the first draft of that kind is saved |
| T-23b | GitHub unreachable | unit | Fake throwing a plain `Error` → error result naming GitHub, nothing thrown |

### Through the MCP handler

| ID | Verifies | Type | Given → When → Then |
|---|---|---|---|
| T-25 | The new tools are advertised | mcp | — → `tools/list` → includes `save_draft` and `get_content`, each with a non-empty description and a `kind` enum of exactly `writing`/`project`; `list_content` and `get_skill` still listed |
| T-26 | `save_draft` answers | mcp | `tools/call save_draft {kind:"writing",slug:"a-post",metadata:{title:"x"},body:"..."}` → 200, text naming the path it was saved to |
| T-27 | A `save_draft` refusal is a tool result | mcp | `tools/call save_draft` on an already-published slug → `isError: true` with an actionable sentence; **HTTP status still 200** |
| T-28 | `get_content` hands back the sha | mcp | `tools/call get_content {kind:"writing",slug:"a-post"}` → 200, text carrying the metadata, the body **and the sha**. Without the sha the read-modify-write loop cannot close |
| T-29 | `discard_draft` is advertised and answers | mcp | `tools/list` includes `discard_draft`; `tools/call discard_draft` on an existing draft → 200, text confirming what was removed |
| T-30 | A `discard_draft` refusal is a tool result | mcp | `tools/call discard_draft` on a missing slug → `isError: true`; **HTTP status still 200** |
| T-24 | `state:"published"` is unchanged | mcp | `tools/call list_content {kind:"writing",state:"published"}` → the same catalogue text the tool returns today, from the site fake |
| T-31 | `state:"draft"` lists drafts | mcp | `tools/list` shows `state` on `list_content`; `tools/call list_content {kind:"writing",state:"draft"}` → 200, text listing the draft slugs |
| T-36 | `state` is required, not optional | mcp | `tools/call list_content {kind:"writing"}` with no `state` → `isError: true`; **HTTP status still 200** |

T-36 was added from mutation testing at Task 12: `state` is specified as required by A-3, and turning it `.optional()` in the schema left all 16 tests in the file passing — nothing proved it.

### Manual verification

Not automatable from inside this repo. Each closes a slice.

| ID | Verifies | Slice |
|---|---|---|
| M-1 | The write path against the **real** `workshop` repo, with the widened token: a scratch file is created, appears in GitHub attributed to the author (no bot), a re-write with a stale sha is rejected, a create over the existing path is rejected, and a delete removes it. **The two rejection status codes are recorded in this file in the same commit.** | 1 |
| M-2 | The read-modify-write loop on a real client: save a draft, see the file in `workshop`, `get_content` it, edit, save with the sha, see one file with the new content. Then save with a stale sha and watch it refuse. Driven at least once **from the phone** | 2 |
| M-3 | `discard_draft` on a real draft from a client; discarding a slug that is not there refuses | 3 |
| M-4 | `list_content` with `state:"draft"` returns the real drafts; with `state:"published"` it still returns the site's catalogue | 4 |

### Edge cases and failure modes

- **Empty metadata `{}`.** Renders as `{\n}` and round-trips — T-03. The one place the
  ADR's format needed a guard.
- **A body that is a JS code fence containing a bare `}`.** Safe by construction, because
  the block always comes first — T-04.
- **A metadata value containing a `}` or a newline.** Escaped by `JSON.stringify`. No test:
  it is a property of the platform, not of our code.
- **A hand-edited draft that stops parsing.** A loud refusal, never a guess — T-06, T-21.
  The accepted cost of choosing MDX over frontmatter (ADR-004 → Tradeoffs).
- **A draft with only a summary and no title.** Saved without complaint. Odd, and the
  author's business — validation belongs to `publish`.
- **`drafts/{kind}/` does not exist.** An empty list, not an error — T-23.
- **The site is down.** `save_draft` refuses; `get_content`, `discard_draft` and
  `list_content state:"draft"` are unaffected — they never touch the site.
- **A `sha` mismatch.** A refusal, never a retry — T-10. With one user this should never
  fire.
- **A slug that is a path.** Refused before any call — T-32.
- **Concurrent calls.** Still not a concern: one user, no shared state. The `sha` is the
  only concurrency control and it is GitHub's.
- **Authorization.** Still one user and one path secret. Unchanged by this slice.
- **A tool failure must never become an HTTP error.** Asserted in T-27 and T-30.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **1. The two write status codes are assumed.** 409 for a stale `sha` and 422 for a create over an existing path come from documentation, not from this API. Both `save_draft` refusals depend on telling them apart. | Both refusals fire on the wrong condition, or not at all — on the tool where a wrong outcome destroys a draft | **M-1 closes it in Task 2, before any service depends on it.** Record the real codes in this file in the same commit. Do not work around a difference inside the service. |
| **2. The delimiter depends on `JSON.stringify`'s indent.** Drop the `2` and the serializer emits one line with no `}` at column 0 — the reader then fails on the server's own output, and only on files written after the change. | Every draft saved after the change is unreadable. Silent until someone opens one | T-05 asserts the exact rendered text, so the format is pinned by a test rather than by a comment. `draft.ts`'s header says why the indent is load-bearing. |
| **3. The server can now delete files in `workshop`.** A confused tool call can destroy a draft committed nowhere else. | Lost work, with no diff to read on a phone | **The `sha` rules are the entire defence and there is no second layer** (ADR-004). `discard_draft`'s description says it cannot be undone. No undo, no trash, no history is built — git is the history. |
| **4. `save_draft` is now coupled to the site's availability.** A drafting tool refuses when `ashutoshverma.dev` is down. | The cheapest, most frequent tool stops working for a reason unrelated to drafting | Accepted in ADR-004 with reasons: it cannot prove a slug is free, and a draft that quietly shadows a published writing is worse. The refusal names the site so the cause is obvious. **Do not add a fallback.** |
| **5. A widened token that was never widened.** GitHub answers **404, not 403**, for a write a token may not make, so a still-read-only token looks exactly like a missing path. Spec 002's Risk 1, on the write path. | "Your token scope is wrong" arrives disguised as "no such draft" | M-1 is the check, and it runs before anything depends on the writer. The env format check cannot catch this — the token is valid, just narrow. Written here so the next reader is not surprised. |
| **6. This parser will look like the right tool for a `portfolio` MDX file.** It is not — those are hand-written JS object literals, and it would return `null` or plausible-looking wrong metadata. | A future slice reads a published post and gets a confident wrong answer | ADR-004 → Tradeoffs. Stated in `draft.ts`'s header comment, where the next person to reach for it will read it. Nothing is built to enforce it. |
| **7. A draft is written with no validation at all.** The model can save something `publish` will reject minutes later, with the text no longer in context. | A real cost, paid at the worst moment | Chosen deliberately — the alternative is two definitions of valid, which is worse. Not mitigated, and **must not be mitigated here**: adding a check is the exact thing the ADR rejected. |
| **8. Rate limits and cost.** Unchanged: ~15 tool calls a week against 5,000 an hour. | None | Stated so nobody builds a cache or a retry. `save_draft` costs two calls; the rest cost one or two. |

---

## Open questions

Resolve before Status becomes `approved`. Unanswered questions here are the most common
cause of a blocked task later.

Two are gaps in the ADR that this spec closes; five are assumptions the spec makes where
the ADR left room. **All seven need a yes or a different answer from the human.**

- [x] **G-1. Empty metadata breaks the ADR's delimiter.** `JSON.stringify({}, null, 2)`
      returns `{}` on one line, with no line that is exactly `}` — so the reader fails on
      the serializer's own output. `save_draft` accepts any JSON object, so `{}` is
      reachable through the tool's own contract. **This spec closes it** by writing `{\n}`
      in that one case (T-03). One line. The alternative — refusing empty metadata — is a
      required-field check, which the ADR forbids. **Confirm the guard.**

- [x] **G-2. The tool-description rule forces `get_content` into the `save_draft` slice.**
      Spec 001's rule is that a description may only name a registered tool.
      `save_draft`'s description and both of its refusal messages tell the model to call
      `get_content` — which, in the ADR's four-slice sketch, does not exist for two more
      PRs. The three ways out were: ship a temporary second wording (two "verbatim" texts),
      name a tool that is not there (breaks the rule), or **move `get_content` up into the
      `save_draft` slice** (5 files, still under the cap). This spec does the third. Writes
      still come before reads: `save_draft` is built first, `get_content` second, and
      `list_content`'s draft mode is still last. **Confirm the reorder.**

- [x] **A-1. Where the reserved-key drop lives.** ADR-004 says the three `mcp-design.md`
      serializer rules "are the serializer's, not the model's". This spec drops `show`,
      `order` and `readingTime` in the **`saveDraft` service**, not in `renderDraft`.
      Reason: the round trip `readDraft(renderDraft(m,b)) === {m,b}` is the
      highest-value test in the slice, and it only holds unconditionally if `renderDraft`
      is an exact inverse of `readDraft`. A stripping serializer would force T-01 to be
      stated as "…for metadata containing none of three special keys", which is a weaker
      property. The rule still holds end to end — no tool can set those three.
      **Alternative:** put the strip in `renderDraft` and weaken T-01.

- [x] **A-2. `saveDraft` calls the `listContent` service** for the published-slug check
      rather than fetching and parsing the site itself. It is the existing answer to "what
      is published", it already carries the site's schemas and the site error wording, and
      duplicating it would put a second copy of that parse in the codebase. Service calling
      service is sideways, not the downward skip `code-style.md` bans. **Alternative:**
      inline `site.fetchContent` + the schema parse in `saveDraft`, ~12 duplicated lines.

- [x] **A-3. `state` is required on `list_content`, not optional-defaulting-to-published.**
      A default means "list my writings" silently answers about published content when the
      user meant drafts, and on a phone an empty answer looks like a bug rather than a wrong
      question. The cost is that a model omitting `state` gets a validation error and must
      retry within the turn. **Alternative:** optional, defaulting to `"published"`, which
      keeps every existing `list_content` call valid.

- [x] **A-4. The slug format check is not in the ADR.** `isSlug` rejects anything that is
      not kebab-case before the slug becomes a path (T-32). Justification is
      [security.md](../../.claude/rules/security.md) — the slug is external input at a trust
      boundary, and the server can now write and delete in `workshop`. It is a check on the
      *argument*, not on the draft's content, so it does not conflict with "drafts are not
      validated". **Confirm it belongs in this slice.**

- [x] **A-5. Draft listings return slugs only**, with no titles. Reading a title out of
      every draft costs one API call per draft, and the slug is a kebab-case title.
      `get_content` reads one. **Alternative:** N reads per list call.

---

## Slice plan

Four slices, writes before reads, exactly as ADR-004 ordered them — with `get_content`
moved up into slice 2 for the reason in G-2. Each ships independently.

### Slice 1 — the format, and the ability to write

**Blast radius:** `src/lib/draft.ts` (new), `src/lib/github.ts` (modify), plus
`src/lib/draft.test.ts`. **Nothing under `src/services/` or `src/tools/`.** No new tool is
registered. No tool behaviour changes at all — this slice is invisible from the outside.

**Acceptance criteria**

1. `readDraft(renderDraft(m, b))` gives back exactly `m` and `b`, for metadata holding
   nested objects and arrays, for empty metadata, and for a body containing a line that is
   exactly `}`.
2. A metadata block that will not parse returns `null` and never throws.
3. The rendered file is byte-for-byte the shape in ADR-004's example: quoted keys, two-space
   indent, a closing line that is exactly `}`, a blank line, then the body.
4. Against the **real** `workshop` repo with the widened token: a file is created, updated,
   rejected on a stale sha, rejected on a create over an existing path, and deleted. The
   commit is attributed to the author, not a bot.
5. The two rejection status codes are written into `design.md`, whatever they turn out to
   be.
6. `lib/github.ts`'s header comment no longer says the token is read-only.
7. `portfolio` is still read-only, and nothing in the diff writes to it.

**Test IDs:** T-01, T-02, T-03, T-04, T-05, T-06, T-06b, M-1

### Slice 2 — save a draft, and read it back

**Blast radius:** `src/services/save-draft.ts`, `src/services/get-content.ts`,
`src/tools/save-draft.ts`, `src/tools/get-content.ts`, `src/tools/index.ts`, plus their
tests. **No changes to `list_content`, `get_skill`, `src/index.ts`, or the health check.**

**Acceptance criteria**

1. From Claude Code and **from the phone**: "save this as a draft" writes a real file to
   `workshop/drafts/writing/{slug}.mdx`, and the file opens cleanly in GitHub's web UI.
2. `get_content` on that slug returns the metadata, the body, and a sha.
3. Editing what came back and saving it with that sha leaves **one** file, with the new
   content. Not two files, not an appended one.
4. Saving with a stale sha refuses and says to re-read. Observed, not assumed.
5. Saving a slug that is already published refuses, and nothing is written.
6. With the site unreachable, `save_draft` refuses and says so.
7. A draft with only a title saves without complaint.
8. `show`, `order` and `readingTime` never appear in a saved file, even when supplied.
9. Every failure above still returns HTTP 200.

**Test IDs:** T-07, T-08, T-09, T-10, T-11, T-12, T-13, T-14, T-15, T-19, T-20, T-21,
T-25, T-26, T-27, T-28, T-32, **T-33**, M-2

### Slice 3 — throw a draft away

**Blast radius:** `src/services/discard-draft.ts`, `src/tools/discard-draft.ts`,
`src/tools/index.ts`, plus their tests. Small on purpose.

**Acceptance criteria**

1. From a client: discarding a real draft removes the file from `workshop`, and the commit
   is the only record of it.
2. Discarding a slug that is not there refuses and names it.
3. A draft whose metadata block is broken can still be discarded.
4. Nothing in `portfolio` is reachable from this tool.

**Test IDs:** T-16, T-17, T-18, T-29, T-30, **T-34**, **T-35**, M-3

### Slice 4 — list the drafts

**Blast radius:** `src/services/list-drafts.ts` (new), `src/tools/list-content.ts`
(modify), plus their tests. **`src/services/list-content.ts` is not touched** — that is what
makes "published behaves as it does today" provable from the diff.

**Acceptance criteria**

1. `list_content({ kind, state: "draft" })` returns the slugs actually in
   `workshop/drafts/{kind}/`.
2. A kind with no drafts directory yet returns an empty list, not an error.
3. `list_content({ kind, state: "published" })` returns exactly what it returns today.
4. The rewritten description is the specified text, verbatim.

**Test IDs:** T-22, T-23, T-23b, T-24, T-31, **T-36**, M-4

---

Slice 1 carries every unknown in this spec: the format, and whether the write path behaves
as assumed. It is also the only slice with a human step. Slices 2–4 are ordinary code that
depends on slice 1 and on nothing else — they do not depend on each other, so if slice 3 or
4 has to be reverted, the rest stands.
