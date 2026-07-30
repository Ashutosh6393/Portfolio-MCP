# portfolio-mcp

A remote MCP server for publishing to [ashutoshverma.dev](https://ashutoshverma.dev) from
any Claude client — including a phone.

Six tools that move bytes. The model does the writing; the server reads content, serves
skills, saves drafts, and opens a pull request. **It never merges.** The merge button is
the gate, and it is somewhere the model cannot reach.

**Status: no server code yet.** The site side is done; this repo is at Slice 1.

---

## Where things live

This repo is **the server only**. Two other repos are involved and neither is worked on
from here:

| Repo | Holds | This server's access |
|---|---|---|
| `portfolio` | The public site, published MDX | Opens PRs. Never commits to main |
| `workshop` (private) | Drafts, skills, templates, social post archive | Commits straight to main |
| **`portfolio-mcp`** | **The server. This repo** | — |

No repo is ever cloned. Every read and write goes through the GitHub API, because a
checkout on disk means stale state and surprise conflicts.

---

## Read these first

| File | What it holds |
|---|---|
| [CONTEXT.md](CONTEXT.md) | The problem, the domain words, what we are **not** building |
| [docs/adr/mcp-design.md](docs/adr/mcp-design.md) | The full design: six tools, publish gate, idempotency, and everything rejected |
| [docs/adr/001-server-runtime-and-shape.md](docs/adr/001-server-runtime-and-shape.md) | Why TypeScript on Bun and not Python |
| [CLAUDE.md](CLAUDE.md) | Agent entry point — an index to the rules |
| [tech-stack.yaml](tech-stack.yaml) | The approved dependency menu |

The rejected-alternatives table in `mcp-design.md` is the most useful page in the repo.
It is cheaper to read than to re-argue.

---

## Stack

Bun · TypeScript strict · Elysia · Zod · Biome · `bun:test` · the MCP TypeScript SDK.
Reasoning in [ADR-001](docs/adr/001-server-runtime-and-shape.md); the short version is
that `publish` has to parse MDX, and MDX only parses in JavaScript.

No database, no accounts, no queue. Auth is an unguessable secret in the URL path — there
is exactly one user, which is the one case OAuth adds nothing to.

---

## Build order

Plumbing before anything interesting.

| Slice | Ships | State |
|---|---|---|
| 0 | Site prep: the five JSON routes, OG images | **done** — in `portfolio` |
| 1 | Skeleton, secret path, `/health`, `get_skill` only. Deployed | next |
| 2 | Reads: `list_content`, `get_content` | |
| 3 | Cheap writes: `save_draft`, `discard_draft` | |
| 4 | `publish`: validation, branch, PR, idempotency | |
| 5 | Polish: lazy reconciliation, response nudges, Claude Project | |

Slice 1 is deliberately almost nothing. The riskiest unknown in the plan is whether a
custom connector behaves properly in the mobile app, and that cannot be tested locally.
Find out with 80 lines, not after six tools exist.

---

## Working in this repo

Feature work follows [SPEC-WORKFLOW.md](SPEC-WORKFLOW.md): an accepted ADR, then a sliced
spec, then the red-green loop, one slice per PR.

```bash
bun install
bun test
bun run docs:sync    # regenerates GENERATED blocks; CI fails on drift
```

`SETUP.md` is install notes for the agent scaffold this repo started from. Safe to delete
once you stop needing them.
