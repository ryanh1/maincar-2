import { GridCellKind, roundedRect } from '@glideapps/glide-data-grid'
import type { CustomCell, CustomRenderer } from '@glideapps/glide-data-grid'

import type { AttributeOption } from '@/lib/crmTypes'
import { ChipCellEditor } from './ChipCellEditor'

/**
 * A select/status/multiselect cell (DECISIONS D4): a row of muted chips, one
 * per selected option, with a ▾ caret on the active cell to invite a click.
 * `GridCellKind.Custom` is glide's escape hatch for a cell shape it doesn't
 * ship natively — this registers one `draw` + `provideEditor` pair for it.
 */
export interface ChipCellData {
  readonly kind: 'chip-cell'
  readonly options: readonly AttributeOption[]
  readonly selectedValues: readonly string[]
  readonly isMulti: boolean
  readonly cellReadonly: boolean
}

export type ChipCell = CustomCell<ChipCellData>

export function chipCellSelectedOptions(cell: ChipCell): AttributeOption[] {
  const byValue = new Map(cell.data.options.map((option) => [option.value, option]))
  return cell.data.selectedValues.flatMap((value) => {
    const option = byValue.get(value)
    return option ? [option] : []
  })
}

const CHIP_HEIGHT = 20
const CHIP_PADDING_X = 8
const CHIP_GAP = 6
const CARET_SIZE = 4

function drawCaret(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, color: string) {
  ctx.beginPath()
  ctx.moveTo(centerX - CARET_SIZE, centerY - CARET_SIZE / 2)
  ctx.lineTo(centerX + CARET_SIZE, centerY - CARET_SIZE / 2)
  ctx.lineTo(centerX, centerY + CARET_SIZE / 2)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
}

export const chipCellRenderer: CustomRenderer<ChipCell> = {
  kind: GridCellKind.Custom,
  isMatch: (cell): cell is ChipCell => (cell.data as { kind?: unknown })?.kind === 'chip-cell',
  draw: (args, cell) => {
    const { ctx, rect, theme, highlighted } = args
    const options = chipCellSelectedOptions(cell)

    ctx.font = theme.baseFontStyle
    ctx.textBaseline = 'middle'

    let x = rect.x + 8
    const y = rect.y + (rect.height - CHIP_HEIGHT) / 2
    for (const option of options) {
      const textWidth = ctx.measureText(option.label).width
      const chipWidth = textWidth + CHIP_PADDING_X * 2
      if (x + chipWidth > rect.x + rect.width - 8) break

      ctx.fillStyle = option.color ?? theme.bgBubble
      roundedRect(ctx, x, y, chipWidth, CHIP_HEIGHT, CHIP_HEIGHT / 2)
      ctx.fill()

      ctx.fillStyle = theme.textDark
      ctx.fillText(option.label, x + CHIP_PADDING_X, y + CHIP_HEIGHT / 2 + 1)
      x += chipWidth + CHIP_GAP
    }

    if (highlighted && !cell.data.cellReadonly) {
      drawCaret(ctx, rect.x + rect.width - 14, rect.y + rect.height / 2, theme.textMedium)
    }

    return true
  },
  provideEditor: () => ({
    editor: ChipCellEditor,
    disablePadding: true,
  }),
  onPaste: (val, data) => {
    if (data.cellReadonly) return undefined
    const tokens = val
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
    const matched = data.options
      .filter((option) => tokens.includes(option.label) || tokens.includes(option.value))
      .map((option) => option.value)
    if (matched.length === 0) return undefined
    return { ...data, selectedValues: data.isMulti ? matched : [matched[0]] }
  },
}
