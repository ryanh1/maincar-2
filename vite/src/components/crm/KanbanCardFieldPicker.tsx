import { ChevronDown, Columns3Cog } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AttributeDef } from '@/lib/crmTypes'

import type { ViewConfig } from './viewConfig'

interface KanbanCardFieldPickerProps {
  attributes: AttributeDef[]
  config: ViewConfig
  onConfigChange: (update: (current: ViewConfig) => ViewConfig) => void
}

function defaultCardFieldIds(attributes: AttributeDef[], config: ViewConfig): string[] {
  const identityAttribute = attributes.find((attribute) => attribute.isIdentity)
  return attributes
    .filter((attribute) => attribute.id !== identityAttribute?.id && attribute.id !== config.groupBy[0]?.attributeId)
    .filter((attribute) => config.columns.find((column) => column.attributeId === attribute.id)?.visible !== false)
    .slice(0, 3)
    .map((attribute) => attribute.id)
}

/** Persists the fields shown below a Kanban card's identity field. */
export function KanbanCardFieldPicker({ attributes, config, onConfigChange }: KanbanCardFieldPickerProps) {
  const cardFieldIds = config.kanban?.cardAttributeIds ?? defaultCardFieldIds(attributes, config)

  function toggleCardField(attributeId: string, checked: boolean) {
    onConfigChange((current) => {
      if (!current.kanban) return current
      const selected = current.kanban.cardAttributeIds
      return { ...current, kanban: { ...current.kanban, cardAttributeIds: checked ? [...selected, attributeId] : selected.filter((id) => id !== attributeId) } }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm"><Columns3Cog size={16} />Card fields<ChevronDown size={16} /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Fields on cards</DropdownMenuLabel>
          {attributes.filter((attribute) => !attribute.isIdentity).map((attribute) => (
            <DropdownMenuCheckboxItem key={attribute.id} checked={cardFieldIds.includes(attribute.id)} onSelect={(event) => event.preventDefault()} onCheckedChange={(checked) => toggleCardField(attribute.id, checked)}>
              {attribute.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {cardFieldIds.length > 5 && <span className="text-xs text-text-muted">Cards get noisy with more than five fields.</span>}
    </>
  )
}
