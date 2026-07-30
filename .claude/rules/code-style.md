---
name: code-style
load_when: Naming things, structuring functions, or defining module boundaries.
---

# Code Style

Formatting is Biome's job — don't think about it. This file covers what a formatter can't
decide.

---

## Naming

Descriptive over short. Avoid abbreviations unless universally understood.

- **Functions** describe actions: `fetchUserProfile`, `revokeSession`
- **Classes** describe responsibilities: `InvoiceRepository`, `PaymentGateway`
- **Variables** communicate purpose: `emailVerificationToken`, `retryCount`

Avoid: `helper`, `manager`, `util`, `temp`, `data`, `processData`, `cfg`, `usrSvc`.

`Manager` and `Helper` are the tell that a module has no single responsibility. If you
can't name it precisely, you haven't decided what it does yet — that's a design problem
surfacing as a naming problem, and renaming won't fix it.

Use the vocabulary in [CONTEXT.md](../../CONTEXT.md). Don't invent synonyms for domain
terms that already exist.

---

## Functions

Every function should:

- Do one thing
- Have one reason to change
- Hide unnecessary implementation detail
- Avoid side effects where possible

Prefer composition over long functions. A function that needs a comment to explain its
sections wants to be several functions.

---

## Types

- **No `as any`.** If the type is wrong, fix the type.
- No unchecked `as`. Narrow with a guard or parse with Zod.
- Derive types from schemas (`z.infer`), don't hand-write parallel definitions that can
  drift.
- `strict` is on. Don't work around it.

---

## Public vs internal

Separate them clearly.

- Each package/module has an explicit public API — one entry point.
- Internal files are not imported across unrelated modules.
- If you need something internal from another module, that's a signal the boundary is
  wrong. Raise it rather than reaching through.

---

## Layer discipline (server)

```
tools → services → lib
```

- One file per tool in `tools/`. It is the **only** layer that imports the MCP SDK.
- `services/` owns all business logic. Every tool goes through one, including the thin
  ones — "is this enough logic to need a service?" is a question that gets answered
  differently twice.
- `lib/` holds the GitHub App client, the site fetcher, env parsing, the MDX parse.
- Never skip downward: a tool must not touch `lib`. Never call upward.

**Services take their dependencies as an argument**, never by importing a module
singleton:

```ts
export async function publishWriting(
  deps: { github: Github; site: Site },
  args: PublishArgs,
) { ... }
```

That is the seam. A test passes an object literal — no mocking framework, no
`mock.module()`. See [testing.md](testing.md) for which layer gets tested how.

There is no `repository/` layer in this repo, and no database. The default layout in
[tech-stack.yaml](../../tech-stack.yaml) has one; the deviation is recorded in
[ADR-001](../../docs/adr/001-server-runtime-and-shape.md).

---

## Files

- One primary export per file, named after the file.
- Colocate tests: `thing.ts` → `thing.test.ts`.
- Shared across apps? It belongs in `packages/`, not copy-pasted.

---

## Never

- `as any`
- Editing generated files — change the generator
- Reaching into another module's internals
- Adding an abstraction with one call site
