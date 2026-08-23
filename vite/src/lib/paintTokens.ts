import type { AttributeDef } from './crmTypes'

// The muted palette a painted cell may reference (design-system.md → Color →
// "Category and option colors come from --option-1…8"). Mirrors the server's
// PAINT_TOKENS in server/src/crm/cellStyleService.ts.
export const PAINT_TOKENS = ['option-1', 'option-2', 'option-3', 'option-4', 'option-5', 'option-6', 'option-7', 'option-8'] as const
export type PaintToken = (typeof PAINT_TOKENS)[number]

// A stored scalar cell is the only cell paint may touch (SPEC-CHUNK-2 J2.5 §D):
// persisted (not list-only), single-valued (not multi), and not a computed `ai`
// cell. Mirrors the server's isStoredScalarCell.
export function isStoredScalarCell(attribute: Pick<AttributeDef, 'storage' | 'isMulti' | 'type'>): boolean {
  return attribute.storage !== 'list' && !attribute.isMulti && attribute.type !== 'ai'
}
