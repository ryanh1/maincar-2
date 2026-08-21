# Importing Dialer Issues to Linear

## Quick Start

Issues are defined in `tasks/linear-issues.md`. Choose one of these methods to import them:

### Method 1: Manual Import via Linear UI (Fastest)

1. Go to https://linear.app/maincar-2
2. Click **"Create issue"** or use keyboard shortcut **`C`**
3. Copy-paste each issue from `tasks/linear-issues.md` (title, description, criteria)
4. Set:
   - **Estimate:** Points from issue spec
   - **Labels:** Phase + module (e.g., `p1-foundation`, `numbers`)
   - **Project:** maincar-2
5. Create issue

**Repeat for all 57 issues.** Bulk import is coming to Linear soon; for now, manual is most reliable.

### Method 2: Bulk Import via CSV (If Linear supports it)

1. Convert `tasks/linear-issues.md` to CSV (title, description, estimate, labels)
2. In Linear: Team Settings → Import → CSV
3. Upload file

Check Linear docs for current CSV import support.

### Method 3: Use Linear API with Your API Key

1. Get API key from https://linear.app/settings/account/api
2. Run:
   ```bash
   export LINEAR_API_KEY="your-api-key"
   python scripts/create-linear-issues.py
   ```

**Note:** The Python script is a template; you may need to extend it to parse all 57 issues from `tasks/linear-issues.md`.

## Issue Numbering

Linear will auto-assign issue numbers (MAI-1, MAI-2, etc.). If you batch-import via API or CSV, numbers will align with the list order in `tasks/linear-issues.md`.

## Labeling

Apply these labels to every issue:

- **Phase:** `p1-foundation` or `p2-calling` or `p3-voicemail`
- **Module:** `numbers`, `devices`, `outbound`, `inbound`, `voicemail-library`, or `voicemail-inbox`
- **Project:** `dialer-rebuild`

## Setting Dependencies

After all issues are created, link dependencies in Linear:

For example, MAI-14 depends on MAI-2 and MAI-13:
1. Open MAI-14 in Linear
2. Click **Related** (or **Link**)
3. Add: "blocked by MAI-2", "blocked by MAI-13"

Dependencies are listed in `tasks/linear-issues.md` under each issue.

## Checkpoints

Mark these as **Epic** or add a **Checkpoint** label:

- **Checkpoint: Phase 1 Complete** (after MAI-12)
- **Checkpoint: Phase 2a Complete** (after MAI-29)
- **Checkpoint: Phase 2b Complete** (after MAI-40)
- **Checkpoint: Phase 3 Complete** (after MAI-57)

## Next Steps

Once all issues are in Linear:

1. Start with MAI-1: Add Call & PhoneNumber schema
2. Work through Phase 1 (MAI-1 to MAI-12)
3. When complete, review Phase 1 and move to Phase 2a
4. Each issue: move to **In Progress** when starting, then to **In Review** when done

See CLAUDE.md for Linear workflow rules.
