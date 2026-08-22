import type { ProvideEditorComponent } from '@glideapps/glide-data-grid'

import { FieldValueEditor } from './FieldValueEditor'
import type { FieldEditorCell } from './fieldEditorCell'

/** The Glide overlay editor delegates commits and cancellation to the shared field editor. */
export const FieldEditorCellEditor: ProvideEditorComponent<FieldEditorCell> = ({ value, onChange, onFinishedEditing }) => {
  function commit(nextValue: unknown) {
    const nextCell: FieldEditorCell = { ...value, data: { ...value.data, value: nextValue } }
    onChange(nextCell)
    onFinishedEditing(nextCell)
  }

  return (
    <FieldValueEditor
      orgId={value.data.orgId}
      attribute={value.data.attribute}
      value={value.data.value}
      timeZone={value.data.timeZone}
      onCommit={commit}
      onCancel={() => onFinishedEditing()}
    />
  )
}
