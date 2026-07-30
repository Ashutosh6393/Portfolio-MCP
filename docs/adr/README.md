# Architecture Decision Records

Why things are the way they are. Read before changing an architectural choice.

## When to write one

A decision is significant enough for an ADR if it is **hard to reverse**, **affects more
than one module**, or a future reader would otherwise ask *"why on earth is it like
this?"*

Always required for:

- Adding, swapping, or removing anything in [`tech-stack.yaml`](../../tech-stack.yaml)
- Data model choices that shape future queries
- Introducing or removing a service boundary
- Anything you argued about for more than ten minutes

Not required for: naming, formatting, or anything a linter decides.

## Numbering

`{NNN}-{slug}.md`, zero-padded, sequential, never reused. A spec folder takes the number
of the ADR it implements: ADR `007` → `specs/007-{slug}/`.

## Append-only

ADRs are never rewritten. A decision that changes gets a **new** ADR that supersedes the
old one, and the old one's status becomes `superseded by ADR-{NNN}`.

Keeping the superseded record is the whole point — it's how a future reader learns the
obvious-looking alternative was already tried and why it failed. Deleting it guarantees
someone re-proposes it.

## Template

```markdown
# ADR-{NNN}: {Title}

- **Date:** {YYYY-MM-DD}
- **Status:** proposed | accepted | superseded by ADR-{NNN}
- **Deciders:** {who}

## Context

{What situation forced a decision. Constraints in play. What we knew at the time —
not what we know now.}

## Alternatives

1. **{Option}** — {pros} / {cons}
2. **{Option}** — {pros} / {cons}

## Decision

{What we chose, and why it beat the alternatives.}

## Tradeoffs

{What we knowingly gave up. If this section is empty, you haven't found the cost yet.}

## Consequences

{What this now requires, enables, or forecloses. Migration needs. New obligations.}
```

## Index

<!-- Add each ADR here as it lands. -->

| # | Title | Status | Date |
|---|---|---|---|
| [001](001-server-runtime-and-shape.md) | Server runtime and repo shape | accepted | 2026-07-30 |

[`mcp-design.md`](mcp-design.md) is unnumbered on purpose. It is the design discussion the
server was settled in, kept as reference — the numbered ADRs are the decisions taken from
it.
