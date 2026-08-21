/** Adds or removes one value from a multi-select filter, preserving the rest. */
export function toggleArrayValue(current: readonly string[], value: string): string[] {
  return current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value]
}
