import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import { Tasks, type Task } from './Tasks'
import { groupTasksByDueDate } from './taskGrouping'

const { useAuthMock, useGetTasksMock, useUpdateTaskMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetTasksMock: vi.fn(),
  useUpdateTaskMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/tasks', () => ({ useGetTasks: useGetTasksMock, useUpdateTask: useUpdateTaskMock }))

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Follow up',
  type: 'todo',
  priority: 'med',
  commitment: 'soft',
  assigneeUserId: 'user-1',
  dueAt: null,
  remindAt: null,
  eventId: null,
  origin: 'manual',
  isDone: false,
  doneAt: null,
  createdAt: '2026-08-23T12:00:00.000Z',
  updatedAt: '2026-08-23T12:00:00.000Z',
  ...overrides,
})

describe('groupTasksByDueDate', () => {
  it('puts open tasks into overdue, today, and upcoming groups in the viewing timezone', () => {
    const groups = groupTasksByDueDate([
      task({ id: 'overdue', dueAt: '2026-08-22T16:00:00.000Z' }),
      task({ id: 'today', dueAt: '2026-08-23T16:00:00.000Z' }),
      task({ id: 'upcoming', dueAt: '2026-08-24T16:00:00.000Z' }),
      task({ id: 'undated' }),
      task({ id: 'done', isDone: true, dueAt: '2026-08-22T16:00:00.000Z' }),
    ], new Date('2026-08-23T12:00:00.000Z'), 'America/New_York')

    expect(groups).toEqual([
      { label: 'Overdue', tasks: [expect.objectContaining({ id: 'overdue' })] },
      { label: 'Today', tasks: [expect.objectContaining({ id: 'today' })] },
      { label: 'Upcoming', tasks: [expect.objectContaining({ id: 'upcoming' }), expect.objectContaining({ id: 'undated' })] },
    ])
  })
})

describe('Tasks', () => {
  const mutateAsync = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthMock.mockReturnValue({
      org: { id: 'org-1', name: 'Acme' },
      user: { id: 'user-1', timeZone: 'America/New_York' },
    })
    useGetTasksMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: { tasks: [task({ dueAt: '2026-08-23T16:00:00.000Z' })], total: 1 },
      refetch: vi.fn(),
    })
    useUpdateTaskMock.mockReturnValue({ isPending: false, mutateAsync })
  })

  it('renders the grouped task list and completes its selected task with the keyboard', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Tasks />)

    await user.click(screen.getByRole('button', { name: 'Select task Follow up' }))
    await user.keyboard('✓')

    expect(screen.getByRole('heading', { name: /Tasks/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledWith({ orgId: 'org-1', taskId: 'task-1', update: { isDone: true } })
  })

  it('reschedules and dismisses a selected task without treating either as snooze', async () => {
    const user = userEvent.setup()
    useGetTasksMock.mockReturnValue({
      isPending: false,
      isError: false,
      data: { tasks: [task({ remindAt: '2026-08-23T15:00:00.000Z' })], total: 1 },
      refetch: vi.fn(),
    })
    renderWithProviders(<Tasks />)

    await user.click(screen.getByRole('button', { name: 'Select task Follow up' }))
    await user.keyboard('x')
    await user.keyboard('r')

    expect(mutateAsync).toHaveBeenCalledWith({ orgId: 'org-1', taskId: 'task-1', update: { remindAt: null } })
    expect(screen.getByRole('dialog', { name: 'Reschedule task' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.queryByText(/snooze/i)).not.toBeInTheDocument()
  })
})
