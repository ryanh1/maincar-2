import { GridCellKind } from '@glideapps/glide-data-grid'
import type { CustomCell, CustomRenderer } from '@glideapps/glide-data-grid'

import type { AttributeDef } from '@/lib/crmTypes'
import { FieldEditorCellEditor } from './FieldEditorCellEditor'
import { formatCellValue } from './recordCellValue'

export interface FieldEditorCellData {
  readonly kind: 'field-editor-cell'
  readonly attribute: AttributeDef
  readonly value: unknown
  readonly orgId: string
  readonly timeZone: string | null | undefined
  readonly currencyCode: string | undefined
}

export type FieldEditorCell = CustomCell<FieldEditorCellData>

/** Canvas display plus a React overlay that reuses the drawer's field editor. */
export const fieldEditorCellRenderer: CustomRenderer<FieldEditorCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell): cell is FieldEditorCell => (cell.data as { kind?: unknown })?.kind === 'field-editor-cell',
  draw: ({ ctx, rect, theme }, cell) => {
    const { attribute, value, timeZone, currencyCode } = cell.data
    const display = formatCellValue(value, attribute.type, timeZone, currencyCode, attribute.slug === 'amountMinor', attribute.formatJson)
    ctx.font = theme.baseFontStyle
    ctx.fillStyle = theme.textDark
    ctx.textBaseline = 'middle'
    ctx.fillText(display, rect.x + 8, rect.y + rect.height / 2 + 1)
    return true
  },
  provideEditor: () => ({ editor: FieldEditorCellEditor, disablePadding: true }),
}
