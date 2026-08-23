import type { Task } from '@/lib/taskTypes'

export type TaskGroup = { label: string; tasks: Task[] }
export type TaskGroupBy = 'due' | 'priority' | 'type' | 'linked' | 'none'

function calendarDay(value: Date, timeZone: string | null | undefined): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Groups open work against the viewing rep's calendar day, never the server's. */
export function groupTasksByDueDate(tasks: Task[], now: Date, timeZone: string | null | undefined): TaskGroup[] {
  const today = calendarDay(now, timeZone)
  const groups: TaskGroup[] = [{ label: 'Overdue', tasks: [] }, { label: 'Today', tasks: [] }, { label: 'Upcoming', tasks: [] }]
  for (const task of tasks) {
    if (task.isDone) continue
    const dueDay = task.dueAt ? calendarDay(new Date(task.dueAt), timeZone) : null
    if (dueDay && dueDay < today) groups[0].tasks.push(task)
    else if (dueDay === today) groups[1].tasks.push(task)
    else groups[2].tasks.push(task)
  }
  return groups
}

export function groupTasks(tasks: Task[], groupBy: TaskGroupBy, timeZone: string | null | undefined): TaskGroup[] {
  if (groupBy === 'due') return groupTasksByDueDate(tasks, new Date(), timeZone)
  if (groupBy === 'none') return [{ label: 'Tasks', tasks: tasks.filter((task) => !task.isDone) }]
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    if (task.isDone) continue
    const label = groupBy === 'priority'
      ? ({ low: 'Low priority', med: 'Medium priority', high: 'High priority' } as const)[task.priority]
      : groupBy === 'type'
        ? ({ call: 'Calls', email: 'Emails', todo: 'To-dos' } as const)[task.type]
        : task.links?.[0]?.object ?? 'No linked object'
    groups.set(label, [...(groups.get(label) ?? []), task])
  }
  return [...groups].map(([label, groupedTasks]) => ({ label, tasks: groupedTasks }))
}
