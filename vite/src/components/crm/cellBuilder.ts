import { GridCellKind } from '@glideapps/glide-data-grid'
import type { GridCell, Theme } from '@glideapps/glide-data-grid'

import type { AttributeDef, AttributeOption } from '@/lib/crmTypes'
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

function textCell(display: string, opts: { readOnly: boolean; flagged?: boolean }): GridCell {
  return {
    kind: GridCellKind.Text,
    data: display,
    displayData: display,
    allowOverlay: !opts.readOnly,
    readonly: opts.readOnly,
    themeOverride: opts.flagged ? FLAGGED_THEME : undefined,
  }
}

export interface BuildGridCellOptions {
  timeZone: string | null | undefined
  flagged?: boolean
}

/** Renderer + editor per `AttributeDef.type` (issue MAI-169 / CHUNK-1 §C). */
export function buildGridCell(attr: AttributeDef, value: unknown, opts: BuildGridCellOptions): GridCell {
  switch (attr.type) {
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

    case 'currency': {
      const num = typeof value === 'number' ? value : undefined
      return {
        kind: GridCellKind.Number,
        data: num,
        displayData: num === undefined ? '' : num.toFixed(2),
        allowOverlay: !attr.isReadOnly,
        readonly: attr.isReadOnly,
      }
    }

    case 'select':
    case 'status':
    case 'multiselect': {
      const options = parseOptions(attr.optionsJson)
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

    // Editing a reference is a picker UI (CHUNK-3 composite cells) — out of
    // this slice. Render the current value read-only rather than fake an
    // editor with nowhere to write.
    case 'record_reference':
    case 'user_reference':
    case 'ai':
      return textCell(String(value ?? ''), { readOnly: true })

    default: {
      const display = opts.flagged ? String(value ?? '') : formatCellValue(value, attr.type, opts.timeZone)
      return textCell(display, { readOnly: attr.isReadOnly, flagged: opts.flagged })
    }
  }
}
