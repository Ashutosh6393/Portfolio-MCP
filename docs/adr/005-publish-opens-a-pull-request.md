# ADR-005: `publish` opens a pull request on `portfolio`

- **Date:** 2026-08-03
- **Status:** accepted
- **Deciders:** Ashutosh Verma

## Context

[Spec 004](../../specs/004-drafts/) is complete. Five of the six tools are live —
`list_content`, `get_content`, `get_skill`, `save_draft`, `discard_draft` — and a draft
can be written, re-read, edited and thrown away from a phone. The suite is 90 green.

What is missing is the last one and the only one that reaches the public repo.
[`mcp-design.md`](mcp-design.md) sketches it in six steps: validate the metadata against
the site's schema, parse the MDX, check the slug, open a PR from
`publish/{kind}/{slug}`, record the PR number, return the URL. That sketch was written
before the site existed. Three of its six steps do not survive contact with what actually
shipped, and a fourth is a bug.

Four constraints were checked live before this ADR rather than assumed:

**The write schema is small.** `api/schema.json` returns two draft-2020-12 documents. A
writing requires `title`, `date`, `readingTime`, `summary`. A project requires `title`,
`summary`, `stack`, and optionally `status` (an enum), `repo` and `demo` (both URIs).
Between the two of them they use ten keywords — `type`, `properties`, `required`,
`additionalProperties`, `minLength`, `minItems`, `items`, `enum`, `format`, `pattern` —
with no `$ref`, no composition, and no nesting past one array of strings.

**Both live projects are featured.** `scaffold-ai` and `yapper` each carry `show: true`
and an `order`. Both keys are **absent from the write schema**, which is
`additionalProperties: false`, and `save_draft` already strips them from every draft. So a
naive `revise` renders a file without them and silently drops the project off the
homepage. Writings have no `show`/`order` at all — this is a projects-only hazard.
`content.json` returns both keys, which
[`portfolio-implementations.md`](../portfolio-implementations.md) kept deliberately so the
server could reach them, and `list_content` already surfaces them today.

**Every existing post was published by hand.** No draft exists in `workshop` for any of
them, and `get_content` reads drafts only. There is currently no path from a phone to
revising anything already on the site.

**`portfolio` is read-only to the server**, and always has been. That single fact — not
any code in this repo — is what has made *"never commits to main"* true for four slices.

## Alternatives

Considered at the shape level, before the individual decisions below.

1. **Validate with a JSON Schema library (`ajv`)** — correct on every keyword forever,
   including ones the site has not used yet. Costs a `tech-stack.yaml` entry, a
   transitive dependency tree, and a code-generation step whose behaviour under Bun is
   unverified. Rejected: it buys correctness on nine keywords that do not appear in the
   document being validated.
2. **Validate nothing in the server** — open the PR and let the Vercel preview build
   fail, since the site's own Zod runs at build time. Zero code. Rejected: the model
   learns it was wrong minutes later on a page it has to navigate to, and
   [`CONTEXT.md`](../../CONTEXT.md) names *"errors it can act on in the same turn"* as the
   model's whole interface.
3. **Keep `mcp-design.md`'s six steps as written** — rejected on three counts, each
   recorded as a decision below.

## Decision

Seven decisions, settled in a grilling session on 2026-08-03.

### 1. A schema interpreter in `lib`, not a dependency

`publish` fetches `api/schema.json`, selects `schema[kind]`, and walks it with a small
interpreter that handles the ten keywords the document actually uses.

This is still **one definition of valid**. The interpreter reads the live document; it
does not restate it. A hand-written Zod copy of the site's rules would be the second
definition ADR-004 already refused for drafts, and is not what this is.

**An unknown keyword is a refusal, never a skip.** If the site adds `maxLength` or a
`$ref` tomorrow, `publish` must say it cannot check the metadata rather than quietly pass
a post it did not fully validate. That inverts the usual failure of a partial validator —
the gap becomes loud instead of silent, and the fix is one branch in a function.

### 2. No MDX parse

`mcp-design.md`'s step 2 is dropped. It exists to catch a stray `<` before build time,
and the only way to do it properly is an MDX compiler, which brings back the `acorn`
family ADR-004 banned by name.

The step also does not stand on its own: it cannot catch a broken import or a missing
component, so the Vercel preview build remains mandatory either way. It buys one class of
error that the build already catches, at the cost of reversing a dependency ban. A
heuristic was considered and rejected on inspection — the posts are technical, so `a < b`
and `Map<string, Node>` appear in ordinary prose, and a false refusal on a correct post is
worse than a red check on a PR nobody has merged.

