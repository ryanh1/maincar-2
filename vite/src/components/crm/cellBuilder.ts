import { GridCellKind } from '@glideapps/glide-data-grid'
import type { GridCell, Theme } from '@glideapps/glide-data-grid'

import type { AttributeDef, AttributeOption } from '@/lib/crmTypes'
import { resolveOptionColorHex } from '@/lib/optionPalette'
import {
  coerceCheckbox,
  coerceDate,
  coerceEmail,
  coercePhone,
  coerceTimestamp,
  coerceUrl,
  type CoercionResult,
} from './cellCoercion'
import type { ChipCellData } from './chipCell'
import type { FieldEditorCellData } from './fieldEditorCell'
import { formatCellValue } from './recordCellValue'

export function parseOptions(optionsJson: unknown): AttributeOption[] {
  if (!Array.isArray(optionsJson)) return []
  return optionsJson.filter(
    (option): option is AttributeOption =>
      typeof option === 'object' && option !== null && typeof (option as { value?: unknown }).value === 'string',
  )
}

// Text-kind cells whose typed/pasted value needs coercion beyond a pass-through
// string. `number`/`currency`/`rating` use glide's native Number cell instead,
// so they aren't in this map; `checkbox` uses the native Boolean cell for
// clicks but still goes through here for pasted text ("yes"/"x"/etc).
export function coerceForType(attr: AttributeDef, raw: string, existingValue: unknown): CoercionResult {
  switch (attr.type) {
    case 'phone':
      return coercePhone(raw, typeof existingValue === 'string' ? existingValue : null)
    case 'date':
      return coerceDate(raw)
    case 'timestamp':
      return coerceTimestamp(raw)
    case 'url':
    case 'domain':
      return coerceUrl(raw)
    case 'email':
      return coerceEmail(raw)
    case 'checkbox':
      return coerceCheckbox(raw)
    default:
      return { ok: true, value: raw === '' ? null : raw, display: raw }
  }
}

// A red-tinted cell theme, applied when `coerceForType` flagged the stored
// value rather than dropping it (issue: "accept-but-flag ... never silent
// drop"). Approximates the spec's "red outline + reason" — the reason itself
// has no on-canvas home yet without a bespoke draw override, so it stays in
// the coercion result for a caller (e.g. a toast) to surface.
export const FLAGGED_THEME: Partial<Theme> = { textDark: '#dc2626', accentColor: '#dc2626' }

function textCell(display: string, opts: { readOnly: boolean; flagged?: boolean; wrap?: boolean }): GridCell {
  return {
    kind: GridCellKind.Text,
    data: display,
    displayData: display,
    allowOverlay: !opts.readOnly,
    readonly: opts.readOnly,
    allowWrapping: opts.wrap,
    themeOverride: opts.flagged ? FLAGGED_THEME : undefined,
  }
}

export interface BuildGridCellOptions {
  timeZone: string | null | undefined
  orgId?: string
  currencyCode?: string
  flagged?: boolean
  wrap?: boolean
  /** Theme-aware token→hex map (useGridColors), so chip option colors stay correct in dark mode. */
  paintColors?: Record<string, string>
}

function fieldEditorCell(attr: AttributeDef, value: unknown, opts: BuildGridCellOptions): GridCell {
  const data: FieldEditorCellData = {
    kind: 'field-editor-cell',
    attribute: attr,
    value,
    orgId: opts.orgId ?? '',
    timeZone: opts.timeZone,
    currencyCode: opts.currencyCode,
  }
  return {
    kind: GridCellKind.Custom,
    data,
    copyData: formatCellValue(value, attr.type, opts.timeZone, opts.currencyCode, attr.slug === 'amountMinor', attr.formatJson),
    allowOverlay: !attr.isReadOnly,
    readonly: attr.isReadOnly,
  }
}

/** Renderer + editor per `AttributeDef.type` (issue MAI-169 / CHUNK-1 §C). */
export function buildGridCell(attr: AttributeDef, value: unknown, opts: BuildGridCellOptions): GridCell {
  switch (attr.type) {
    case 'date':
    case 'timestamp':
    case 'currency':
    case 'record_reference':
    case 'user_reference':
      return fieldEditorCell(attr, value, opts)

    case 'checkbox':
      return {
        kind: GridCellKind.Boolean,
        data: Boolean(value),
        allowOverlay: false,
        readonly: attr.isReadOnly,
      }

    case 'number':
    case 'rating': {
      const num = typeof value === 'number' ? value : undefined
      return {
        kind: GridCellKind.Number,
        data: num,
        displayData: num === undefined ? '' : String(num),
        allowOverlay: !attr.isReadOnly,
        readonly: attr.isReadOnly,
      }
    }

    case 'select':
    case 'status':
    case 'multiselect': {
      const options = parseOptions(attr.optionsJson).map((option) => ({
        ...option,
        color: resolveOptionColorHex(option.color, opts.paintColors),
      }))
      const selectedValues = attr.isMulti
        ? Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === 'string')
          : []
        : typeof value === 'string' && value
          ? [value]
          : []
      const data: ChipCellData = {
        kind: 'chip-cell',
        options,
        selectedValues,
        isMulti: attr.isMulti,
        cellReadonly: attr.isReadOnly,
      }
      return {
        kind: GridCellKind.Custom,
        data,
        copyData: selectedValues.join(', '),
        allowOverlay: !attr.isReadOnly,
        readonly: attr.isReadOnly,
      }
    }

    case 'ai':
      return textCell(String(value ?? ''), { readOnly: true, wrap: opts.wrap })

    default: {
      const display = opts.flagged ? String(value ?? '') : formatCellValue(value, attr.type, opts.timeZone, undefined, false, attr.formatJson)
      return textCell(display, { readOnly: attr.isReadOnly, flagged: opts.flagged, wrap: opts.wrap })
    }
  }
}
