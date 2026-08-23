import prisma from '../db.js'
import { canViewSavedView } from './savedViewPolicy.js'
import { isPaintToken } from './cellStyleService.js'
import type { Prisma } from '../generated/prisma/client.js'

export class ColorRuleNotFoundError extends Error {}
export class ColorRuleValidationError extends Error {}

// The typed predicate a rule evaluates (SPEC-CHUNK-2 J2.5 §C / journey 4b.4):
// today-relative ops need no value; eq/gt/lt compare against `value`.
export const PREDICATE_OPS = ['before_today', 'is_today', 'after_today', 'eq', 'gt', 'lt'] as const
export type PredicateOp = (typeof PREDICATE_OPS)[number]

export const COLOR_RULE_TARGETS = ['background', 'text', 'dot'] as const
export type ColorRuleTarget = (typeof COLOR_RULE_TARGETS)[number]

export const COLOR_RULE_SCOPES = ['cell', 'subvalue'] as const
export type ColorRuleScope = (typeof COLOR_RULE_SCOPES)[number]

export interface ColorRulePredicate {
  op: PredicateOp
  value?: string | number | null
}

// The seeded due-date temperature (journey 4b.4): overdue red, today amber,
// upcoming green. Tokens are the muted palette names (--option-1…8), never hex.
const TEMPERATURE_RULES: Array<{ op: PredicateOp; color: string }> = [
  { op: 'before_today', color: 'option-5' },
  { op: 'is_today', color: 'option-6' },
  { op: 'after_today', color: 'option-7' },
]

type ColorRuleAccessInput = { orgId: string; viewId: string; userId: string }

type CreateColorRuleInput = ColorRuleAccessInput & {
  attribute: string
  predicate: ColorRulePredicate
  target: ColorRuleTarget
  scope: ColorRuleScope
  color: string
  sortOrder: number
  enabled: boolean
}

type UpdateColorRuleInput = ColorRuleAccessInput & {
  ruleId: string
  attribute?: string
  predicate?: ColorRulePredicate
  target?: ColorRuleTarget
  scope?: ColorRuleScope
  color?: string
  sortOrder?: number
  enabled?: boolean
}

function isPredicateOp(value: unknown): value is PredicateOp {
  return typeof value === 'string' && (PREDICATE_OPS as readonly string[]).includes(value)
}

function isTarget(value: unknown): value is ColorRuleTarget {
  return typeof value === 'string' && (COLOR_RULE_TARGETS as readonly string[]).includes(value)
}

function isScope(value: unknown): value is ColorRuleScope {
  return typeof value === 'string' && (COLOR_RULE_SCOPES as readonly string[]).includes(value)
}

function validatePredicate(predicate: unknown): ColorRulePredicate {
  if (!predicate || typeof predicate !== 'object' || Array.isArray(predicate)) {
    throw new ColorRuleValidationError('A rule needs a predicate.')
  }
  const record = predicate as Record<string, unknown>
  if (!isPredicateOp(record.op)) throw new ColorRuleValidationError('Unknown predicate operator.')
  const needsValue = record.op === 'eq' || record.op === 'gt' || record.op === 'lt'
  if (needsValue && record.value === undefined) {
    throw new ColorRuleValidationError('This predicate needs a value to compare against.')
  }
  return { op: record.op, value: record.value as string | number | null | undefined }
}

function toPredicateJson(predicate: ColorRulePredicate): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(predicate)) as Prisma.InputJsonValue
}

export class ColorRuleService {
  private async findVisibleView({ orgId, viewId, userId }: ColorRuleAccessInput) {
    const view = await prisma.savedView.findFirst({ where: { id: viewId, orgId, deletedAt: null } })
    if (!view || !canViewSavedView(view, userId)) throw new ColorRuleNotFoundError('Saved view not found')
    return view
  }

  private async loadAttribute(orgId: string, objectId: string, attributeId: string) {
    const attribute = await prisma.attributeDef.findFirst({
      where: { id: attributeId, orgId, objectId, deletedAt: null, isArchived: false },
    })
    if (!attribute) throw new ColorRuleValidationError('Field not found on this object.')
    return attribute
  }