### 3. `kind` stays `writing | project`

`mcp-design.md` gives `publish` a second job: archiving a social post to
`workshop/posts/published/{id}.md`. It is dropped from this ADR.

That path shares nothing with the PR path — different repo, no schema, no branch, no PR,
no slug, a different id scheme. Merging them puts two unrelated behaviours behind one tool
whose description has to explain both to the model. It also reopens ADR-004's explicit
*"do not add a `post` kind, not to the enum, not to the path, not for later."*

The post archive is not cancelled, only unbuilt. It gets its own ADR if it is still wanted
once posts are being drafted regularly.

### 4. `show` and `order` are asked for, every time, and stated in the PR body

`show` and `order` are **required arguments** on `publish` when `kind` is `project`. They
are supplied by the human, relayed by the model, and never computed, defaulted or carried
over. Writings have neither key, so the arguments do not apply there.

One rule for every project publish, create and `revise` alike. There is no branch and no
silent path — the case where a value moves without anyone deciding it is exactly what this
removes. `list_content` already returns both keys for projects, so the model reads the
current values first and offers them back rather than asking cold: *"it is `show: true`,
`order: 2` today — keep that?"* Answering is one word.

They are attached **after** validation and **before** the file is rendered. The ordering is
load-bearing in both directions: attach first and validation fails, because the write
schema is `additionalProperties: false` and omits both keys; skip the attach and a featured
project leaves the homepage.

**The tool arguments are the nudge. The PR body is the guarantee.** The server cannot see
the conversation, so it can never verify the question was asked — a required argument
forces the model to have a value, not to have obtained it honestly. So the PR body leads
with what was supplied, in words:

```
-> ashutoshverma.dev/project/yapper
   This URL is permanent after merge.

   Homepage: show: true, order: 2
   Supplied, not computed. Fix them in this diff before merging if wrong.
```

That places the last check at the merge button, which is the one gate in this design that
actually holds. It is also the check that works on a phone, where the diff is unreadable
but two lines of prose are not.

This narrows `mcp-design.md` rule 1 rather than breaking it. The rule's reasoning is *"a
model that just wrote a post is the worst possible judge of whether it belongs on your
front page"* — and it still never judges. What changes is that "you add those by hand" now
means answering a question, with the rendered value shown back to you at the gate, instead
of editing the file yourself.

**The rejected alternative was the previous version of this decision:** read the live
values from `content.json` and re-attach them silently. It is less code and it never asks
you anything, but it makes featured status unchangeable through the tool, and it restores
the silent path in the one case — `revise` on a live project — where a wrong value moves
something real.

### 4b. The slug is confirmed at the same gate

The slug is chosen at `save_draft`, not here — it is the draft's filename, and it has been
a required argument since spec 004. So there is nothing to make required. What changes is
its description: **the slug is the permanent URL, and if the human has not named one, ask
— do not derive it from the title.**

That is a nudge with no enforcement, for the same reason as above, so it is backed at the
same gate: the PR body leads with the live URL and says it is permanent after merge.
Nothing is fixed until the merge, so a wrong slug is still free to fix — `save_draft`
under the right one and `discard_draft` the old, two calls that already exist.

Detecting the mechanical derivation — refusing when the slug is exactly the kebab-cased
title — was considered and rejected. That is very often the slug a human would genuinely
choose, including `how-agents-remember-things` on the live site today, so it would refuse
the correct answer most of the time. Same false-positive failure as the MDX heuristic in
decision 2.

### 5. The PR is found by branch name, never recorded

`mcp-design.md`'s step 5, *"record the PR number in the draft file"*, is dropped. The
branch name is already deterministic — `publish/{kind}/{slug}`, no timestamps, decided for
idempotency — so GitHub can be asked directly which PR has that head.

Recording it is not merely redundant, it is a bug. Writing the number back into the draft
changes the draft's `sha`. The model is holding the `sha` `get_content` gave it, so its
next `save_draft` is refused with *"this draft changed since you read it"* — for a change
the server made, to a file the user never touched. The recovery is a re-read the user
cannot understand the reason for.

Not recording also means nothing new has to survive the `renderDraft`/`readDraft` round
trip, and Slice 5's lazy reconciliation gets cheaper: one call lists every open PR on
`portfolio` and matches by branch, rather than one call per draft.

### 6. Two independent checks decide "already published"

