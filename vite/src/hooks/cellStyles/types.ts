export type CellStyle = {
  id: string
  viewId: string
  recordId: string
  fieldId: string
  backgroundToken: string | null
  textToken: string | null
  createdAt: string
  updatedAt: string
}

export type CellStylesResponse = { cellStyles: CellStyle[] }
export type CellStyleResponse = { cellStyle: CellStyle | null }
