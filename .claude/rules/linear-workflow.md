# Linear Workflow Rules

When working on a Linear issue:

## Issue Status Transitions

- **When starting work:** Move issue to **"In Progress"**
- **When implementation is ready for review:** Move the issue to **"In Review"** (tests pass, code is committed, and it awaits review or merge).
- **When the session merges and pushes the issue itself:** after the required merge,
  GitHub push, feature-branch deletion, and worktree cleanup, run
  `./.claude/scripts/coord/mc-closeout MAI-123 --worktree /exact/removed/issue-clone`
  from a surviving checkout. Move the issue to **"Done"** only when it prints
  `LINEAR_DONE_ALLOWED`. Do not call the Linear status tool directly before this
  check. It fails unless GitHub accepted the delivery and the exact issue clone
  no longer exists.
- **Never leave an issue in "In Progress" after the work is done.** Update its
  status as part of closeout, after the repository cleanup rather than before it.

**One issue "In Progress" at a time.** Normally a session works one issue. Before you move a new issue to "In Progress", make sure your last one is out of "In Progress" (moved to "In Review" or back to its prior status). There may be exceptions, but treat one as the rule.

## Commit Messages

Use the ticket's issue key in all commit messages:

```bash
git commit -m "MAI-123: Add phone number schema"
git commit -m "MAI-45: Fix voicemail recording upload"
```

Format: `[ISSUE-KEY]: [Short description]`

This links commits to issues in Linear and makes history searchable.

## When to Use linear-execute-issue Skill

The `linear-execute-issue` skill is your workflow for taking an issue from Linear and shipping it:

1. **Input:** Issue key (MAI-123) or Linear URL
2. **Process:** Read spec → plan → branch → code → test → verify
3. **Output:** After the required merge/push/cleanup, move the issue to "Done";
   otherwise move it to "In Review" when it is genuinely awaiting review.

Use this skill whenever you're working on an existing Linear issue.

## Focused checks and simple delivery

Use `mc-gate --focused -- npm --prefix <server|vite> exec vitest run path/to/file.test.ts`
for one named Vitest file during development. Broad commands and Playwright
cannot claim this lane.

After committing, use `mc-gate --check` with the exact relevant test files.
Then use `mc-deliver enqueue --test <kind:path>` and `mc-deliver run`. One run
handles one issue. It merges the issue onto newest `main` in a temporary clone,
runs TypeScript, lint, and those exact tests, then pushes the checked result.
There are no risk levels, combined groups, retries, or browser checks. Never
call `mc-train`, `mc-merge`, a raw `git push`, `npm test`, or `npm run verify`
as a substitute.

## Branch Naming

Create a branch for each issue using the issue key:

```bash
git checkout -b mai-123-add-call-schema
```

Format: `[lowercase-key]-[kebab-case-title]`

## Linking Related Issues

When an issue depends on another:

1. Open the issue in Linear
2. Click **"Related"** or **"Link"**
3. Add relationship: "blocked by MAI-100" or "relates to MAI-50"

## Dependency Readiness

An upstream issue is ready to unblock its dependents when its Linear status is
**"Ready to Review"**, **"In Review"**, or **"Done"** (including the team's
equivalent final status). **Do not wait for "Done" when the prerequisite is in
review.** Treating a review-ready issue as blocking serializes work that can
proceed in parallel.

When selecting work, an issue is blocked by a dependency only while that
dependency is in a pre-review or explicitly blocked state (for example,
Backlog, Todo, In Progress, or Blocked). If the dependency's reviewed code has
not yet reached `main` and the dependent needs it, coordinate from the
upstream's committed review head; do not wait solely for its final merge.
