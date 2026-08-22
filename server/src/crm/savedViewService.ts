import prisma from '../db.js'
import { canEditSavedView, canViewSavedView, repairSavedViewConfig, type ViewAttribute, type ViewLayout } from './savedViews.js'
import type { Prisma } from '../generated/prisma/client.js'

export class SavedViewConfigValidationError extends Error {}
export class SavedViewNotFoundError extends Error {}
export class SavedViewConflictError extends Error {}

type CreateSavedViewInput = {
  orgId: string
  objectId: string
  ownerUserId: string
  name: string
  layout: ViewLayout
  configJson: unknown
}

type ViewAccessInput = { orgId: string; objectId: string; viewId: string; userId: string }

type UpdateSavedViewInput = ViewAccessInput & {
  name?: string
  layout?: ViewLayout
  configJson?: unknown
  isShared?: boolean
}

function configAttributeIds(configJson: Record<string, unknown>): string[] {
  const ids: string[] = []
  const collect = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const record = value as Record<string, unknown>
    if (typeof record.attributeId === 'string') ids.push(record.attributeId)
    if (Array.isArray(record.children)) record.children.forEach(collect)
  }
  for (const key of ['columns', 'sorts', 'groupBy', 'columnStyles']) {
    const value = configJson[key]
    if (Array.isArray(value)) value.forEach(collect)
  }
  collect(configJson.filterTree)
  if (configJson.columnWidths && typeof configJson.columnWidths === 'object' && !Array.isArray(configJson.columnWidths)) {
    ids.push(...Object.keys(configJson.columnWidths))
  }
  return ids
}

function validateConfigAttributeIds(configJson: unknown, attributes: ViewAttribute[]) {
  if (!configJson || typeof configJson !== 'object' || Array.isArray(configJson)) {
    throw new SavedViewConfigValidationError('configJson must be a JSON object.')
  }
  const knownIds = new Set(attributes.filter((attribute) => !attribute.isArchived && !attribute.deletedAt && attribute.storage !== 'list').map((attribute) => attribute.id))
  const unknownId = configAttributeIds(configJson as Record<string, unknown>).find((id) => !knownIds.has(id))
  if (unknownId) throw new SavedViewConfigValidationError(`configJson references unknown attribute ${unknownId}.`)
}

function toConfigJson(config: ReturnType<typeof repairSavedViewConfig>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue
}

