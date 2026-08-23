export type ColorRulePredicateOp = 'before_today' | 'is_today' | 'after_today' | 'eq' | 'gt' | 'lt'

export type ColorRulePredicate = {
  op: ColorRulePredicateOp
  value?: string | number | null
}

export type ColorRuleTarget = 'background' | 'text' | 'dot'
export type ColorRuleScope = 'cell' | 'subvalue'

export type ColorRule = {
  id: string
  viewId: string
  attribute: string
  predicate: ColorRulePredicate
  target: ColorRuleTarget
  scope: ColorRuleScope
  color: string
  sortOrder: number
  isDefault: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type ColorRulesResponse = { colorRules: ColorRule[] }
export type ColorRuleResponse = { colorRule: ColorRule }
