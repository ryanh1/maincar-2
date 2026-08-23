import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarClock, CheckCircle2, Circle, GripVertical, ListChecks } from 'lucide-react'
import { toast } from 'sonner'

import { PageHeader } from '@/components/PageHeader'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useGetTasks, useUpdateTask } from '@/hooks/tasks'
import { formatDateTime, zonedDateTimeParts, zonedDateTimeToIso } from '@/lib/datetime'
import type { Task } from '@/lib/taskTypes'
import { useAuth } from '@/providers/useAuth'
import { groupTasks, type TaskGroupBy } from './taskGrouping'

export type { Task } from '@/lib/taskTypes'

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

type TaskRowProps = {
  task: Task
  timeZone: string | null | undefined
  orgId: string | null
  selected: boolean
  onSelect: (taskId: string) => void
  onComplete: (taskId: string) => void
  onReschedule: (taskId: string) => void
  dragHandle?: ReactNode
  nodeRef?: (node: HTMLLIElement | null) => void
  style?: CSSProperties
}

function TaskRow({ task, timeZone, orgId, selected, onSelect, onComplete, onReschedule, dragHandle, nodeRef, style }: TaskRowProps) {
  return (
    <li ref={nodeRef} style={style} className={`flex min-h-10 items-center gap-3 border-b border-border px-3 py-1 last:border-b-0 ${selected ? 'bg-surface-2' : 'bg-bg'}`}>
      {dragHandle}
      <Checkbox
        checked={task.isDone}
        aria-label={`Complete ${task.title}`}
        onFocus={() => onSelect(task.id)}
        onCheckedChange={(isDone) => {
          onSelect(task.id)
          if (isDone === true && orgId) onComplete(task.id)
        }}
      />
      <button type="button" aria-label={`Select task ${task.title}`} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" onClick={() => onSelect(task.id)}>
        {task.commitment === 'hard' ? <CheckCircle2 size={16} aria-label="Appointment" className="shrink-0 text-primary" /> : <Circle size={16} aria-label="Reminder" className="shrink-0 text-text-muted" />}
        <span className="truncate">{task.title}</span>
      </button>
      <span className="hidden text-xs text-text-muted md:inline">{task.commitment === 'hard' ? 'Appointment' : 'Reminder'}</span>
      <span className="text-xs text-text-muted">{task.dueAt ? formatDateTime(task.dueAt, timeZone) : 'No due date'}</span>
      <Button type="button" variant="ghost" size="sm" onClick={() => onReschedule(task.id)}>Reschedule</Button>
    </li>
  )
}

function SortableTaskRow(props: Omit<TaskRowProps, 'dragHandle' | 'nodeRef' | 'style'>) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: props.task.id })
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition }
  return (
    <TaskRow
      {...props}
      nodeRef={setNodeRef}
      style={style}
      dragHandle={(
        <IconButton tooltip={`Reorder ${props.task.title}`} type="button" variant="ghost" size="icon-sm" {...attributes} {...listeners}>
          <GripVertical size={16} aria-hidden />
        </IconButton>
      )}
    />
  )
}

