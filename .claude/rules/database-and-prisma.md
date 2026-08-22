---
paths:
  - "server/**"
---

# Database and Prisma

> Split out of the always-loaded CLAUDE.md so it loads only when
> you touch matching files. Same authority as CLAUDE.md. Do not duplicate it back.

## Migrations

- **NEVER write migration SQL by hand.** Always go schema-first:
  1. Edit `server/prisma/schema.prisma`
  2. **Inside an issue-clone worktree**, create the migration with
     `./.claude/scripts/coord/mc-migrate <descriptive_name>`, never a bare
     `prisma migrate dev`. Two sessions once generated a migration in the same
     minute; both got applied to the shared dev database, and an applied
     migration can never be renamed. `mc-migrate` picks a timestamp that can't
     collide with another worktree's, and authors the SQL against a throwaway
     database so Prisma doesn't mistake other sessions' already-applied
     migrations for drift.
  3. Prisma generates the SQL
- For a complex data migration, edit the generated file AFTER Prisma creates it.
- **Never run `prisma migrate reset` or `prisma db push`.**
- **After a merge lands a schema change**, the primary checkout does not
  pick it up automatically — `mc-merge` deliberately skips refreshing it when
  the delivered change touches the Prisma schema, a migration, or a package
  manifest/lockfile, since a half-updated database could break a running dev
  server. Run `./.claude/scripts/coord/mc-local-main refresh` there when you
  actually need that checkout caught up — not as a routine step otherwise.
- **Never `DELETE FROM` a user-data table to satisfy a migration warning.** If Prisma warns
  that a column still holds non-null values, the right move is `UPDATE <table> SET
  <column> = NULL` or a proper data migration. Ask before any destructive SQL.
- If Prisma reports drift: stop, run `npx prisma db pull --print` to inspect the live
  schema, and propose a CLI-only reconciliation plan before executing anything.

## Timestamps on All Models

- **Every model MUST have `createdAt` and `updatedAt`.**

```prisma
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

**Why**: consistent timestamps make auditing, debugging, and sorting possible everywhere.

## No Enums

- **NEVER use a Prisma `enum`.** Use a `String`, document the allowed values in a comment
  beside the field, and define a TypeScript union for type safety.

```prisma
// ✅ Correct
status String @default("PENDING") // PENDING, IN_REVIEW, PASSED, FAILED

// ❌ Wrong
status SubmissionStatus @default(PENDING)
```

**Why**: Postgres enums need an `ALTER TYPE` dance to add or remove a value. A String
column just changes.

## Org Isolation & Security

### Query patterns

- **Every query for org-scoped data includes an `orgId` filter — reads AND writes.**
- Single-record lookup: `findFirst({ where: { id, orgId } })`
- Mutations: `updateMany({ where: { id, orgId } })` / `deleteMany({ where: { id, orgId } })`
- **Never** use `update({ where: { id } })` or `delete({ where: { id } })` for org-scoped
  data.

```typescript
// ✅ Correct — defense in depth
const result = await prisma.thing.updateMany({ where: { id, orgId }, data })
if (result.count === 0) return void res.status(404).json({ error: 'Not found' })

// ❌ Wrong — a caller from another org can write this row
await prisma.thing.update({ where: { id }, data })
```

**Why**: Prisma's `update()` only accepts unique fields in `where`. Going through
`updateMany` with `orgId` makes a cross-org write fail even if an ownership check above it
was bypassed.

- `orgId` always comes from the verified token (`req.user.orgId`), NEVER from the request
  body or a query param.
- Public routes must not expose fields that authenticated routes do.
