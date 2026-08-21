/**
 * seedOrg — give a new org its standard CRM schema, in one transaction, idempotently.
 *
 * Runs right after an Org row is created (see routes/team.ts). In one transaction so
 * a half-seeded org can never exist. Every insert is find-missing-then-create keyed
 * on the same unique keys the database enforces — (orgId, slug) for objects,
 * (objectId, slug) for attributes — so:
 *
 *   - Running it twice is a no-op (idempotent). Safe to re-run.
 *   - Running it on an EXISTING org is a versioned backfill: it inserts only what is
 *     missing and NEVER updates a row that already exists. A renamed label, a
 *     recolored or user-added picklist option, and a hidden field all survive,
 *     because backfill is insert-missing-only (spec §10.2). This is why value ≠
 *     label matters: a new standard field is added by slug without touching labels.
 *
 * The org's `seedVersion` is stamped to CURRENT_SEED_VERSION at the end, recording
 * the last seed applied so a future release's backfill can find orgs behind the
 * current version.
 *
 * The seed DATA lives in ./standardObjects.ts — edit that, bump CURRENT_SEED_VERSION,
 * and this function backfills the difference into every existing org.
 */
import prisma from '../db.js'
import type { Prisma, PrismaClient } from '../generated/prisma/client.js'
import {
  CURRENT_SEED_VERSION,
  DEFAULT_PIPELINE,
  STANDARD_OBJECTS,
  type SeedAttribute,
} from './standardObjects.js'

// A client that can run the model queries the seed needs. Both the base PrismaClient
// and an interactive-transaction client (Prisma.TransactionClient) satisfy it, so
// seedOrgInTx can run inside a caller's transaction OR inside our own.
type SeedClient = Prisma.TransactionClient

/**
 * The transactional body of the seed. Call this when you already hold a transaction
 * — e.g. org creation, which creates the Org, the admin Membership, and the seed in
 * ONE transaction so they commit or roll back together.
 */
export async function seedOrgInTx(tx: SeedClient, orgId: string): Promise<void> {
  // --- Standard objects, then their attributes (objects first so refObjectId resolves) ---
  const objectIdBySlug = new Map<string, string>()

  for (const obj of STANDARD_OBJECTS) {
    // Insert-missing-only: if the ObjectDef already exists we keep it untouched
    // (its name may have been renamed, it may have been hidden). We only need its id.
    const existing = await tx.objectDef.findFirst({
      where: { orgId, slug: obj.slug },
      select: { id: true },
    })
    if (existing) {
      objectIdBySlug.set(obj.slug, existing.id)
      continue
    }
    const created = await tx.objectDef.create({
      data: {
        orgId,
        slug: obj.slug,
        name: obj.name,
        namePlural: obj.namePlural,
        icon: obj.icon,
        storage: obj.storage,
        isStandard: true,
        isFirstClass: obj.isFirstClass,
      },
      select: { id: true },
    })
    objectIdBySlug.set(obj.slug, created.id)
  }

  // Attributes, resolving record_reference targets against the object map above.
  for (const obj of STANDARD_OBJECTS) {
    const objectId = objectIdBySlug.get(obj.slug)!
    for (const attr of obj.attributes) {
      const existing = await tx.attributeDef.findFirst({
        where: { objectId, slug: attr.slug },
        select: { id: true },
      })
      // Insert-missing-only: an existing attribute is left exactly as it is — its
      // label, its optionsJson (which may carry user-added or recolored options),
      // and its isArchived flag are the user's, never overwritten by a re-seed.
      if (existing) continue

      await tx.attributeDef.create({ data: buildAttributeData(orgId, objectId, attr, objectIdBySlug) })
    }
  }

  // --- The default pipeline + its stages ---
  // Idempotent as a unit: if a default pipeline already exists we touch nothing,
  // so a re-seed never duplicates the stages and never rewrites a renamed stage.
  const existingPipeline = await tx.pipeline.findFirst({
    where: { orgId, name: DEFAULT_PIPELINE.name },
    select: { id: true },
  })
  if (!existingPipeline) {
    const pipeline = await tx.pipeline.create({
      data: { orgId, name: DEFAULT_PIPELINE.name, isDefault: true },
      select: { id: true },
    })
    for (const stage of DEFAULT_PIPELINE.stages) {
      await tx.pipelineStage.create({
        data: {
          orgId,
          pipelineId: pipeline.id,
          name: stage.name,
          color: stage.color,
          sortOrder: stage.sortOrder,
          winProbability: stage.winProbability,
          outcome: stage.outcome,
        },
      })
    }
  }

  // --- Stamp the seed version last, inside the same transaction ---
  await tx.org.update({ where: { id: orgId }, data: { seedVersion: CURRENT_SEED_VERSION } })
}

/**
 * Seed (or backfill) an org, wrapping its own transaction. Use this from anywhere
 * that is NOT already inside a transaction — the backfill job, a script, tests.
 * Inside org creation, call seedOrgInTx with the existing tx instead.
 */
export async function seedOrg(
  orgId: string,
  client: PrismaClient = prisma,
): Promise<void> {
  await client.$transaction((tx) => seedOrgInTx(tx, orgId))
}

// Turn a SeedAttribute into a Prisma create payload, resolving a record_reference's
// refObjectSlug to the real ObjectDef id created earlier in this seed.
function buildAttributeData(
  orgId: string,
  objectId: string,
  attr: SeedAttribute,
  objectIdBySlug: Map<string, string>,
): Prisma.AttributeDefUncheckedCreateInput {
  return {
    orgId,
    objectId,
    slug: attr.slug,
    name: attr.name,
    description: attr.description,
    type: attr.type,
    storage: attr.storage,
    sortOrder: attr.sortOrder,
    isSystem: attr.isSystem ?? false,
    isIdentity: attr.isIdentity ?? false,
    isRequired: attr.isRequired ?? false,
    isUnique: attr.isUnique ?? false,
    isMulti: attr.isMulti ?? false,
    isReadOnly: attr.isReadOnly ?? false,
    ...(attr.refObjectSlug ? { refObjectId: objectIdBySlug.get(attr.refObjectSlug) ?? null } : {}),
    ...(attr.optionsJson ? { optionsJson: attr.optionsJson as unknown as Prisma.InputJsonValue } : {}),
  }
}
