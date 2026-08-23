import type { DispositionColor } from './dispositionTypes'

export interface NextStepType {
  id: string
  value: string
  label: string
  color: DispositionColor
  icon: string | null
  isPinned: boolean
  pinOrder: number | null
  sortOrder: number
  isOverflow: boolean
  requiresDateTime: boolean
  createsTask: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export interface NextStepTypesResponse { types: NextStepType[] }
export interface NextStepTypeResponse { type: NextStepType }

export interface DispositionNextStepRule {
  dispositionId: string
  nextStepType: NextStepType
}

export interface DispositionNextStepRulesResponse { rules: DispositionNextStepRule[] }

export interface CreateNextStepTypeInput {
  value: string
  label: string
  color: DispositionColor
  icon?: string | null
  sortOrder?: number
  isOverflow?: boolean
  requiresDateTime?: boolean
  createsTask?: boolean
}

export type UpdateNextStepTypeInput = Partial<Omit<CreateNextStepTypeInput, 'value'>> & { isArchived?: boolean }

export interface UpdateNextStepBarInput { pinnedIds: string[] }
export interface SaveDispositionNextStepRuleInput { dispositionId: string; nextStepTypeId: string | null }
