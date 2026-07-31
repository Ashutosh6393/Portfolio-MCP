# ADR-004: Drafts are real MDX in `workshop`

- **Date:** 2026-07-31
- **Status:** accepted
- **Deciders:** Ashutosh Verma

> **Scope clarification, 2026-08-01:** Social posts (`kind: "post"`) are removed from scope. Drafts are for persistent storage of writings and projects only. Social posts are generated on-the-fly by the MCP using skills, not stored as drafts. ADR-004's decisions on metadata serialization, validation timing, and write access remain unchanged.

## Context

[Spec 002](../../specs/002-github-access/) is complete. The token works, `lib/github.ts`
reads both repos, the deep health check reports `github`, and `get_skill` was driven by
hand on Claude Code, claude.ai and the mobile app. Two of six tools are live.

[`mcp-design.md`](mcp-design.md)'s build order puts **cheap writes** next: `save_draft`,
`discard_draft`, and the draft reads that [ADR-002](002-github-access-and-workshop.md)
pushed down from the last slice — `list_content`'s `state` argument, `kind: "post"`, and
`get_content`.

This is the first slice that **writes** to GitHub, and the first that has to answer a
question every slice so far has dodged: **what is a draft, on disk?**

`mcp-design.md` answers it in two places that contradict each other:

> `save_draft` — Upsert into `workshop/drafts/{kind}/{slug}.mdx`
>
> **The server never parses MDX metadata. It only generates it.** Your files use
> `export const metadata = {...}` — a JS object literal. Parsing that out of a file needs
> a real JS parser and will bite you.

Both cannot hold. A published writing is read through the site's JSON routes, which import
the object and hand back `{ metadata, body }` — no parsing, which is why the rule survived
Slices 1 and 2 untested. **A draft has no such route.** The only copy is the file in
`workshop`, so `get_content({ state: "draft" })` reads back exactly what `save_draft`
wrote. If that file is MDX, something parses MDX metadata.

Constraints, all unchanged:

- One human user, ~15 tool calls a week. Scale is not a design input.
- The server never clones a repo. Every read and write is one GitHub API call.
- The token is a fine-grained PAT, currently **contents: read-only** on both repos.
- **The phone is the dangerous client** — no diff to read, a distracted user. Every
  refusal in the design exists for that case.
- No new dependency without an entry in [tech-stack.yaml](../../tech-stack.yaml) and an ADR.

## Alternatives

### What a draft file is

1. **YAML frontmatter and a body.** A `---` block, then the MDX. Splitting frontmatter is
   a few lines and no JS parser, and the file stays readable and hand-editable in GitHub's
   web UI. *Against:* it introduces a **second** metadata format. Every draft is then
   converted on the way to `portfolio`, so what is reviewed in the Vercel preview is not
   what was stored, and the conversion is a step that can be wrong.

2. **One JSON file** holding `{ metadata, body }`. Zero parsing — `JSON.parse` and done.
   *Against:* the body becomes an escaped single-line string. The draft stops being
   readable by a human, in the one repo whose entire purpose is holding work in progress.
   The same conversion problem as frontmatter, plus the file is unopenable on a phone.

3. **Two files per draft** — metadata as JSON, body as MDX. No parsing, both editable.
   *Against:* two reads and two writes per draft with no transaction between them. A
   half-failed `save_draft` leaves a body with someone else's metadata, and nothing
   detects it.

4. **Real MDX — `export const metadata = {...}` and the body, exactly as it will be
   published.** *For:* one format from draft to published. `publish` moves bytes instead of
   converting them, so the file reviewed in the preview build is the file that was saved.
   No second definition of what a post looks like. *Against:* reading a draft back means
   reading that block, which is the thing `mcp-design.md` forbids.

### How the block is read back, given 4

