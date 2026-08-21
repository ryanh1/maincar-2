/**
 * The ONE validator every custom-value write goes through (MAI-135 T7, spec §5.11,
 * §5.14; plan T7 risk "JSONB validation drift").
 *
 * A custom object's rows live in Record.valuesJson — a schemaless JSONB column the
 * database cannot type-check. So the app must, on every write, and it must do it in
 * exactly ONE place: this function. It reads the object's AttributeDef rows and
 * enforces four things the database will not:
 *
 *   1. TYPE       — a value matches its attribute's declared semantic type (§8).
 *   2. REQUIRED   — an isRequired attribute has a value after the write (§5.11).
 *   3. UNIQUE     — an isUnique attribute's value is not already used by another
 *                   record of the same object (checked via an injected callback so
 *                   this module stays free of a database dependency and is unit-
 *                   testable — the route wires in a real containment query).
 *   4. EMPTY      — a cleared value is stored ABSENT, never "" (§5.14). null, "",
 *                   whitespace, and [] all normalize to "key removed".
 *
 * It returns the NORMALIZED valuesJson to persist (for an update it is the merge of
 * the current row and the incoming changes, with cleared keys removed), or the first
 * validation error. Nothing writes valuesJson without going through here.
 */

// The slice of an AttributeDef this validator needs. A structural type, not the
// generated Prisma row, so the validator can be unit-tested with plain objects and
// never drags a database type into a pure function.
export interface ValidatorAttribute {
  slug: string
  name: string
  // A semantic type from spec §8. See TYPE_CHECKS below.
  type: string
  isRequired?: boolean
  isUnique?: boolean
  isMulti?: boolean
  isReadOnly?: boolean
  // Picklist options for select/multiselect/status: [{ value, ... }]. When present,
  // a value must be one of the non-archived option values.
  optionsJson?: unknown
}

export type RecordValues = Record<string, unknown>

// A duplicate checker: given an attribute and a candidate value, resolves true if
// ANOTHER record of the same object already holds that value. Injected by the route
// (a GIN containment query); omitted in a context with no persistence (then unique
// is not enforced, which is only ever the case in a pure unit of another check).
export type UniquenessChecker = (
  attr: ValidatorAttribute,
  value: unknown,
) => Promise<boolean>

export interface ValidateArgs {
  // The object's attributes that live in valuesJson. The caller passes the active
  // (non-archived, non-deleted) ones; list-scoped attributes are excluded upstream.
  attributes: ValidatorAttribute[]
  // The raw incoming values from the request body.
  input: RecordValues
  mode: 'create' | 'update'
  // The current persisted valuesJson, for an update — required-after-merge and the
  // "only the keys the caller sent change" rule both read it. Ignored on create.
  current?: RecordValues
  checkUnique?: UniquenessChecker
}

export type ValidateResult =
  | { ok: true; values: RecordValues }
  | { ok: false; error: string }

// --- Empty normalization (spec §5.14) ----------------------------------------
// A value is "empty" — and therefore stored ABSENT — when it is null/undefined, an
// empty or whitespace-only string, or an empty array. Everything else is a value.
// A trimmed string is returned so " x " never persists with its padding.
function normalizeScalar(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? undefined : trimmed
  }
  return value
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

// --- Per-type checks ----------------------------------------------------------
// Each returns an error string when the (already non-empty, non-array) scalar value
// is wrong for the type, or null when it is fine. Multiplicity (isMulti) is handled
// by the caller, which applies these to each element.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const URL_RE = /^https?:\/\/.+/i
// A registrable-domain shape: label(.label)+, no scheme/path. Loose on purpose.
const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function checkScalarType(attr: ValidatorAttribute, value: unknown): string | null {
  const label = attr.name
  switch (attr.type) {
    case 'text':
    case 'phone':
    case 'location':
    case 'person_name':
      return typeof value === 'string' ? null : `${label} must be text.`
    case 'url':
      if (typeof value !== 'string') return `${label} must be a URL.`
      return URL_RE.test(value) ? null : `${label} must be a URL starting with http(s)://.`
    case 'domain':
      if (typeof value !== 'string') return `${label} must be a domain.`
      return DOMAIN_RE.test(value) ? null : `${label} must be a bare domain like acme.com.`
    case 'email':
      if (typeof value !== 'string') return `${label} must be an email address.`
      return EMAIL_RE.test(value) ? null : `${label} must be a valid email address.`
    case 'record_reference':
    case 'user_reference':
      // A pointer is the target row's id — a non-empty string.
      return typeof value === 'string' ? null : `${label} must be a record id.`
    case 'number':
    case 'currency':
    case 'rating':
      return isFiniteNumber(value) ? null : `${label} must be a number.`
    case 'checkbox':
      return typeof value === 'boolean' ? null : `${label} must be true or false.`
    case 'date':
    case 'timestamp': {
      // Accept an ISO string or an epoch number; reject anything unparseable.
      if (typeof value !== 'string' && typeof value !== 'number') {
        return `${label} must be a date.`
      }
      const ms = typeof value === 'number' ? value : Date.parse(value)
      return Number.isNaN(ms) ? `${label} must be a valid date.` : null
    }
    case 'select':
    case 'status':
    case 'multiselect':
      // Must be a string; option-membership is checked separately (needs options).
      return typeof value === 'string' ? null : `${label} must be a text option value.`
    case 'ai':
      // AI output is opaque and app-written; accept any JSON scalar/string.
      return null
    default:
      return `${label} has an unknown type "${attr.type}".`
  }
}

