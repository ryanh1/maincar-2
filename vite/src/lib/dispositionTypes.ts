export type DispositionCategory = 'connected' | 'not_connected'
export type DispositionColor = `option-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`

export interface Disposition {
  id: string
  value: string
  label: string
  color: DispositionColor
  icon: string | null
  category: DispositionCategory
  isStandard: boolean
  sortOrder: number
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export interface DispositionsResponse { dispositions: Disposition[] }
export interface DispositionResponse { disposition: Disposition }

export interface CreateDispositionInput {
  value: string
  label: string
  color: DispositionColor
  icon?: string | null
  category: DispositionCategory
  sortOrder?: number
}

export type UpdateDispositionInput = Partial<Omit<CreateDispositionInput, 'value'>> & { isArchived?: boolean }