  // The first date/timestamp field of the view's object, or null when the object
  // has no date to key a temperature rule off. A plain id, not a relation, so the
  // seed stays independent of which object the view shows.
  private async findDueDateAttribute(orgId: string, objectId: string) {
    return prisma.attributeDef.findFirst({
      where: { orgId, objectId, deletedAt: null, isArchived: false, type: { in: ['date', 'timestamp'] } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  }

  // Seed the due-date temperature rules idempotently: only when the view has no
  // default rule yet, and never touching an existing rule. A user's edits to a
  // default rule keep its isDefault flag, so a later seed run still skips it.
  private async seedTemperatureRules(viewId: string, orgId: string, objectId: string) {
    const existing = await prisma.colorRule.findFirst({ where: { viewId, orgId, isDefault: true }, select: { id: true } })
    if (existing) return
    const dueDate = await this.findDueDateAttribute(orgId, objectId)
    if (!dueDate) return
    await prisma.colorRule.createMany({
      data: TEMPERATURE_RULES.map((rule, index) => ({
        orgId,
        viewId,
        attribute: dueDate.id,
        predicate: toPredicateJson({ op: rule.op }),
        target: 'background',
        scope: 'cell',
        color: rule.color,
        sortOrder: index,
        isDefault: true,
        enabled: true,
      })),
    })
  }

  async list({ orgId, viewId, userId }: ColorRuleAccessInput) {
    const view = await this.findVisibleView({ orgId, viewId, userId })
    await this.seedTemperatureRules(view.id, orgId, view.objectId)
    const colorRules = await prisma.colorRule.findMany({
      where: { orgId, viewId: view.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return colorRules
  }

  async create(input: CreateColorRuleInput) {
    const view = await this.findVisibleView(input)
    await this.loadAttribute(input.orgId, view.objectId, input.attribute)
    const predicate = validatePredicate(input.predicate)
    if (!isTarget(input.target)) throw new ColorRuleValidationError('Unknown rule target.')
    if (!isScope(input.scope)) throw new ColorRuleValidationError('Unknown rule scope.')
    if (!isPaintToken(input.color)) throw new ColorRuleValidationError('Unknown colour.')
    const colorRule = await prisma.colorRule.create({
      data: {
        orgId: input.orgId,
        viewId: view.id,
        attribute: input.attribute,
        predicate: toPredicateJson(predicate),
        target: input.target,
        scope: input.scope,
        color: input.color,
        sortOrder: input.sortOrder,
        enabled: input.enabled,
      },
    })
    return colorRule
  }

  async update(input: UpdateColorRuleInput) {
    const view = await this.findVisibleView(input)
    const existing = await prisma.colorRule.findFirst({ where: { id: input.ruleId, viewId: view.id, orgId: input.orgId } })
    if (!existing) throw new ColorRuleNotFoundError('Rule not found')
    if (input.attribute !== undefined) await this.loadAttribute(input.orgId, view.objectId, input.attribute)
    const predicate = input.predicate !== undefined ? validatePredicate(input.predicate) : undefined
    if (input.target !== undefined && !isTarget(input.target)) throw new ColorRuleValidationError('Unknown rule target.')
    if (input.scope !== undefined && !isScope(input.scope)) throw new ColorRuleValidationError('Unknown rule scope.')
    if (input.color !== undefined && !isPaintToken(input.color)) throw new ColorRuleValidationError('Unknown colour.')
    const colorRule = await prisma.colorRule.update({
      where: { id: existing.id },
      data: {
        ...(input.attribute !== undefined ? { attribute: input.attribute } : {}),
        ...(predicate !== undefined ? { predicate: toPredicateJson(predicate) } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    })
    return colorRule
  }

  async delete({ orgId, viewId, userId, ruleId }: ColorRuleAccessInput & { ruleId: string }) {
    const view = await this.findVisibleView({ orgId, viewId, userId })
    const deleted = await prisma.colorRule.deleteMany({ where: { id: ruleId, viewId: view.id, orgId } })
    if (deleted.count === 0) throw new ColorRuleNotFoundError('Rule not found')
  }

  async reorder({ orgId, viewId, userId, ruleIds }: ColorRuleAccessInput & { ruleIds: string[] }) {
    const view = await this.findVisibleView({ orgId, viewId, userId })
    const rules = await prisma.colorRule.findMany({ where: { id: { in: ruleIds }, viewId: view.id, orgId } })
    if (rules.length !== ruleIds.length) throw new ColorRuleNotFoundError('Rule not found')
    await prisma.$transaction(ruleIds.map((id, sortOrder) => prisma.colorRule.updateMany({
      where: { id, viewId: view.id, orgId }, data: { sortOrder },
    })))
  }

  // Reset the seeded set: drop every default rule and re-seed the temperature
  // rules fresh. This is the explicit "Reset to defaults" action, so it is the
  // one place a user's edits to a default rule are intentionally replaced.
  async restoreDefaults({ orgId, viewId, userId }: ColorRuleAccessInput) {
    const view = await this.findVisibleView({ orgId, viewId, userId })
    await prisma.colorRule.deleteMany({ where: { viewId: view.id, orgId, isDefault: true } })
    await this.seedTemperatureRules(view.id, orgId, view.objectId)
    return prisma.colorRule.findMany({
      where: { orgId, viewId: view.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
  }
}

export const colorRuleService = new ColorRuleService()