`content.json` answers *is this slug live on the site*. The branch query answers *is there
work in flight*. Both run, because each covers the other's blind spot:

- A PR merged in the last few minutes is **not** in `content.json` yet — the route is
  statically prerendered and waits on a Vercel redeploy. The branch query catches it.
- A post published by hand has no branch and no PR at all. `content.json` catches it.

`revise: true` is required if either says the slug is taken. The four branch/PR states in
`mcp-design.md` — create, update the open PR, refuse on merged, recreate on closed — are
kept exactly as written; nothing here re-opens them.

### 7. `get_content` gains `state`, and the revise path becomes ordinary

`get_content` takes `state: "published" | "draft"`, mirroring `list_content`, which has
carried that argument since spec 004. A published read hits the site's `api/{kind}/{slug}`
route — built in Slice 0, prerendered, and never called by anything since.

Revising then needs no special case anywhere: `get_content` published → edit →
`save_draft` → `publish({ revise: true })`. Four calls the model already knows, in an
order it already uses for drafts.

The alternative — `publish` seeding the body from the live post when no draft exists — was
rejected. It republishes text nobody has looked at, which is precisely the shape of
accident the publish gate exists to prevent.

### 8. `portfolio` becomes writable, and a ruleset carries the guarantee

The token is widened to `contents: write` on `portfolio`. There is no narrower option:
GitHub grants committing to `main` and opening a PR through the same permission, and a
fine-grained PAT cannot be scoped to a branch.

So the guarantee moves. **A ruleset on `portfolio`'s `main` — require a pull request,
block force pushes, restrict deletions — is what makes "never commits to main" true from
here on.** It is enforced by GitHub, holds regardless of what this code does, costs one
setting, and is free on a public repo. The merge button was never reachable by the token
and still is not.

Alongside it, the deferred item raised in slices 1, 2 and 3 is finally closed: the write
functions stop accepting an arbitrary repo. Each of those slices deferred it for the same
stated reason — no live caller yet forced the narrowing. This is that caller, and it
writes to the public repo.

`readingTime` is computed by the server from the body at publish time — words ÷ 200,
rounded up, `{n} min` — as a pure function in `lib` beside the existing draft format. It
is a fact about the text, not an opinion about it, and a model asked for one guesses.

## Tradeoffs

**The interpreter is a validator we own.** A JSON Schema library is somebody else's
correctness problem; this one is ours, and it will be wrong on some keyword eventually.
The refuse-on-unknown rule is what bounds the damage — it converts "wrong" into "refuses",
which is recoverable. The wager is that ten keywords with no composition stay ten
keywords, and that wager is re-examined the first time the refusal fires.

**A syntax error now costs a round trip.** Dropping the MDX parse means a stray `<` is
found by Vercel, not by the tool, so the correction happens on a PR page rather than in
the conversation. Accepted because the build was always going to be the real check.

**Every project publish now costs a question.** Two values must be answered even when
nothing about the homepage is changing, which is most of the time. The mitigation is that
the model reads the current values first and offers them back, so the honest answer is
usually "keep it" — but it is still a turn that a silent carry-over would not have needed.

**A required argument proves nothing.** The model must have a value for `show`; it does not
have to have asked for one, and no code here can tell the difference. If it invents one on
a phone, the only thing between that and a moved project is you reading two lines of the PR
body before merging. That is a genuine reliance on a human doing a small thing correctly,
and it is stated plainly rather than dressed up: the argument is a nudge, the merge gate is
the guarantee, and there is nothing in between.

**The PR body becomes load-bearing.** It is now the last place a wrong slug or a wrong
homepage value can be caught, which makes its wording part of the product in the same way
the tool descriptions are. A future edit that "tidies" it into a terse summary removes a
safety layer without touching a line of logic.

**`portfolio` is writable now, and it stays writable.** This is the single largest
increase in blast radius in the project, and it does not shrink again. Nothing but the
ruleset stops a bug from committing to `main`, and the ruleset is a setting on a website —
outside this repo, unversioned, and invisible to `bun test`.

**`get_content` grows a second data source.** It reads from the site or from GitHub
depending on an argument, which is exactly the shape `list_content` already has, so the
inconsistency would have been in *not* doing it. The cost is real either way: one more
tool where a failure has two possible origins.

## Consequences

**Requires, before the slice ships:**

- The GitHub token widened to `contents: write` on `portfolio`. Set by hand, as a Fly
  secret, exactly as the `workshop` widen was in spec 004.
