import { parseDate } from 'chrono-node'

interface CommandAttribute {
  type: string
  options?: readonly { value: string; label: string }[]
}

export type GridCommandResult =
  | { kind: 'value'; value: string }
  | { kind: 'unrecognized' }

/**
 * Resolves the cell commands that become a value without opening another UI.
 * Commands that need a picker or a create flow stay unrecognized here so their
 * caller can leave the edit open instead of silently storing command text.
 */
export function parseGridCommand(
  input: string,
  attribute: CommandAttribute,
  referenceDate = new Date(),
): GridCommandResult {
  const trimmed = input.trim()
  if (!trimmed.startsWith('@')) return { kind: 'unrecognized' }

  const [command, ...rest] = trimmed.slice(1).split(/\s+/)
  const argument = rest.join(' ').trim()

  if (command.toLowerCase() === 'date' && attribute.type === 'date' && argument) {
    const parsed = parseDate(argument, referenceDate, { forwardDate: true })
    if (!parsed) return { kind: 'unrecognized' }
    return { kind: 'value', value: toCalendarDate(parsed) }
  }

  if (command.toLowerCase() === 'status' && (attribute.type === 'status' || attribute.type === 'select')) {
    const option = attribute.options?.find(
      (candidate) =>
        candidate.value.localeCompare(argument, undefined, { sensitivity: 'accent' }) === 0 ||
        candidate.label.localeCompare(argument, undefined, { sensitivity: 'accent' }) === 0,
    )
    return option ? { kind: 'value', value: option.value } : { kind: 'unrecognized' }
  }

  return { kind: 'unrecognized' }
}

function toCalendarDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