export class SavedViewService {
  private async loadObjectAndAttributes(orgId: string, objectId: string) {
    const object = await prisma.objectDef.findFirst({
      where: { id: objectId, orgId, deletedAt: null },
      select: { id: true },
    })
    if (!object) throw new SavedViewNotFoundError('Object not found')
    const attributes = await prisma.attributeDef.findMany({
      where: { orgId, objectId, deletedAt: null, isArchived: false },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return { object, attributes }
  }

  private async findVisibleView({ orgId, objectId, viewId, userId }: ViewAccessInput) {
    const view = await prisma.savedView.findFirst({ where: { id: viewId, orgId, objectId, deletedAt: null } })
    if (!view || !canViewSavedView(view, userId)) throw new SavedViewNotFoundError('Saved view not found')
    return view
  }

  async create(input: CreateSavedViewInput) {
    const { attributes } = await this.loadObjectAndAttributes(input.orgId, input.objectId)
    validateConfigAttributeIds(input.configJson, attributes)
    const configJson = toConfigJson(repairSavedViewConfig(input.configJson, attributes))
    const view = await prisma.savedView.create({
      data: {
        orgId: input.orgId,
        objectId: input.objectId,
        ownerUserId: input.ownerUserId,
        name: input.name,
        layout: input.layout,
        configJson,
        isShared: false,
        isDefault: false,
      },
    })
    return { view, attributes }
  }

  async list(orgId: string, objectId: string, userId: string) {
    const { attributes } = await this.loadObjectAndAttributes(orgId, objectId)
    const views = await prisma.savedView.findMany({
      where: { orgId, objectId, deletedAt: null, OR: [{ ownerUserId: userId }, { isShared: true }] },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    })
    return { views, attributes }
  }

  async get(input: ViewAccessInput) {
    const view = await this.findVisibleView(input)
    const { attributes } = await this.loadObjectAndAttributes(input.orgId, input.objectId)
    return { view, attributes }
  }

  async update(input: UpdateSavedViewInput) {
    const view = await this.findVisibleView(input)
    if (!canEditSavedView(view, input.userId)) throw new SavedViewNotFoundError('Saved view not found')
    if (input.isShared !== undefined && input.isShared !== view.isShared && view.isDefault) {
      throw new SavedViewConflictError('Choose another default before changing this view’s visibility.')
    }
    const { attributes } = await this.loadObjectAndAttributes(input.orgId, input.objectId)
    if (input.configJson !== undefined) validateConfigAttributeIds(input.configJson, attributes)
    const updated = await prisma.savedView.updateMany({
      where: { id: view.id, orgId: input.orgId, objectId: input.objectId, deletedAt: null },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.layout !== undefined ? { layout: input.layout } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
        ...(input.configJson !== undefined ? { configJson: toConfigJson(repairSavedViewConfig(input.configJson, attributes)) } : {}),
      },
    })
    if (updated.count === 0) throw new SavedViewNotFoundError('Saved view not found')
    const current = await prisma.savedView.findFirst({ where: { id: view.id, orgId: input.orgId, objectId: input.objectId, deletedAt: null } })
    if (!current) throw new SavedViewNotFoundError('Saved view not found')
    return { view: current, attributes }
  }

  async duplicate(input: ViewAccessInput) {
    const source = await this.findVisibleView(input)
    const { attributes } = await this.loadObjectAndAttributes(input.orgId, input.objectId)
    const view = await prisma.savedView.create({
      data: {
        orgId: input.orgId,
        objectId: input.objectId,
        ownerUserId: input.userId,
        name: `${source.name} copy`,
        layout: source.layout,
        configJson: toConfigJson(repairSavedViewConfig(source.configJson, attributes)),
        isShared: false,
        isDefault: false,
      },
    })
    return { view, attributes }
  }

  async setDefault(input: ViewAccessInput) {
    const view = await this.findVisibleView(input)
    if (!canEditSavedView(view, input.userId)) throw new SavedViewNotFoundError('Saved view not found')
    const audience = view.isShared ? { isShared: true } : { isShared: false, ownerUserId: view.ownerUserId }
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ObjectDef" WHERE id = ${input.objectId} AND "orgId" = ${input.orgId} FOR UPDATE`
      await tx.savedView.updateMany({ where: { orgId: input.orgId, objectId: input.objectId, deletedAt: null, ...audience }, data: { isDefault: false } })
      const updated = await tx.savedView.updateMany({ where: { id: view.id, orgId: input.orgId, objectId: input.objectId, deletedAt: null, ...audience }, data: { isDefault: true } })
      if (updated.count === 0) throw new SavedViewNotFoundError('Saved view not found')
    })
  }

  async reorder(orgId: string, objectId: string, userId: string, viewIds: string[]) {
    const { attributes } = await this.loadObjectAndAttributes(orgId, objectId)
    const views = await prisma.savedView.findMany({ where: { id: { in: viewIds }, orgId, objectId, deletedAt: null } })
    if (views.length !== viewIds.length || views.some((view) => !canEditSavedView(view, userId))) {
      throw new SavedViewNotFoundError('Saved view not found')
    }
    await prisma.$transaction(viewIds.map((id, sortOrder) => prisma.savedView.updateMany({
      where: { id, orgId, objectId, deletedAt: null }, data: { sortOrder },
    })))
    const ordered = await prisma.savedView.findMany({ where: { id: { in: viewIds }, orgId, objectId, deletedAt: null }, orderBy: { sortOrder: 'asc' } })
    return { views: ordered, attributes }
  }

  async delete(input: ViewAccessInput) {
    const view = await this.findVisibleView(input)
    if (!canEditSavedView(view, input.userId)) throw new SavedViewNotFoundError('Saved view not found')
    if (view.isDefault) throw new SavedViewConflictError('Choose another default before deleting this view.')
    const deleted = await prisma.savedView.updateMany({
      where: { id: view.id, orgId: input.orgId, objectId: input.objectId, deletedAt: null, isDefault: false },
      data: { deletedAt: new Date() },
    })
    if (deleted.count === 0) throw new SavedViewNotFoundError('Saved view not found')
    return { undoToken: view.id }
  }

  async undoDelete(input: ViewAccessInput) {
    const view = await prisma.savedView.findFirst({
      where: { id: input.viewId, orgId: input.orgId, objectId: input.objectId, deletedAt: { not: null } },
    })
    if (!view || !canEditSavedView(view, input.userId)) throw new SavedViewNotFoundError('Saved view not found')
    const restored = await prisma.savedView.updateMany({
      where: { id: view.id, orgId: input.orgId, objectId: input.objectId, deletedAt: { not: null } },
      data: { deletedAt: null },
    })
    if (restored.count === 0) throw new SavedViewNotFoundError('Saved view not found')
  }
}

export const savedViewService = new SavedViewService()
