# Portfolio MCP Server — Design

Settled in a grilling session. Twenty decisions, each with the reason it was chosen,
so you don't re-argue them in three weeks.

---

## What it does

One remote MCP server that lets you read, draft, and publish content on
`ashutoshverma.dev` from Claude Code, Claude Desktop, claude.ai, or your phone.

---

## The three repos

| Repo | Visibility | Holds | Server's access |
|---|---|---|---|
| `portfolio` | public | published MDX, the site itself | opens PRs, never commits to main |
| `workshop` | **private** | drafts, skills, templates, social post archive | commits straight to main |
| `mcp-server` | either | the server code | — |

Why `workshop` is private: drafts and unpublished takes would otherwise sit in
public git history forever. Also, a push to `portfolio` wakes Vercel up — you
don't want failed builds for posts you never meant to deploy.

**The server never clones a repo.** Every read and write goes through the GitHub
API. A checkout on disk means stale state and surprise merge conflicts.

---

## Runtime

- Always-on Bun process on Fly.io, from a Dockerfile. (Runtime and host decided in
  [ADR-001](001-server-runtime-and-shape.md); this line said "Node process on Fly or
  Railway" before that.)
- Streamable HTTP MCP.
- Auth: unguessable secret in the URL path — `https://mcp.ashutoshverma.dev/k7f2.../mcp`
- GitHub credential: a **GitHub App** installed on `portfolio` and `workshop`.
  Permissions: contents write, pull requests write. Mint installation tokens on
  demand, cache for the hour.

Two things to get right:

1. **Set the commit author to your own name and email** in every API write.
   Otherwise commits are attributed to the bot and don't count on your
   contribution graph.
2. Custom connectors are reached from Anthropic's cloud, not your device — even
   in Claude Desktop. The server must be publicly reachable. No localhost, no
   tunnels.

If the "request headers" field shows up in your Add-connector dialog, add a
bearer token check as a second credential. It's five lines. It's in beta, so
don't depend on it.

---

## Site prerequisites (build these first)

The server is a separate codebase from the thing that renders your posts. These
routes are what keep the two from drifting.

| Route | Returns |
|---|---|
| `api/writing/content.json` | every writing: title, slug, date, summary |
| `api/projects/content.json` | every project: title, slug, summary, stack, status |
| `api/writing/{slug}` | `{ metadata: {...}, body: "...", }` — body is raw MDX **without** the metadata block |
| `api/projects/{slug}` | same shape |
| `api/schema.json` | JSON Schema, generated from the site's own Zod schema |

`api/schema.json` is **mandatory**, not nice-to-have. The server fetches it and
validates against it. It's the only thing stopping two definitions of "valid
post" from diverging.

Also add OG image generation with `@vercel/og`, from title + stack. No uploaded
assets needed.

---

## Metadata handling

**The server never parses MDX metadata. It only generates it.**

Your files use `export const metadata = {...}` — a JS object literal. Parsing
that out of a file needs a real JS parser and will bite you. So:

- Writes take metadata as **typed tool arguments** and render the export block
  from a template.
- Reads get metadata as JSON from the site's API routes, which already import
  the object.

Two hard rules in the serializer:

1. **Never let a tool set `show` or `order`.** Those decide what's featured on
   your homepage. A model that just wrote a post is the worst possible judge of
   whether it belongs on your front page. You add those by hand.
2. Omitted optionals must be **absent keys**, not empty strings. Your own
   comment says "omit the key entirely if none" — a naive serializer writes
   `repo: ""` and your site renders a dead link. Filter undefined before
   serializing.

**Settled.** Writings have a date; projects don't. There are **no tags** — this document
guessed at them, and nothing on the site renders one. The site's Zod schemas are the
definition, and `z.strictObject` gives `additionalProperties: false`, which is what makes
"a tool can never set `show`" a fact rather than a rule someone remembers. See
[`portfolio-implementations.md`](../portfolio-implementations.md).

---

## The six tools

The model does the writing. **Tools only move bytes.** There is no tool that
generates a post — drafting is `get_skill` then `save_draft`. Keeping that
straight is what stops the tool list from doubling.

### 1. `list_content({ kind, state })`
`kind`: project | writing | post. `state`: published | draft.
Published reads hit the site's JSON routes. Draft reads hit the GitHub API.

Also does **lazy reconciliation**: for each draft carrying a PR number, check if
that PR merged; if so, move the file to `workshop/archive/`.

### 2. `get_content({ kind, slug })`
Returns `{ metadata, body, sha }`. The `sha` matters — see concurrency.

### 3. `get_skill({ name? })`
No name returns the list. Returns the skill instructions **and** its template
together — a template with no instructions is a mystery, and a skill without its
template is incomplete. Templates are not a separate tool.

### 4. `save_draft({ kind, slug, metadata, body, sha? })`
Upsert into `workshop/drafts/{kind}/{slug}.mdx`. No gate, cheap, fast.

- With `sha`: GitHub rejects the write if the file changed underneath. Return
  "this draft changed since you read it; re-read and reapply."
- Without `sha`: **create only, never overwrite.** To overwrite you must have
  read first. That's the property you want.
- Fails loudly if the slug is already published.

### 5. `publish({ kind, slug, revise? })`
For projects and writings:

1. Fetch `api/schema.json`, validate metadata.
2. Parse the MDX so a stray `<` fails now, not at build time.
3. Check the slug doesn't already exist (unless `revise: true`).
4. Open a PR on `portfolio` from branch `publish/{kind}/{slug}`.
5. Record the PR number in the draft file.
6. Return the PR URL.

For social posts: write to `workshop/posts/published/{id}.md`, record date and
platform, return the text for you to copy.

### 6. `discard_draft({ kind, slug })`

---

## The publish gate

**Server opens a PR. You merge it.** The merge button is somewhere the model
cannot reach — that's the only kind of gate that holds.

Vercel builds a preview deploy per PR, so your check is *reading your own post
on a real page*, not squinting at raw MDX. You can merge from the GitHub app on
your phone.

Validation runs in two layers: the schema catches 95% with an error message the
model can act on, and the preview build catches the rest (broken imports,
missing components). You need both, because the server can't know your
component list without duplicating it.

---

## Identity

- **Projects and writings**: kebab-case slug from the title, chosen at
  `save_draft`, **immutable after publish**. The slug is the URL.
- **Social posts**: server-generated `2026-07-30-crdt-lesson`. Date-prefixed
  ids sort naturally and never collide.

Three rules from immutability:

1. `save_draft` on a published slug fails loudly.
2. `publish` needs explicit `revise: true` to touch an existing post. The server
   must **not** quietly infer "this slug exists, must be an edit." That's how a
   half-finished draft flattens a good post from March.
3. Renaming isn't a tool. New URL means doing it by hand plus a redirect.

The phone is the dangerous client — you can't see the diff and you're probably
distracted. The refusals are the safety net.

---

## Idempotency

`publish` will get called twice. Slow response, network blip, model retry, or
you saying "publish it" again because nothing confirmed.

- Branch name is always `publish/{kind}/{slug}` — no timestamps, no suffixes.
- Branch + open PR exist → **update the branch, return the same PR.** Say
  "updated PR #12", not "created".
- PR already merged → refuse unless `revise: true`.
- Branch exists, PR closed unmerged → recreate, and say so.

Side effect worth having: iterating on a post five times from your phone still
leaves exactly one PR to review.

---

## Making skills actually get used

The failure to expect: in the mobile app there's no skill system, just six
tools. You say "write a LinkedIn post about the CRDT thing" and the model writes
in generic LinkedIn voice, never calling `get_skill`. The server works fine and
the output is worse than before.

Two nudges, because one won't hold:

1. **Steer from tool responses.** End every `list_content` and `get_content`
   response with: *Before drafting any post, call `get_skill` first — it carries
   the required voice rules.* Descriptions get skimmed once at the top of a long
   context. A response lands exactly when the model is deciding what to do next.
2. **A Claude Project for writing** on claude.ai, with "always call `get_skill`
   before drafting" in its custom instructions. Projects sync to mobile.

If you catch it drafting cold anyway, add a hard gate: `save_draft` refuses to
be the first write tool of a session.

---

## Failure visibility

- **Errors are tool results, not HTTP 500s.** A thrown error gives the client a
  bare "tool failed" and the conversation dead-ends. A returned error string
  lands in context, so the model can fix it and retry in the same turn.
- **Two `/health` routes.** `GET /health` returns 200 and does no I/O — that is Fly's
  liveness probe. `GET /{secret}/health` really checks: can it mint a GitHub App token,
  can it fetch `schema.json`, can it reach both repos. One URL on your phone tells you
  which layer is dead. The deep one sits behind the secret because a public endpoint
  making three outbound calls per request is unauthenticated and expensive at once.
- Platform logs are enough.

---

## Build order

Plumbing before anything interesting.

- **Slice 0 — site prep.** All the API routes above, OG images, and move your
  skills into `workshop`.
- **Slice 1 — plumbing only.** Server skeleton, secret path auth, both `/health` routes
  with the site check only, and one read tool against the site's **live** JSON routes.
  Deploy to Fly. Connect from Claude Code, claude.ai, and your phone. Read a published
  post back on each. No GitHub, so nothing external blocks it.
- **Slice 2 — GitHub arrives.** Create the private `workshop` repo, install the GitHub
  App on it and on the site repo, then `get_skill`, draft reads, and `/health`'s
  remaining two checks. This is the first slice with an external prerequisite.

  > Slice 1 originally carried `get_skill`, which reads from `workshop` — a repo that
  > did not exist yet. That tied the cheapest and riskiest experiment to setup it does
  > not need. Reordered in [ADR-001](001-server-runtime-and-shape.md).
- **Slice 3 — cheap writes.** `save_draft`, `discard_draft`.
- **Slice 4 — publish.** Validation, branch, PR, idempotency.
- **Slice 5 — polish.** Lazy reconciliation, response nudges, Claude Project.

The riskiest unknown in the whole plan is whether a custom connector behaves
properly in the mobile app. You can't work around it and you can't test it
locally. Find out on day one with 80 lines of code, not after building six tools
against MCP Inspector.

---

## Rejected, and why

Keep this list. It's cheaper than re-arguing.

| Rejected | Why |
|---|---|
| Database or Notion as the CMS | Site already renders MDX; git gives free history, diffs, rollback |
| Separate local stdio server for Claude Code | Drafts need shared state; two code paths means every bug is "which one?" |
| Confirmation-token publish gate | Security theatre — the model receives the code and repeats it back |
| Relying on the client's "Allow this tool?" prompt | You'll hit "always allow" in a week, and on a phone you can't see the body |
| Full OAuth 2.1 | OAuth's job is telling many users apart. You have one user. |
| Auto-posting to LinkedIn | `r_member_social` is granted to select developers only, so you need your own archive anyway. Tokens die every 60 days, silently. Manual posting is where you add the image, tag people, pick the hour. |
| Auto-posting to X | Free-tier write access is thin, terms move around |
| Search over your posts (BM25, embeddings, hybrid) | ~40 posts. The whole index fits in one tool response. Retrieval earns its keep in the thousands. That's CodeWalk's job. |
| Per-platform tools (`draft_tweet`, `draft_linkedin_post`) | Identical code, different string. The difference lives in the skill text. |
| More than two draft states | Every extra state is a rule you must remember at 11pm on your phone |
| A merge webhook | Second endpoint, shared secret, fails silently when you change hosts |
| Sentry / OpenTelemetry | One user, ~15 calls a week, and you're present for nearly every failure. Tracing pays off when nobody's watching. |
| An image upload flow | Your posts have no images, only diagrams — and tool arguments are text, so bytes can't get through anyway |

---

## Open items

1. ~~Metadata shape for writings/blogs.~~ Settled — see Metadata handling above.
2. ~~Whether `mcp-server` is public or private.~~ Settled — **public**, at
   `Ashutosh6393/Portfolio-MCP`. Secrets are env vars.
3. Exact wording of the six tool descriptions. Worth drafting carefully; it's
   the only thing the model reads before deciding what to call. **Still open.**