# ADR-003: Skills and templates are separate things in `workshop`

- **Date:** 2026-07-31
- **Status:** accepted
- **Deciders:** Ashutosh Verma
- **Supersedes:** [ADR-002](002-github-access-and-workshop.md) → *Skill storage* and *The
  tool*. Everything else in ADR-002 — the credential, the client, the health check, the
  slice scope — stands unchanged.

## Context

ADR-002 decided `workshop` would be laid out as **one directory per skill, holding
`instructions.md` and `template.mdx`**, and that `get_skill` would always return both:
*"a template with no instructions is a mystery, and a skill without its template is
incomplete."*

That was decided before the actual content existed. It does not survive contact with it.
The real material is five files and they do not pair up:

| What | Has rules? | Has a template? |
|---|---|---|
| `linkedin-post` | yes | **no** — a LinkedIn post is a block of text, there is nothing to fill in |
| `twitter-post` | yes | **no** — same |
| `be-human` | yes — voice and style | **no** — it is not tied to one kind of output |
| a **writing** | no rules of its own beyond the voice | **yes** |
| a **project** page | same | **yes** |

So ADR-002's rule inverts: of five things, **none** has both halves. Honouring it would
mean writing three filler templates and two filler instruction files whose only content is
"see be-human" — inventing documents so a constraint can be satisfied.

The other thing ADR-002 could not have known: `be-human` is not one skill among several.
It is the voice underneath all four of the others. It is the answer to the failure
`mcp-design.md` predicts — a model drafting on a phone in generic LinkedIn voice — and it
applies whether the output is a post, a writing, or a project page.

Constraints unchanged from ADR-002: read-only token, no cache, no retry, every file
editable from GitHub's web UI on a phone, ~15 tool calls a week.

## Alternatives

1. **Keep ADR-002's shape; pad the gaps with filler files.** Every skill directory gets
   both files whether or not it needs them. *For:* no code changes, no new ADR. *Against:*
   five real documents plus five fake ones, and the fakes are the ones a model reads first.
   A template invented to satisfy a schema is exactly the "invented template ships to the
   site" failure ADR-002 was trying to prevent — the rule would cause the harm it exists to
   stop.
2. **Two tools, `get_skill` and `get_template`.** *For:* each returns one clean thing.
   *Against:* the model must decide which to call before it knows what exists, and the
   whole reason this tool has a specified description is that the model already under-calls
   it. Two under-called tools is worse than one. It also splits the voice away from the
   template, so "get the writing template" gets you structure with no voice — the exact
   generic-output failure.
3. **One flat directory holding all five files.** *For:* one listing, one lookup, simplest
   possible read path. *Against:* it erases a distinction the author actually draws. A
   listing of five names cannot tell a model that two of them are fill-in-the-blank
   documents and three are rules to follow, so it has to open one to find out.
4. **Two directories, one tool, and the voice bundled into every answer.** *For:* matches
   the material; the listing is self-describing; the voice cannot be forgotten. *Against:*
   `be-human` is re-read on every named call, and resolving a name costs a listing.

## Decision

**Four. `workshop` holds `skills/` and `templates/` as flat files, `get_skill` serves both,
and `be-human` is attached to every named answer.**

```
workshop/
  skills/
    be-human.md           voice and style — the base layer
    linkedin-post.md
    twitter-post.md
  templates/
    writing.mdx
    project.mdx
```

One file per thing. ADR-002's directory-per-skill bought the separation of instructions
from template; with no skill having both, it now buys a folder containing one file.

`writing` and `project` are the [CONTEXT.md](../../CONTEXT.md) words for what those
templates produce. `.mdx` because that is the shape the site renders, so the file edited on
a phone is the file that ships — ADR-002's reasoning, unchanged and still right.

### The tool

`get_skill({ name? })` keeps its name and its signature.

- **No name** → the skills and the templates, as two lists. A model that has never seen
  this repo learns the shape of it in one call.
- **A name** → the `be-human` voice, plus either that skill's rules or that template.
  A name is resolved against both listings by basename, so the extension never has to be
  guessed and an unknown name comes back with the real lists already in hand.
- **Asking for `be-human` by name** returns it once, not twice.

**The voice rides along with everything.** This is the load-bearing part of the decision.
A model that receives the writing template and not the voice writes a correctly-structured
document that sounds like nobody, and that is the failure this tool exists to prevent — not
a missing file, but generic prose. ADR-002 protected against half a skill; the real risk
was always half a voice.

## Tradeoffs

- **`be-human` is fetched on every named call**, including the calls where the model
  already has it in context. One extra read against 5,000/hour. Not worth a cache, and
  ADR-002's Risk 5 already said so.
- **The happy path is two round trips, not one.** Resolving a name means listing first.
  Bought: the extension is never guessed, and the "no such skill" error already knows what
  does exist rather than making a third call to find out. ADR-002 budgeted three calls; the
  real cost is four across two round trips, and none of them is on a tool path that a
  drafting model waits on twice.
- **A skill and a template are both reached through a tool called `get_skill`.** Mildly
  imprecise. Renaming it to something neutral would cost the description's whole nudge, and
  the result keys say which one came back.
- **A stray file in `skills/` is offered as a skill.** ADR-002 got this free from the
  directory layout. Nothing is built to defend it: it is a private repo with five files and
  one author, and a name-based blocklist is the fragile kind of guard.
- **Giving up the "both halves or neither" guarantee.** Stated plainly because it was a
  deliberate protection, not an oversight. It is replaced by a stronger one: the voice is
  guaranteed, and the voice was the part that mattered.

## Consequences

- `specs/002-github-access/design.md` changes: the `skills/{name}/` read path, the result
  shape, the tool description, and test cases T-07…T-17. The spec is mid-build, so this
  lands before Slice 2 starts rather than as rework.
- **No Slice 1 code changes.** `lib/github.ts` reads a repo and a path; it never knew the
  layout. The `github` health check reads both repo roots and is unaffected.
- **P-1 changes.** The prerequisite is now the five files above, not
  `skills/{name}/instructions.md` + `template.mdx`. P-1 was already unmet — `workshop` has
  no commits at all — so nothing has to be undone, only created correctly the first time.
- Later slices are untouched. `drafts/`, `posts/published/`, and `archive/` keep the paths
  ADR-002 gave them.
- Adding a sixth skill or a third template is dropping one file in one directory. No code,
  no registration, no ADR.
