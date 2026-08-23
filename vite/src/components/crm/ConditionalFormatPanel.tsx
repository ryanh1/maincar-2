import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useColorRuleMutations, useGetColorRules, type ColorRule, type ColorRulePredicate, type ColorRulePredicateOp, type ColorRuleTarget } from '@/hooks/colorRules'
import { PAINT_TOKENS } from '@/lib/paintTokens'
import type { AttributeDef } from '@/lib/crmTypes'
import type { GridMenuAnchor } from './gridFilterMenu'

const PREDICATE_OP_LABELS: Record<ColorRulePredicateOp, string> = {
  before_today: 'is before today',
  is_today: 'is today',
  after_today: 'is after today',
  eq: 'is',
  gt: 'is greater than',
  lt: 'is less than',
}

const TARGET_LABELS: Record<ColorRuleTarget, string> = {
  background: 'Background',
  text: 'Text',
  dot: 'Dot',
}

function predicateOps(attribute: AttributeDef | undefined): ColorRulePredicateOp[] {
  if (attribute && (attribute.type === 'date' || attribute.type === 'timestamp')) {
    return ['before_today', 'is_today', 'after_today', 'eq', 'gt', 'lt']
  }
  return ['eq', 'gt', 'lt']
}

function describePredicate(predicate: ColorRulePredicate): string {
  const label = PREDICATE_OP_LABELS[predicate.op]
  if (predicate.op === 'eq' || predicate.op === 'gt' || predicate.op === 'lt') {
    return `${label} ${predicate.value ?? ''}`
  }
  return label
}

interface ConditionalFormatPanelProps {
  anchor: GridMenuAnchor
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  viewId: string
  attributes: AttributeDef[]
  colors: Record<string, string>
  initialAttributeId?: string | null
}

/**
 * The conditional-formatting panel (SPEC-CHUNK-2 J2.5 §C / journey 4b.4). Lists
 * a view's ordered rules, lets a rep add/edit/toggle/delete/reorder them, and
 * restores the seeded due-date temperature set. The grid owns persistence via
 * the color-rules hooks; this only renders and reports intent.
 */
