import type { ViewConfig } from '@/components/crm/viewConfig'

export type SavedView = {
  id: string
  objectId: string
  name: string
  layout: 'list' | 'grid' | 'kanban'
  config: ViewConfig
  ownerUserId: string
  isShared: boolean
  isDefault: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type SavedViewsResponse = { views: SavedView[] }
export type SavedViewResponse = { view: SavedView }
