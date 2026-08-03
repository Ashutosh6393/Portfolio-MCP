# ADR-006: The publish token needs two permissions, not one

- **Date:** 2026-08-03
- **Status:** accepted
- **Deciders:** Ashutosh Verma
- **Supersedes:** the premise of [ADR-005](005-publish-opens-a-pull-request.md) decision 8.
  The decision itself stands.

## Context

[ADR-005](005-publish-opens-a-pull-request.md) decision 8 opens with this:

> The token is widened to `contents: write` on `portfolio`. There is no narrower option:
> GitHub grants committing to `main` and opening a PR through the same permission, and a
> fine-grained PAT cannot be scoped to a branch.

The second sentence is wrong, and it was written without being checked. On a fine-grained
personal access token, **`Contents` and `Pull requests` are separate permissions.** Holding
`Contents: write` does not grant opening a pull request.

This was found the only way it could be — by running M-1 against the real repo on
2026-08-03, at the end of slice 3. `POST /repos/{owner}/{repo}/pulls` returned:

```
403 {"message":"Resource not accessible by personal access token"}
```

The branch had been created and the file committed, both through `Contents: write`. Only
the pull request failed. Four slices of work had been built on a sentence nobody had
tested, and the failure surfaced on the first real call.

It is worth being precise about what the error cost. It was **not** a security failure —
the under-scoped token was *less* privileged than intended, and nothing reached `main`.
It was a setup failure: a reader sizing the token from that sentence grants one permission,
deploys, and the server appears healthy right up until the moment someone publishes.

## Alternatives

1. **Correct ADR-005 in place.** Smallest edit, and wrong. ADRs are append-only
   ([documentation.md](../../.claude/rules/documentation.md)) — the value of the record is
   that it shows what was believed at the time. Quietly fixing the sentence would erase the
   fact that a live check caught what four slices of review did not.
2. **Leave it in `design.md` only.** The correction was already recorded in
   [`specs/005-publish/design.md`](../../specs/005-publish/design.md) → *Facts checked
   during M-1* and in the feature's `CLAUDE.md`. But specs are per-feature and get archived
   in the reader's mind once the feature ships; the ADRs are what a future reader consults
   before touching the token. A correction that lives only in the spec is a correction that
   will not be found.
3. **A new ADR superseding the premise, leaving the decision.** Chosen.

## Decision

**The publish token requires `Contents: read and write` *and* `Pull requests: read and
write` on `portfolio` (`Portfolio-new`).** Both. Neither is optional and neither implies
the other.

**ADR-005 decision 8's conclusion is unchanged and still correct.** `Contents: write` alone
genuinely does permit committing to `main`, and a fine-grained PAT genuinely cannot be
scoped to a branch. So the guarantee still has to live outside the token, in a ruleset on
`portfolio`'s `main` — exactly as decision 8 says. Only the sentence explaining *why there
is no narrower option* was wrong, and it was wrong in a way that under-scoped the token
rather than over-scoping it.

Two things follow, both already implemented:

- **A 403 is its own error type.** `GithubForbiddenError` in `lib/github.ts`, and `publish`
  turns it into a refusal naming both permissions. Before this, a 403 fell through to the
  generic branch and read *"GitHub did not complete the request"*, which sends the reader
  looking for a network fault — the one failure a retry can never fix, reading exactly like
  the ones a retry can. Covered by T-65.
- **The requirement is recorded where a deployer will look**: `.env.example`, the feature
  `CLAUDE.md`, and `specs/005-publish/design.md`.

## Tradeoffs

**A second permission is more surface.** `Pull requests: write` also permits closing and
commenting on pull requests, neither of which this server does. There is no narrower grant
that allows opening one — this is genuinely the floor, which is what decision 8 claimed
about `Contents` and got wrong about the pair.

**The merge button is still out of reach.** `Pull requests: write` does not include merging;
that needs `Contents: write` on the target branch, which the ruleset refuses. So the central
claim of ADR-005 — that a human pressing merge is the only thing that makes a post live —
survives this correction intact.

## Consequences

- **Deploying with only `Contents: write` produces a server that looks healthy and fails at
  publish time.** `/{secret}/health` checks reachability, not scopes, and there is no cheap
  probe that would. The 403 message is the mitigation, not prevention.
- **Rotating the token means re-granting both.** A rotation that restores only `Contents`
  reintroduces the exact failure, and the health check will not catch it.
- **The wider lesson is recorded rather than smoothed over.** ADR-005's live-facts table
  said "checked live rather than assumed" and this sentence was neither. It is the second
  fact in this feature to fail that way — the first was the schema keyword count, caught by
  review, which had also been written down as established. **A fact labelled "do not
  re-derive" is only as good as the one check standing behind it**, and both times the check
  did not exist. M-1 existing at all is why this one was caught before the token was
  documented wrong for good.