1. **A JavaScript parser** (`acorn`, `meriyah`, or Bun's transpiler). Correct for any
   input, including a file hand-edited into unusual shape. *Against:* a dependency and an
   ADR for one function, on a server whose whole GitHub client is `fetch`.
2. **`eval`, `new Function`, or a dynamic `import()` of the block.** Shortest possible.
   *Against:* it executes repository content inside the server process. Not a tradeoff —
   a hard no.
3. **A regex per field.** *Against:* breaks the first time a `summary` contains a `}` or a
   quote. Fails silently, with a plausible-looking wrong answer.
4. **Take the block's span and `JSON.parse` it** — which only works if the block is written
   in a shape JSON accepts. *Against:* a hand-edit that strays outside that shape stops
   parsing.

## Decision

**A draft is a real MDX file. The server writes the metadata block in a JSON-compatible
shape, so reading it back is a span and a `JSON.parse` — no parser, no dependency, no
`eval`.**

`mcp-design.md`'s "never parses MDX metadata" rule is **superseded**. Its reasoning —
parsing arbitrary JS needs a real parser — is correct and is not being argued with. What
changed is the input: **the server is not parsing arbitrary JS. It is reading back a file
it generated itself**, and it controls the shape at both ends.

The serializer emits quoted keys, JSON values only, and closes on a line that is exactly
`}`:

```mdx
export const metadata = {
  "title": "What CRDTs taught me",
  "summary": "A short one.",
  "date": "2026-07-31",
  "readingTime": "4 min"
}

The body starts here, plain MDX.
```

The reader takes everything between the first `{` and the first line that is exactly `}`,
and hands it to `JSON.parse`. That is the whole parser. The delimiter holds because the
same module wrote it.

Quoted keys are valid JavaScript and the site renders the file identically. They are
cosmetically unlike the hand-written posts already in `portfolio`; that is a `publish`
concern and is deferred to Slice 4, which re-renders the block from the parsed object
anyway.

**A draft whose block does not parse is an error, not a fallback.** The message says what
is true — the block was edited into a shape the server cannot read — and says to fix it in
GitHub or re-save the draft. It never guesses, and it never returns a body with empty
metadata.

The three serializer rules from `mcp-design.md` stand unchanged and are the serializer's,
not the model's: **no tool may set `show` or `order`**, omitted optionals are **absent
keys** rather than empty strings, and **`readingTime` is computed, never supplied**.

### Social posts

`kind: "post"` ships in this slice. **The server generates the id at save** — the date
plus a kebab label, `2026-07-31-crdt-lesson` — as `mcp-design.md`'s Identity section says.
Date-prefixed ids sort naturally and never collide, and a social post has no title and no
URL, so there is nothing for a slug to be derived from.

A post carries `platform` and no site metadata. It is never validated against
`api/schema.json`, because it is never rendered by the site.

### Drafts are not validated

`save_draft` writes what it is given. It does **not** fetch `api/schema.json` and does not
carry a copy of the site's schema.

`api/schema.json` was made mandatory precisely so there is **one** definition of a valid
post. A hand-written Zod copy in this server is the second definition that route exists to
prevent, and it drifts the first time the site adds a field. Fetching the real schema at
save time avoids the drift but puts a network call and a refusal on the cheapest, most
frequent tool — and `mcp-design.md` is explicit that `save_draft` is "no gate, cheap,
fast".

**Validation belongs to `publish`, which is the layer that already has to fetch the
schema.** A draft is allowed to be incomplete. That is what makes it a draft.

### Write access

The token gains **contents: read and write on `workshop` only**. `portfolio` stays
read-only until `publish` needs a branch. Set by hand with `fly secrets set`, as before —
it never passes through an agent or a file.

### Commit authorship

`mcp-design.md` says to set the commit author explicitly, "otherwise commits are
attributed to the bot and don't count on your contribution graph." **That rule is moot and
no code implements it.** It was written for the GitHub App that ADR-002 rejected. A
fine-grained PAT *is* the user, so the API already attributes commits correctly with no
`author` field sent.

## Tradeoffs

- **A hand-edited draft can stop parsing.** Fix a typo in GitHub's web UI, drop a quote or
  leave a trailing comma, and `get_content` refuses that draft until it is corrected. This
  is the real cost of choosing MDX over frontmatter, and it is accepted for one reason:
  the failure is **loud and specific**, not a silently wrong metadata object. The frontmatter
  option had no such failure mode.
- **Quoted keys in the metadata block.** Correct, renders fine, and unlike every existing
  post on the site. Deferred to `publish` rather than solved here.
- **The "never parses MDX metadata" rule is gone**, and with it a guarantee that was easy
  to check. What replaces it is narrower and needs stating every time: *the server parses
  only metadata blocks it generated.* If a future slice ever reads an MDX file from
  `portfolio` — one a human wrote — this parser is the wrong tool and will look like the
  right one.
- **The server can now write to `workshop`.** A confused tool call can destroy a draft that
  was never committed anywhere else. The `sha` rules are the entire defence and there is no
  second layer, no undo, no trash.
- **`save_draft` needs a published check**, so it takes the site reader as well as the
  GitHub reader — the first service depending on both. If the site is down, `save_draft`
  cannot prove a slug is unpublished and must refuse. A drafting tool is now coupled to the
  site's availability, which it was not before.
- **A draft is written with no validation at all.** The model can save something that
  `publish` will reject minutes later, with the text no longer in context. Chosen
  deliberately — the alternative is two definitions of valid, which is worse — but it is a
  real cost paid at the worst moment.

## Consequences

### Corrections owed when this is accepted

- **`mcp-design.md`'s Metadata handling section is now false.** Its first line — "The
  server never parses MDX metadata. It only generates it." — is superseded here. Corrected
  in place with a pointer, the same treatment ADR-002 gave the Runtime section.
- **`mcp-design.md`'s Runtime section, point 1** ("Set the commit author to your own name
  and email") is moot under a PAT. Corrected in place.
- **ADR-002's Consequences said "no base64 decoder exists or is needed."** That was true
  for `get_skill`, which reads with `Accept: application/vnd.github.raw`. Reading a draft
  needs its `sha` in the same call, and the `sha` only comes back on the JSON response,
  whose `content` is base64. **One decode line returns.** An amendment recorded here, not a
  new ADR — ADR-002's actual decision is untouched.

### New obligations

- **`lib/github.ts` gains write methods and a read that returns `{ content, sha }`.**
  Its header comment currently says "no writing (the token is read-only)". That line ships
  false the moment this lands and is fixed in the same commit.
- **`list_content` changes for the first time.** It gains a `state` argument and `post`
  joins its `kind` enum. Its description is rewritten, not patched — the model is the real
  caller. Note the hole in the matrix: `{ kind: "post", state: "published" }` reads
  `workshop/posts/published/`, not the site, because the site never renders a post.
- **Four tool descriptions get written** — `save_draft`, `discard_draft`, and the rewrites
  of `list_content` and `get_content`. Specified in the spec, not invented by whoever
  writes the file. This closes most of `mcp-design.md`'s open item 3.
- **`discard_draft` needs a `sha`**, so it reads before it deletes. There is no
  delete-by-path in the contents API.
- The token's scope change is a **human prerequisite**, provable by no test in this repo —
  the same shape as P-2 in spec 002.

### Testing seams

No new injected seam. Services take their dependencies as an argument, `createApp` and
`createHandler` already require them, and tools are exercised through the MCP handler.

One new seam of a cheaper kind: **the serializer and the reader are pure functions** in
`lib/`, tested directly with no injection. The test that matters is the **round trip** —
`read(render(m)) === m` — plus the hand-edit cases that must fail loudly. This is the
highest-value seam in the slice and the only genuinely new logic in it.

The GitHub writer is still not unit-tested against a mock of GitHub, for the reason
[testing.md](../../.claude/rules/testing.md) gives.

### Proposed slices

A sketch for `to-spec` to refine. Writes come before reads because there is nothing to
read until something writes it.

1. **The serializer, and write access.** `lib/`'s render and read pair, plus the token
   scope change. No new tool. The round-trip tests live here.
2. **`save_draft`.** Service, tool, registration, and the `sha` refusals.
3. **`discard_draft`.** Small on purpose — read for the `sha`, delete, refuse if absent.
4. **The reads.** `get_content`, `list_content`'s `state` argument, and `kind: "post"` in
   both.

Four rather than two: slice 1 is the only part with a human prerequisite, and the git
rules cap a PR at 5–7 files. `save_draft` alone is a service, a tool, a registration, and
its refusals.

### Out of scope

Deliberately, so nobody picks them up:

- **`publish`** — validation, `api/schema.json`, MDX body parsing, branches, PRs,
  idempotency, `revise`. Slice 4, unchanged.
- **Write access to `portfolio`.** The token stays read-only there. It arrives with the
  tool that opens a PR.
- **Lazy reconciliation** — checking whether a draft's PR merged and moving it to
  `archive/`. `mcp-design.md` hangs it off `list_content`, but there are no PRs until
  `publish` exists. Slice 5.
- **The `get_skill` response nudges** and the Claude Project. Slice 5.
- **The `show` / `order` carry-over on a `revise` publish.** A `publish` hazard.
- **Any undo, trash, or draft history.** Git is the history.