export function ConditionalFormatPanel({ anchor, open, onOpenChange, orgId, viewId, attributes, colors, initialAttributeId }: ConditionalFormatPanelProps) {
  const rulesQuery = useGetColorRules(orgId, viewId)
  const mutations = useColorRuleMutations()
  const rules = rulesQuery.data?.colorRules ?? []

  const [adding, setAdding] = useState(false)
  const [attributeId, setAttributeId] = useState(initialAttributeId ?? '')
  const [op, setOp] = useState<ColorRulePredicateOp>('eq')
  const [value, setValue] = useState('')
  const [target, setTarget] = useState<ColorRuleTarget>('background')
  const [color, setColor] = useState<string>(PAINT_TOKENS[0])

  const attribute = attributes.find((entry) => entry.id === attributeId)
  const needsValue = op === 'eq' || op === 'gt' || op === 'lt'

  function resetForm() {
    setAdding(false)
    setAttributeId(initialAttributeId ?? '')
    setOp('eq')
    setValue('')
    setTarget('background')
    setColor(PAINT_TOKENS[0])
  }

  function addRule() {
    if (!attributeId || (needsValue && value === '')) return
    const predicate: ColorRulePredicate = needsValue ? { op, value } : { op }
    void mutations.create.mutateAsync({
      orgId,
      viewId,
      attribute: attributeId,
      predicate,
      target,
      scope: 'cell',
      color,
      sortOrder: rules.length,
      enabled: true,
    }).then(resetForm).catch(() => {})
  }

  function move(rule: ColorRule, direction: -1 | 1) {
    const index = rules.findIndex((entry) => entry.id === rule.id)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= rules.length) return
    const next = [...rules]
    const [moved] = next.splice(index, 1)
    next.splice(targetIndex, 0, moved)
    void mutations.reorder.mutateAsync({ orgId, viewId, ruleIds: next.map((entry) => entry.id) }).catch(() => {})
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <span aria-hidden="true" style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }} />
      </PopoverAnchor>
      <PopoverContent align="start" side="bottom" className="w-80 p-3" onOpenAutoFocus={(event) => event.preventDefault()}>
        <PopoverHeader>
          <PopoverTitle>Conditional formatting</PopoverTitle>
        </PopoverHeader>

        <div className="mt-3 flex flex-col gap-2">
          {rules.length === 0 && !adding && (
            <p className="text-xs text-text-muted">No rules yet. Add one to colour cells by a condition.</p>
          )}

          {rules.map((rule, index) => {
            const ruleAttribute = attributes.find((entry) => entry.id === rule.attribute)
            return (
              <div key={rule.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                <span className="size-4 shrink-0 rounded-sm border border-border" style={{ backgroundColor: colors[rule.color] ?? rule.color }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{ruleAttribute?.name ?? rule.attribute}</p>
                  <p className="truncate text-xs text-text-muted">
                    {describePredicate(rule.predicate)} · {TARGET_LABELS[rule.target]}
                  </p>
                </div>
                <Switch
                  aria-label={`Enable rule for ${ruleAttribute?.name ?? rule.attribute}`}
                  checked={rule.enabled}
                  onCheckedChange={(enabled) => void mutations.update.mutateAsync({ orgId, viewId, ruleId: rule.id, enabled }).catch(() => {})}
                />
                <div className="flex flex-col">
                  <button type="button" aria-label="Move rule up" disabled={index === 0} className="text-text-muted disabled:opacity-30" onClick={() => move(rule, -1)}>
                    <ArrowUp className="size-3" />
                  </button>
                  <button type="button" aria-label="Move rule down" disabled={index === rules.length - 1} className="text-text-muted disabled:opacity-30" onClick={() => move(rule, 1)}>
                    <ArrowDown className="size-3" />
                  </button>
                </div>
                <button type="button" aria-label="Delete rule" className="text-text-muted hover:text-destructive" onClick={() => void mutations.remove.mutateAsync({ orgId, viewId, ruleId: rule.id }).catch(() => {})}>
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })}

          {adding ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-2">
              <Select value={attributeId} onValueChange={setAttributeId}>
                <SelectTrigger className="h-8 w-full"><SelectValue placeholder="Field" /></SelectTrigger>
                <SelectContent>
                  {attributes.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <Select value={op} onValueChange={(next) => setOp(next as ColorRulePredicateOp)}>
                  <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {predicateOps(attribute).map((entry) => (
                      <SelectItem key={entry} value={entry}>{PREDICATE_OP_LABELS[entry]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsValue && (
                  <Input aria-label="Rule value" className="h-8 w-24" value={value} onChange={(event) => setValue(event.target.value)} />
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select value={target} onValueChange={(next) => setTarget(next as ColorRuleTarget)}>
                  <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TARGET_LABELS) as ColorRuleTarget[]).map((entry) => (
                      <SelectItem key={entry} value={entry}>{TARGET_LABELS[entry]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-1">
                  {PAINT_TOKENS.map((token) => (
                    <button
                      key={token}
                      type="button"
                      aria-label={`Colour ${token}`}
                      aria-pressed={color === token}
                      className="size-5 rounded-sm border border-border"
                      style={{ backgroundColor: colors[token] ?? token, outline: color === token ? '2px solid var(--primary)' : undefined }}
                      onClick={() => setColor(token)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={resetForm}>Cancel</Button>
                <Button size="sm" disabled={!attributeId || (needsValue && value === '')} onClick={addRule}>Add rule</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" className="justify-start" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add rule
            </Button>
          )}

          <Button size="sm" variant="ghost" className="justify-start text-text-muted" onClick={() => void mutations.restoreDefaults.mutateAsync({ orgId, viewId }).catch(() => {})}>
            <RotateCcw className="size-4" /> Reset to defaults
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