/** The first-class Tasks list, initially grouped as the My Tasks saved view. */
export function Tasks() {
  const { org, user } = useAuth()
  const orgId = org?.id ?? null
  const timeZone = user?.timeZone
  const tasksQuery = useGetTasks(orgId, { isDone: false })
  const updateTask = useUpdateTask()
  const [groupBy, setGroupBy] = useState<TaskGroupBy>('due')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [rescheduleTaskId, setRescheduleTaskId] = useState<string | null>(null)
  const [showCustomDate, setShowCustomDate] = useState(false)
  const [customDate, setCustomDate] = useState<Date | undefined>()
  const [manualOrder, setManualOrder] = useState<string[]>([])
  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data])
  const rescheduleTask = tasks.find((task) => task.id === rescheduleTaskId) ?? null
  const orderedTasks = useMemo(() => {
    if (groupBy !== 'none') return tasks
    const order = new Map(manualOrder.map((id, index) => [id, index]))
    return [...tasks].sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER))
  }, [groupBy, manualOrder, tasks])
  const groups = useMemo(() => groupTasks(orderedTasks, groupBy, timeZone), [groupBy, orderedTasks, timeZone])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function updateSelected(update: Parameters<typeof updateTask.mutateAsync>[0]['update']) {
    if (!orgId || !selectedTaskId) return
    void updateTask.mutateAsync({ orgId, taskId: selectedTaskId, update }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not update the task. Try again.')
    })
  }

  function openReschedule(taskId: string) {
    setRescheduleTaskId(taskId)
    setShowCustomDate(false)
    setCustomDate(undefined)
  }

  function rescheduleByDays(days: number) {
    if (!orgId || !rescheduleTask) return
    const nextDue = new Date(rescheduleTask.dueAt ?? new Date())
    nextDue.setDate(nextDue.getDate() + days)
    void updateTask.mutateAsync({ orgId, taskId: rescheduleTask.id, update: { dueAt: nextDue.toISOString() } }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not reschedule the task. Try again.')
    })
    setRescheduleTaskId(null)
  }

  function saveCustomDate() {
    if (!orgId || !rescheduleTask || !customDate) return
    const time = zonedDateTimeParts(rescheduleTask.dueAt ?? new Date().toISOString(), timeZone).time
    const dueAt = zonedDateTimeToIso(customDate, time, timeZone)
    if (!dueAt) return
    void updateTask.mutateAsync({ orgId, taskId: rescheduleTask.id, update: { dueAt } }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Could not reschedule the task. Try again.')
    })
    setRescheduleTaskId(null)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target) || !selectedTaskId) return
      if (event.key === '✓') {
        event.preventDefault()
        updateSelected({ isDone: true })
      } else if (event.key === '1') {
        event.preventDefault()
        updateSelected({ priority: 'low' })
      } else if (event.key === '2') {
        event.preventDefault()
        updateSelected({ priority: 'med' })
      } else if (event.key === '3') {
        event.preventDefault()
        updateSelected({ priority: 'high' })
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        openReschedule(selectedTaskId)
      } else if (event.key.toLowerCase() === 'x') {
        event.preventDefault()
        updateSelected({ remindAt: null })
      } else if (event.key === '@') {
        event.preventDefault()
        openReschedule(selectedTaskId)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={ListChecks}
        title="Tasks"
        count={tasksQuery.data?.total}
        action={(
          <Select value={groupBy} onValueChange={(value) => setGroupBy(value as TaskGroupBy)}>
            <SelectTrigger aria-label="Group tasks" size="sm" className="bg-bg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="due">Group by due date</SelectItem>
              <SelectItem value="priority">Group by priority</SelectItem>
              <SelectItem value="type">Group by type</SelectItem>
              <SelectItem value="linked">Group by linked object</SelectItem>
              <SelectItem value="none">Ungrouped</SelectItem>
            </SelectContent>
          </Select>
        )}
      />

      <div className="min-h-0 flex-1 overflow-y-auto pt-4">
        {tasksQuery.isPending && <p className="text-sm text-text-muted">Loading tasks…</p>}
        {tasksQuery.isError && (
          <div className="flex items-center gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-danger">Could not load tasks.</p>
            <button type="button" className="text-sm font-medium text-primary" onClick={() => void tasksQuery.refetch()}>Try again</button>
          </div>
        )}
        {!tasksQuery.isPending && !tasksQuery.isError && tasks.length === 0 && (
          <div className="flex h-full items-center justify-center"><p className="text-sm text-text-muted">Create a task to keep follow-ups visible.</p></div>
        )}
        {!tasksQuery.isPending && !tasksQuery.isError && groups.map((group) => (
          <section key={group.label} className="mb-6" aria-labelledby={`task-group-${group.label}`}>
            <h2 id={`task-group-${group.label}`} className="mb-2 text-sm font-semibold text-text">{group.label}</h2>
            {group.tasks.length > 0 && (
              groupBy === 'none' ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={({ active, over }) => {
                    if (!over || active.id === over.id) return
                    const visibleIds = group.tasks.map((task) => task.id)
                    const from = visibleIds.indexOf(String(active.id))
                    const to = visibleIds.indexOf(String(over.id))
                    if (from >= 0 && to >= 0) setManualOrder(arrayMove(visibleIds, from, to))
                  }}
                >
                  <SortableContext items={group.tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                    <ul className="overflow-hidden rounded-md border border-border" aria-label="Manual task order">
                      {group.tasks.map((task) => <SortableTaskRow key={task.id} task={task} timeZone={timeZone} orgId={orgId} selected={selectedTaskId === task.id} onSelect={setSelectedTaskId} onComplete={(taskId) => { if (orgId) void updateTask.mutateAsync({ orgId, taskId, update: { isDone: true } }) }} onReschedule={openReschedule} />)}
                    </ul>
                  </SortableContext>
                </DndContext>
              ) : (
                <ul className="overflow-hidden rounded-md border border-border" aria-label={`${group.label} tasks`}>
                  {group.tasks.map((task) => <TaskRow key={task.id} task={task} timeZone={timeZone} orgId={orgId} selected={selectedTaskId === task.id} onSelect={setSelectedTaskId} onComplete={(taskId) => { if (orgId) void updateTask.mutateAsync({ orgId, taskId, update: { isDone: true } }) }} onReschedule={openReschedule} />)}
                </ul>
              )
            )}
          </section>
        ))}
      </div>
      <p className="border-t border-border pt-3 text-xs text-text-muted"><CalendarClock size={14} aria-hidden className="mr-1 inline" /> Select a task, then press ✓ to complete, r to reschedule, x to dismiss its reminder, 1–3 to set priority, or @ to set its due date.</p>
      <Dialog open={rescheduleTask !== null} onOpenChange={(open) => { if (!open) setRescheduleTaskId(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule task</DialogTitle>
            <DialogDescription>Choose the task’s new due date.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => rescheduleByDays(1)}>Tomorrow</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => rescheduleByDays(7)}>Next week</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setShowCustomDate(true)}>Custom</Button>
          </div>
          {showCustomDate && (
            <div className="flex flex-col gap-3">
              <DatePicker value={customDate} onChange={setCustomDate} ariaLabel="Custom due date" />
              <Button type="button" size="sm" disabled={!customDate} onClick={saveCustomDate}>Set custom date</Button>
            </div>
          )}
          <DialogFooter><Button type="button" variant="secondary" size="sm" onClick={() => setRescheduleTaskId(null)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