- The ruleset on `portfolio`'s `main`. **This is a prerequisite, not a follow-up.** It is
  the only enforcement of the project's central safety claim, and once the token is
  widened there is a window in which nothing enforces it at all.

**Enables:** a post going from a phone to a Vercel preview URL with no laptop, which is
the outcome `CONTEXT.md` defines as success. Also the first live use of the site's
`api/{kind}/{slug}` route, and a revise path for the posts already on the site.

**Forecloses:** adding a JSON Schema library later without explaining why the interpreter
failed. Storing anything publish-related inside a draft file. Treating `content.json` as
the sole authority on what is published.

**New obligation:** `api/schema.json` becomes load-bearing at runtime, not just at build
time. `publish` cannot run without it, so `/{secret}/health` gains its `schema.json`
check — the third and last of the three checks `mcp-design.md` planned, each arriving with
the slice that needs it.

**Touches an existing tool's description.** `save_draft`'s description gains the slug
instruction (decision 4b). That text is specified verbatim in
[spec 004](../../specs/004-drafts/), and nothing asserts it in a test, so the two must be
changed together or they drift silently. It is the first time this project edits a shipped
tool description.

**Makes `list_content` a soft prerequisite of a project publish.** Nothing enforces the
ordering, but a model that publishes a project without reading the current `show`/`order`
first has to ask you cold, which is a worse question than the one it could have asked.

**Does not change:** the publish gate. The server opens a PR and a human merges it. No
tool in this repo merges anything, and the token cannot.

## Testing seams

The existing seams are enough. No new one is introduced.

- **The schema interpreter is pure** — a schema document and a metadata object in, a list
  of error strings out. It is the highest-value test in the feature and needs no fake, no
  network and no fixture file. It follows `lib/draft.ts`, which is already the precedent
  for a pure `lib` module.
- **`readingTime` is pure.** Same seam.
- **The publish service takes `deps` as an argument**, as every service here does, and is
  tested with fake `github` and `site` object literals. Every branch of the idempotency
  matrix and every refusal is reachable that way.
- **The PR body is asserted, not eyeballed.** It carries two safety statements now
  (decisions 4 and 4b), so a test pins that the rendered body names the live URL and the
  supplied `show`/`order`. Tool description text in this project has always been
  review-only, and every slice so far recorded that as a drift risk — this is the one piece
  of prose worth breaking the pattern for, because a human reads it at the gate and nothing
  else catches a wrong slug after merge.
- **The new GitHub methods are not unit-tested.** They are a thin wrapper over someone
  else's API, and `testing.md` is explicit that testing one against a mock of that API
  tests the mock. They are proven by a manual verification against the real repos, as the
  `workshop` write path was in spec 004 — including the one thing no test can assert:
  that a push to `main` is refused by the ruleset.
- **The tool is tested through the MCP handler**, never by calling the function.

## Proposed slices

A sketch. `to-spec` refines it.

1. **The interpreter and `readingTime`.** Two pure `lib` modules, no caller. Invisible
   from outside, and the riskiest reasoning in the feature closed first against the real
   fetched schema.
2. **`get_content` reads published content.** One argument on an existing tool, one new
   `site` method. Independently useful — it is how you read your own post back on a phone
   — and it unblocks the revise path without touching `portfolio` at all.
3. **The PR path.** The token widen, the ruleset, the narrowed write signature, the new
   GitHub methods, and `publish` for the create case only. The first slice that writes to
   the public repo.
4. **Idempotency and `revise`.** The four branch/PR states and the two published checks.

The `show`/`order` arguments and the PR body wording belong to slice 3, not slice 4 — they
are required on a first publish, not only on a revise, so the create path cannot ship
without them.

Slice 3 carries the external prerequisites and all of the new risk. Slices 1 and 2 are
deliberately ahead of it so that nothing is waiting on a setting in a browser.

## Out of scope

- **The social post archive** — decision 3. Needs its own ADR.
- **Lazy reconciliation** — archiving a draft once its PR merges. Slice 5 of
  `mcp-design.md`, unchanged.
- **The response nudges** and the Claude Project. Also Slice 5.
- **Merging anything.** Permanently, by design.
- **Renaming or deleting a published post.** `mcp-design.md` settled it: a new URL is done
  by hand, with a redirect.
- **Validating a draft at save time.** ADR-004 decided validation belongs to `publish`,
  and this ADR is where it lands. `save_draft` is untouched.
