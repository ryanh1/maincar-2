# Linear Workflow Rules

When working on a Linear issue:

## Issue Status Transitions

- **When starting work:** Move issue to **"In Progress"**
- **When implementation is ready for review:** Move the issue to **"In Review"** (tests pass, code is committed, and it awaits review or merge).
- **When the session merges and pushes the issue itself:** after the required merge,
  GitHub push, feature-branch deletion, and worktree cleanup, move the issue to
  **"Done"** (or the team's final equivalent). Do not leave a merged issue in
  "In Progress" or "In Review".
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

Don't start work if you're blocked by an incomplete issue.
