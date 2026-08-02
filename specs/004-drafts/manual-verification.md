# Manual verification — M-2, M-3, M-4

The three checks no agent can run. Each closes a slice, and none of this feature has been
run against the real `workshop` repo through a real client yet.

**Do not paste `MCP_SECRET_PATH` into this file, a commit, or a chat.** It is the only auth
this server has. Keep it in your shell and in the client config.

---

## Step 0 — deploy the branch

The five tools exist only on `feat/drafts`. The phone cannot reach your laptop, so the
branch has to be deployed before M-2. This is deliberately **before** the PR merges: these
checks are the gate.

```bash
git checkout feat/drafts
bun test                      # expect 90 pass, 0 fail
fly deploy --ha=false         # --ha=false is required, see spec 001's notes
```

Then prove the deploy is live and the credential works:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://mcp.ashutoshverma.dev/health
export SECRET='...'           # your MCP_SECRET_PATH, from your password manager
curl -s "https://mcp.ashutoshverma.dev/$SECRET/health"
```

Expect `200`, then `{"checks":{"site":"ok","github":"ok"}}`.

**If `github` says `unreachable`, stop.** The token is wrong or unscoped, and every save
below will fail as a confusing 404. The token needs `contents: read and write` on
`workshop` — widened by hand at M-1, so it should already be right.

## Step 0b — connect a client

**Claude Code:**

```bash
claude mcp add --transport http portfolio "https://mcp.ashutoshverma.dev/$SECRET/mcp"
```

**claude.ai and the mobile app:** Settings → Connectors → Add custom connector → paste the
same URL.

Sanity check before starting: ask the client what tools it has. Expect **five** —
`list_content`, `get_skill`, `save_draft`, `get_content`, `discard_draft`. If you see two,
you are talking to the old deploy.

> The first call after a quiet period pays a cold start — the machine sleeps at
> `min_machines_running = 0`. A slow first response is expected, not a fault.

---

## M-2 — the read-modify-write loop (closes slice 2)

Drive this in prose, the way you actually would. Do not hand it JSON.

1. **Save.** *"Save this as a draft writing under the slug `test-crdts` — title 'What CRDTs
   taught me', and a couple of paragraphs about it."*
   → Expect a reply naming `drafts/writing/test-crdts.mdx`.

2. **Look at the file in GitHub.** Open `workshop` → `drafts/writing/test-crdts.mdx`.
   - It opens cleanly, no MDX error.
   - Quoted keys, two-space indent, one `}` at column 0, blank line, then the body.
   - The commit is `save draft: writing/test-crdts` and is attributed to **you**, not a bot.

3. **Read it back.** *"Read the draft `test-crdts` back to me."*
   → Expect the metadata, the body, **and a sha**. No sha means the loop cannot close.

4. **Edit and save.** *"Change the title to 'What CRDTs actually taught me' and save it."*
   → It should pass the sha from step 3 back automatically.

5. **Check GitHub again.** **One** file, not two. New title. Two commits now.
   *This is criterion 3 and the whole point of the slice.*

6. **Stale sha — the one that must refuse.** *"Save it again using the sha you got the
   first time."* (the step 3 sha, now stale)
   → Expect a refusal telling you to call `get_content` again and re-apply. **Not** a retry,
   and not a silent overwrite. Criterion 4 says *observed, not assumed* — so watch it happen.

7. **A published slug.** Pick a slug already live on the site and try to draft it.
   → Expect a refusal naming the slug. Check GitHub: **nothing** was written.

8. **Reserved keys.** *"Save a draft `test-keys` with show true, order 3 and readingTime
   '5 min', and a title."*
   → Saves without complaint, and **none of those three appear in the file**. The title does.

9. **A draft with only a title.** *"Save a draft `test-bare` with just the title 'Bare'."*
   → Saves. No complaint about missing fields. Validation belongs to `publish`.

10. **Now do steps 1, 3 and 4 from the phone.** This is criterion 1 and it is not optional —
    the whole feature exists so an idea on a train can be drafted without a laptop.

---

## M-3 — throwing a draft away (closes slice 3)

1. **Discard.** *"Discard the draft `test-crdts`."*
   → Expect confirmation naming what was removed.

2. **GitHub:** the file is gone. A commit `discard draft: writing/test-crdts` is the only
   record of it. There is no trash and no restore — that is the design.

3. **Discard something that is not there.** Repeat the same command.
   → Expect exactly: *"There is no draft at writing/test-crdts."*
   → Check the client still got a normal answer, not an error banner.

4. **The important one — a broken draft must still be removable.** In GitHub's web editor,
   open `drafts/writing/test-keys.mdx` and put a trailing comma after the last metadata
   field so the block will not parse. Commit. Then:
   - *"Read the draft `test-keys`."* → expect the refusal telling you to fix it in GitHub.
     It must **not** show you a parse error or half the content.
   - *"Discard the draft `test-keys`."* → **must still delete it.** `discard_draft` never
     parses. A draft you have broken is exactly the one you most want to throw away.

---

## M-4 — listing drafts (closes slice 4)

1. *"List my draft writings."* → the slugs actually sitting in `workshop/drafts/writing/`.
   Slugs only — no titles, no bodies. That is deliberate: a title per draft costs an API
   call per draft.

2. **The empty case.** *"List my draft projects."* — assuming you have never saved a project
   draft, `drafts/project/` does not exist and GitHub 404s it.
   → Expect an **empty list, not an error.** This is the failure most likely to be mistaken
   for a bug.

3. *"List my published writings."* → the same catalogue you got before this branch.
   Unchanged is the criterion.

4. Ask it to list content without saying published or draft.
   → It should ask which, or refuse. `state` is required on purpose.

---

## Clean up

Discard every `test-*` draft you made. The commits stay in `workshop`'s history — that is
fine and expected, git is the history.

## Record the result

In `specs/004-drafts/implementation.md`:

- Tasks 7, 10 and 13 → `done`, with what you observed.
- The PR slices table → slices 2, 3 and 4 lose their "M-n outstanding".
- **Anything that behaved differently from the above goes in the session notes**, whether or
  not you fixed it. A surprise recorded is worth more than a clean report.

Then `Status: complete` at the top of the file once all three have run.
