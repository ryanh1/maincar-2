/** API shapes returned by server/src/routes/tasks.ts. */
export type Task = {
  id: string
  title: string
  type: 'call' | 'email' | 'todo'
  priority: 'low' | 'med' | 'high'
  commitment: 'hard' | 'soft'
  assigneeUserId: string | null
  dueAt: string | null
  remindAt: string | null
  eventId: string | null
  origin: 'manual' | 'calendar'
  isDone: boolean
  doneAt: string | null
  createdAt: string
  updatedAt: string
  links?: Array<{ object: string; id: string }>
}

export type GetTasksParams = {
  isDone?: boolean
}

export type GetTasksResponse = {
  tasks: Task[]
  total: number
  page: number
  limit: number
}

export type UpdateTaskInput = Partial<Pick<Task, 'title' | 'type' | 'priority' | 'commitment' | 'assigneeUserId' | 'dueAt' | 'remindAt' | 'eventId' | 'isDone'>>

export type UpdateTaskResponse = { task: Task }
