type SavedViewAudience = {
  ownerUserId: string
  isShared: boolean
}

// Routes verify active organization membership before consulting this policy.
// Keep every SavedView audience decision here so roles can refine shared-view
// access without changing route URLs or components.
export function canViewSavedView(view: SavedViewAudience, userId: string): boolean {
  return view.ownerUserId === userId || view.isShared
}

export function canEditSavedView(view: SavedViewAudience, userId: string): boolean {
  return canViewSavedView(view, userId)
}

export function canShareSavedView(view: SavedViewAudience, userId: string): boolean {
  return canEditSavedView(view, userId)
}