// The allowed, non-archived option values for a select/status/multiselect, or null
// when the attribute carries no option list (e.g. deal.stageId, whose options ARE
// the pipeline stages, not a static list — then membership is not enforced here).
function allowedOptionValues(attr: ValidatorAttribute): Set<string> | null {
  if (!Array.isArray(attr.optionsJson) || attr.optionsJson.length === 0) return null
  const values = new Set<string>()
  for (const raw of attr.optionsJson as unknown[]) {
    if (raw && typeof raw === 'object') {
      const opt = raw as { value?: unknown; isArchived?: unknown }
      if (typeof opt.value === 'string' && opt.isArchived !== true) values.add(opt.value)
    }
  }
  return values
}

function checkOptionMembership(attr: ValidatorAttribute, value: string): string | null {
  const allowed = allowedOptionValues(attr)
  if (!allowed) return null // no static list to check against
  return allowed.has(value) ? null : `${value} is not an option for ${attr.name}.`
}

/**
 * Type-checks ONE value against ONE attribute, with no merge, no required check, and
 * no uniqueness check — the shape half of the validator on its own.
 *
 * Field history needs exactly this (spec §5.7): `oldJson`/`newJson` are schemaless,
 * so their shape is validated in app code against the attribute's declared type,
 * through the SAME checks a normal field write goes through. Returns an error string
 * or null. An empty value is always fine — a field can be cleared, and a first write
 * has no old value.
 */
export function checkValueShape(attr: ValidatorAttribute, value: unknown): string | null {
  if (isEmpty(value)) return null

  if (attr.isMulti) {
    if (!Array.isArray(value)) return `${attr.name} must be a list of values.`
    for (const element of value) {
      const norm = normalizeScalar(element)
      if (norm === undefined) continue
      const typeError = checkScalarType(attr, norm)
      if (typeError) return typeError
      if (typeof norm === 'string') {
        const optionError = checkOptionMembership(attr, norm)
        if (optionError) return optionError
      }
    }
    return null
  }

  if (Array.isArray(value)) return `${attr.name} does not take a list of values.`
  const norm = normalizeScalar(value)
  if (norm === undefined) return null
  const typeError = checkScalarType(attr, norm)
  if (typeError) return typeError
  if (typeof norm === 'string') return checkOptionMembership(attr, norm)
  return null
}

// --- The validator ------------------------------------------------------------

export async function validateRecordValues(args: ValidateArgs): Promise<ValidateResult> {
  const { attributes, input, mode, current = {}, checkUnique } = args

  const bySlug = new Map(attributes.map((a) => [a.slug, a]))

  // Start from the current row on update (so unspecified keys survive), or empty on
  // create. Only the keys the caller actually sent are then applied over the top.
  const values: RecordValues = mode === 'update' ? { ...current } : {}

  // --- Apply and type-check every key the caller sent -----------------------
  for (const [slug, rawValue] of Object.entries(input)) {
    const attr = bySlug.get(slug)
    if (!attr) {
      return { ok: false, error: `${slug} is not a field on this object.` }
    }
    if (attr.isReadOnly) {
      return { ok: false, error: `${attr.name} is read-only.` }
    }

    // Empty → absent: clearing a key removes it, never stores "" (§5.14).
    if (isEmpty(rawValue)) {
      delete values[slug]
      continue
    }

    if (attr.isMulti) {
      if (!Array.isArray(rawValue)) {
        return { ok: false, error: `${attr.name} must be a list of values.` }
      }
      const cleaned: unknown[] = []
      for (const element of rawValue) {
        const norm = normalizeScalar(element)
        if (norm === undefined) continue // drop empty elements
        const typeError = checkScalarType(attr, norm)
        if (typeError) return { ok: false, error: typeError }
        if (typeof norm === 'string') {
          const optionError = checkOptionMembership(attr, norm)
          if (optionError) return { ok: false, error: optionError }
        }
        cleaned.push(norm)
      }
      if (cleaned.length === 0) {
        delete values[slug]
      } else {
        values[slug] = cleaned
      }
      continue
    }

    // Single value.
    if (Array.isArray(rawValue)) {
      return { ok: false, error: `${attr.name} does not take a list of values.` }
    }
    const norm = normalizeScalar(rawValue)
    if (norm === undefined) {
      delete values[slug]
      continue
    }
    const typeError = checkScalarType(attr, norm)
    if (typeError) return { ok: false, error: typeError }
    if (typeof norm === 'string') {
      const optionError = checkOptionMembership(attr, norm)
      if (optionError) return { ok: false, error: optionError }
    }
    values[slug] = norm
  }

  // --- Required: every required attribute has a value after the write -------
  for (const attr of attributes) {
    if (attr.isRequired && isEmpty(values[attr.slug])) {
      return { ok: false, error: `${attr.name} is required.` }
    }
  }

  // --- Unique: no other record of this object holds the same value ----------
  if (checkUnique) {
    for (const attr of attributes) {
      if (!attr.isUnique) continue
      const value = values[attr.slug]
      if (isEmpty(value)) continue
      const duplicate = await checkUnique(attr, value)
      if (duplicate) {
        return { ok: false, error: `${attr.name} must be unique; that value is already used.` }
      }
    }
  }

  return { ok: true, values }
}
