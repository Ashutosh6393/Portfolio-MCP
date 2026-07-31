# Implementation tracker

Slice 0 of [`adr/mcp-design.md`](adr/mcp-design.md), done in the `portfolio` repo and
copied here as the record of what the server can rely on. Statuses below are final.
Statuses: `done` · `in progress` · `todo` · `blocked` · `dropped`.

**Where we are:** all 11 tasks done. Every route is built, prerendered, and passing
the four success tests against a real production build. Slice 0 is finished — the
`mcp-server` repo is unblocked.

---

## Tasks

| # | Task | Files | Status |
|---|---|---|---|
| 1 | Add `zod` v4 (`bun add zod`) | `package.json` | done |
| 2 | Write the two Zod schemas | `lib/schema.ts` | done |
| 3 | Re-point `PostMeta` / `ProjectMeta` at `z.infer` | `lib/content.ts` | done |
| 4 | `GET /api/schema.json` via `z.toJSONSchema()` | `app/api/schema.json/route.ts` | done |
| 5 | `GET /api/writing/content.json` | `app/api/writing/content.json/route.ts` | done |
| 6 | `GET /api/projects/content.json` | `app/api/projects/content.json/route.ts` | done |
| 7 | Strip the metadata block from raw MDX | `lib/content.ts` | done |
| 8 | `GET /api/writing/{slug}` | `app/api/writing/[slug]/route.ts` | done |
| 9 | `GET /api/projects/{slug}` | `app/api/projects/[slug]/route.ts` | done |
| 10 | Round-trip check (the 4 success tests) | `specs/mcp-content-api/check.ts` | done |
| 11 | Fix `writings` → `writing` in the ADR route table | `design/adr-for-mcp.md` | done |
| — | OG image generation | `lib/og.tsx`, 3 × `opengraph-image.tsx` | done (pre-existing) |

---

## How to verify

```bash
bun run build                        # all 5 routes must prerender
bun run start                        # or: bun run dev
bun specs/mcp-content-api/check.ts   # the 4 success tests
```

Last run: **all checks passed**, against `bun run start` on the production build.
Build output shows `/api/schema.json` and both `content.json` routes as `○ Static`,
and both `[slug]` routes as `● SSG` with every slug prerendered.

---

## Done

- **2026-07-30 — #1–#3, schema layer.** `zod@4.4.3`. `lib/schema.ts` holds
  `writingMetaSchema`, `projectMetaSchema` (both `z.strictObject`) and
  `projectFileSchema` (adds `show`/`order` for the site's own type).
  `lib/content.ts` now re-exports `PostMeta`/`ProjectMeta` from there, so no call
  site changed. `bun run build` green.
- **2026-07-30 — #4–#9, the five routes.** All under `app/api/`. Added `getBody`
  and `getDoc` to `lib/content.ts`. `[slug]` routes use `generateStaticParams`, so
  known slugs are prerendered and unknown ones fall through to a request-time 404.
- **2026-07-30 — #10, `check.ts`.** Passing. Plain `node:assert`, no framework.
- **2026-07-30 — #11, ADR corrections.** Route table now says `writing`; the
  writing-metadata open item is marked settled.

---

## Notes from the build

- **`z.strictObject` gives `additionalProperties: false` for free.** That single
  choice is what enforces the "no tool may set `show`/`order`" rule — verified by
  two assertions in `check.ts` that fail if either key ever leaks into the write
  schema.
- **Bodies come back with CRLF** (`\r\n`), because that is what is on disk on this
  machine. The body is a byte-exact tail of the file, so a read → write round trip
  is safe. Worth knowing when the server diffs anything.
- **`bun run lint` reports 1 error and 139 warnings, all pre-existing** — the error
  is `components/site/theme-toggle.tsx:11` (`set-state-in-effect`). Nothing from
  this work appears in the output. Left alone, not mine to fix.

---

## Not this repo

Listed so nobody picks them up by mistake. All of these live in `mcp-server` or
`workshop`:

- the MCP server, its six tools, secret-path auth, `/health`
- the GitHub credential and every call made with it
- drafts, PRs, idempotency, lazy reconciliation
- skills and templates (they move to `workshop`)
- the `show`/`order` carry-over on `publish` — the hazard is written up in
  `design.md`, but the code belongs to the server

---

## Decisions made while writing the spec

Recorded so they don't get re-argued.

| Decision | Why |
|---|---|
| Routes are `/api/writing`, not `/api/writings` | Matches `content/writing` and `/writing/[slug]`. The server isn't built, so it's free. |
| `zod` v4 as the one definition | Gives types *and* JSON Schema from one source. Hand-writing the schema means two definitions that drift. |
| No `tags` on writing metadata | The ADR guessed at them. Nothing on the site renders a tag. |
| `additionalProperties: false` | This is what makes "a tool can never set `show`" real, instead of a rule someone remembers. |
| `content.json` keeps `show` and `order` | The server needs to read them to carry them across a `revise` publish. |
| `content.json` is a bare array | A `{ count, items }` wrapper adds nothing. |
| 404s return a JSON error body | The server turns tool errors into text the model can act on. A bare 404 dead-ends. |
