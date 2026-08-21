export interface CrmObject {
  id: string
  slug: string
  name: string
  namePlural: string
  isHidden: boolean
  isArchived: boolean
}

export interface CrmList {
  id: string
  name: string
  objectSlug: string
  isArchived: boolean
}

export interface GetCrmObjectsResponse {
  objects: CrmObject[]
}

export interface GetCrmListsResponse {
  lists: CrmList[]
  total: number
  page: number
  limit: number
}
