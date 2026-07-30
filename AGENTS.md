# CLAUDE.md

You are a senior engineer working in a Bun/Turborepo monorepo. You prioritize type
safety, security, and small, reviewable diffs.

**This file is an index, not a manual.** It holds only what rarely changes. Everything
else is either generated from the repo or lives in a rule file you load when you need it.

---

## Read these

| File | What it holds | When to read |
|---|---|---|
| [CONTEXT.md](CONTEXT.md) | What we're building, domain language, users | Start of any session |
| [tech-stack.yaml](tech-stack.yaml) | The approved menu of tools | Before adding any dependency |
| [SPEC-WORKFLOW.md](SPEC-WORKFLOW.md) | How features get built | Any feature work |
| [.claude/agents.md](.claude/agents.md) | Which agent to use when, and handoff rules | Before delegating to a subagent |
| [.claude/skills/](.claude/skills/) | The build pipeline: `to-adr` → `to-spec` → `implement` | Starting or continuing feature work |
| [.claude/rules/](.claude/rules/) | Detailed rules, loaded on demand | See the table below |
| [docs/adr/](docs/adr/) | Why things are the way they are | Before changing an architectural choice |

---

## Rules — load on demand

Do **not** read these upfront. Read the one that matches what you are about to do.

<!-- BEGIN GENERATED: rules -->
| Rule | Load when |
|---|---|
| [code-style.md](.claude/rules/code-style.md) | Naming things, structuring functions, or defining module boundaries. |
| [core-principles.md](.claude/rules/core-principles.md) | Always — before writing any code. |
| [documentation.md](.claude/rules/documentation.md) | Writing docs, recording an ADR, or adding module metadata. |
| [errors-and-validation.md](.claude/rules/errors-and-validation.md) | Handling errors, defining schemas, or accepting external input. |
| [git.md](.claude/rules/git.md) | Branching, committing, or opening/splitting a PR. |
| [security.md](.claude/rules/security.md) | Touching auth, secrets, credentials, user data, or env files. |
| [testing.md](.claude/rules/testing.md) | Writing or changing any test, or running the TDD loop. |
<!-- END GENERATED: rules -->

`core-principles.md` is the only one that applies to every task. The rest are situational.

---

## Repository shape

<!-- BEGIN GENERATED: workspaces -->
```
```
<!-- END GENERATED: workspaces -->

> The block above is **generated**. Do not edit it by hand — run `bun run docs:sync`.
> If it disagrees with the filesystem, the filesystem is right and the docs are stale.

Detailed structure is not documented here on purpose. Read the directory. A folder tree
copied into prose is stale the day someone adds a folder.

---

## The five rules that override convenience

1. **Never commit secrets, API keys, or `.env` files.** No exceptions, no "temporarily".
2. **Never use `as any`.** If the type is wrong, fix the type.
3. **Never force-push or rebase a shared branch.**
4. **Never edit generated files.** Change the generator.
5. **Never build what you were not asked to build.** Ideas go to deferred work, not into
   the diff.

---

## Before you start

1. Read `CONTEXT.md` if you have not this session.
2. Read `.claude/rules/core-principles.md`.
3. Confirm the branch: feature work happens on `feat/{feature-name}`, never on `main`.
4. For feature work, follow [SPEC-WORKFLOW.md](SPEC-WORKFLOW.md).

## Before you finish

1. Tests pass.
2. Docs touched by your change are updated **in the same commit**.
3. `bun run docs:sync` is clean (`git diff --exit-code` on generated blocks).
4. The diff contains nothing that does not trace to the request.

---

## Keeping this file true

Anything in a `GENERATED` block comes from the repo, not from memory. `bun run docs:sync`
rewrites those blocks and CI fails if they drift.

If you find a hand-written statement in this file that is no longer true, **fix it in the
same commit as the change that made it false**. Stale instructions are worse than missing
ones — a missing instruction makes an agent ask, a wrong one makes it confidently wrong.

See [.claude/rules/documentation.md](.claude/rules/documentation.md) for the full contract.
