import prisma from '../db.js'
import { canViewSavedView } from './savedViewPolicy.js'

export class CellStyleNotFoundError extends Error {}
export class CellStyleValidationError extends Error {}

// The muted palette a painted cell may reference (design-system.md → Color →
// "Category and option colors come from --option-1…8"). Stored as the token
// name, never a hex, so dark mode and monochrome stay correct.
export const PAINT_TOKENS = ['option-1', 'option-2', 'option-3', 'option-4', 'option-5', 'option-6', 'option-7', 'option-8'] as const
export type PaintToken = (typeof PAINT_TOKENS)[number]

export function isPaintToken(value: unknown): value is PaintToken {
  return typeof value === 'string' && (PAINT_TOKENS as readonly string[]).includes(value)
}

// A stored scalar cell is the only cell paint may touch (SPEC-CHUNK-2 J2.5 §D):
// it is persisted (not a list-only field), single-valued (not multi), and not a
// computed `ai` cell. Composite/subvalue paint belongs to Chunk 3.
export function isStoredScalarCell(attribute: { storage: string; isMulti: boolean; type: string }): boolean {
  return attribute.storage !== 'list' && !attribute.isMulti && attribute.type !== 'ai'
}

type CellStyleAccessInput = { orgId: string; viewId: string; userId: string }

type UpsertCellStyleInput = CellStyleAccessInput & {
  recordId: string
  fieldId: string
  backgroundToken: string | null
  textToken: string | null
}

export class CellStyleService {
  private async findVisibleView({ orgId, viewId, userId }: CellStyleAccessInput) {
    const view = await prisma.savedView.findFirst({ where: { id: viewId, orgId, deletedAt: null } })
    if (!view || !canViewSavedView(view, userId)) throw new CellStyleNotFoundError('Saved view not found')
    return view
  }

  private async loadStoredScalarField(orgId: string, objectId: string, fieldId: string) {
    const attribute = await prisma.attributeDef.findFirst({
      where: { id: fieldId, orgId, objectId, deletedAt: null, isArchived: false },
    })
    if (!attribute) throw new CellStyleValidationError('Field not found on this object.')
    if (!isStoredScalarCell(attribute)) throw new CellStyleValidationError('Paint is only available on stored scalar cells.')
    return attribute
  }

  async list({ orgId, viewId, userId }: CellStyleAccessInput) {
    const view = await this.findVisibleView({ orgId, viewId, userId })
    const cellStyles = await prisma.cellStyle.findMany({
      where: { orgId, viewId: view.id },
      orderBy: [{ recordId: 'asc' }, { fieldId: 'asc' }],
    })
    return cellStyles
  }

  async upsert(input: UpsertCellStyleInput) {
    const view = await this.findVisibleView(input)
    await this.loadStoredScalarField(input.orgId, view.objectId, input.fieldId)

    const backgroundToken = input.backgroundToken === null ? null : input.backgroundToken
    const textToken = input.textToken === null ? null : input.textToken
    if (backgroundToken !== null && !isPaintToken(backgroundToken)) {
      throw new CellStyleValidationError('Unknown background colour.')
    }
    if (textToken !== null && !isPaintToken(textToken)) {
      throw new CellStyleValidationError('Unknown text colour.')
    }
    // A paint with neither channel is a no-op: remove the row rather than keep a
    // dead entry that would still shadow a later paint.
    if (backgroundToken === null && textToken === null) {
      await prisma.cellStyle.deleteMany({ where: { viewId: view.id, recordId: input.recordId, fieldId: input.fieldId } })
      return null
    }

    const cellStyle = await prisma.cellStyle.upsert({
      where: { viewId_recordId_fieldId: { viewId: view.id, recordId: input.recordId, fieldId: input.fieldId } },
      create: {
        orgId: input.orgId,
        viewId: view.id,
        recordId: input.recordId,
        fieldId: input.fieldId,
        backgroundToken,
        textToken,
      },
      update: { backgroundToken, textToken },
    })
    return cellStyle
  }
}

export const cellStyleService = new CellStyleService()
