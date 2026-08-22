// Settings → Email templates.
//
// What these protect:
//   - the list is what the server sent, with an author, never a raw user id
//   - a null author reads as a fact about the template, not an error or a blank
//   - the empty state invites the writing rather than explaining emptiness
//   - create sends no templateId, edit sends one — one hook, two shapes
//   - the form seeds the SHARED RichTextEditor and saves what the rep typed
//   - delete happens only after the confirm, and the confirm names the effect
//   - loading and error both have honest states
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'

/**
 * The form renders the REAL `RichTextEditor` — the whole point of the issue is
 * that templates and the composer share one editor, and a stub that echoes what
 * it is handed would prove nothing about that. ProseMirror measures the document
 * through `Range.getClientRects`, which jsdom does not implement. Same stubs, for
 * the same reason, as `ComposerCard.test.tsx`; local rather than in
 * `src/test/setup.ts`, because a global stub is a global lie about jsdom.
 */
beforeAll(() => {
  if (typeof Range !== 'undefined') {
    Range.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  }
  if (typeof Element !== 'undefined' && !Element.prototype.getClientRects) {
    Element.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  }
})

const {
  useAuthMock,
  useGetEmailTemplatesMock,
  useSaveEmailTemplateMock,
  useDeleteEmailTemplateMock,
  useGetMembersMock,
  saveMutateMock,
  deleteMutateMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useGetEmailTemplatesMock: vi.fn(),
  useSaveEmailTemplateMock: vi.fn(),
  useDeleteEmailTemplateMock: vi.fn(),
  useGetMembersMock: vi.fn(),
  saveMutateMock: vi.fn(),
  deleteMutateMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/hooks/email', () => ({
  useGetEmailTemplates: useGetEmailTemplatesMock,
  useSaveEmailTemplate: useSaveEmailTemplateMock,
  useDeleteEmailTemplate: useDeleteEmailTemplateMock,
}))
vi.mock('@/hooks/orgs', () => ({
  useGetMembers: useGetMembersMock,
  memberDisplayName: (member: { firstName: string | null; lastName: string | null; email: string }) =>
    [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
}))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: toastSuccessMock } }))

import { Settings_EmailTemplatesTab } from '@/pages/Settings_EmailTemplatesTab'

/**
 * Write into the body the way `ComposerCard.test.tsx` does, and for the same
 * reason: ProseMirror owns its DOM, so there is no `value` to set — it watches
 * for mutations and reads the document back out of them. Mutating the editable
 * element and firing `input` is exactly the sequence a keystroke produces.
 * `userEvent.click` cannot be used to place the caret either, because
 * ProseMirror maps a mousedown through `document.elementFromPoint`, which jsdom
 * does not implement.
 */
async function typeBody(html: string) {
  const body = screen.getByRole('textbox', { name: 'Body' })
  body.innerHTML = html
  fireEvent.input(body)
  // ProseMirror reports the mutation upward a tick later.
  await act(async () => {})
}

const ORG = { id: 'org-a', name: 'Acme' }
const VIEWER = { id: 'user-a' }

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'Discovery follow-up',
    subject: 'Great speaking with you',
    bodyHtml: '<p>Thanks for your time.</p>',
    visibility: 'ORGANIZATION',
    createdById: 'user-a',
    fieldsJson: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  }
}

function templatesResponse(overrides: Record<string, unknown> = {}) {
  return {
    templates: [
      template(),
      template({ id: 'tpl-2', name: 'Pricing recap', subject: '', createdById: 'user-b' }),
      // The author has left. `createdById` is nullable and a null is NOT an error.
      template({
        id: 'tpl-3',
        name: 'Voicemail follow-up',
        subject: 'Sorry I missed you',
        createdById: null,
      }),
    ],
    total: 3,
    page: 1,
    limit: 25,
    ...overrides,
  }
}

function listState(overrides: Record<string, unknown> = {}) {
  return {
    data: templatesResponse(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  }
}

function membersState(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      members: [
        { userId: 'user-a', email: 'al@acme.com', firstName: 'Al', lastName: 'Pha' },
        { userId: 'user-b', email: 'bee@acme.com', firstName: 'Bee', lastName: 'Ta' },
      ],
    },
    isPending: false,
    isError: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ org: ORG, user: VIEWER, isAdmin: false })
  useGetEmailTemplatesMock.mockReturnValue(listState())
  useGetMembersMock.mockReturnValue(membersState())
  useSaveEmailTemplateMock.mockReturnValue({ mutate: saveMutateMock, isPending: false })
  useDeleteEmailTemplateMock.mockReturnValue({ mutate: deleteMutateMock, isPending: false })
})

describe('the templates list', () => {
  it('asks the server for the private template page by default and restores table state from the URL', () => {
    renderWithProviders(<Settings_EmailTemplatesTab />, {
      initialEntries: ['/settings?tab=email-templates&scope=all&q=follow&sort=subject&dir=desc&page=2'],
    })

    expect(useGetEmailTemplatesMock).toHaveBeenCalledWith('org-a', {
      scope: 'all',
      page: 2,
      limit: 25,
      sort: 'subject',
      dir: 'desc',
      q: 'follow',
    })
    expect(screen.getByLabelText('Search templates')).toHaveValue('follow')
    expect(screen.getByRole('combobox', { name: 'Template visibility' })).toHaveTextContent(
      'Private and organization templates',
    )
  })

  it('keeps sort, search, scope, and page in the server request', async () => {
    useGetEmailTemplatesMock.mockReturnValue(
      listState({ data: templatesResponse({ total: 51, limit: 25 }) }),
    )
    const user = userEvent.setup()

    renderWithProviders(<Settings_EmailTemplatesTab />)

    expect(useGetEmailTemplatesMock).toHaveBeenLastCalledWith('org-a', {
      scope: 'private',
      page: 1,
      limit: 25,
      sort: 'name',
      dir: 'asc',
      q: undefined,
    })

    await user.click(screen.getByRole('button', { name: 'Sort by Subject' }))
    await waitFor(() =>
      expect(useGetEmailTemplatesMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ sort: 'subject', dir: 'asc', page: 1 }),
      ),
    )

    await user.type(screen.getByLabelText('Search templates'), 'pricing')
    await waitFor(() =>
      expect(useGetEmailTemplatesMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ q: 'pricing', page: 1 }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() =>
      expect(useGetEmailTemplatesMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ q: undefined, page: 1 }),
      ),
    )

    await user.click(screen.getByRole('combobox', { name: 'Template visibility' }))
    await user.click(await screen.findByRole('option', { name: 'Private and organization templates' }))
    await waitFor(() =>
      expect(useGetEmailTemplatesMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ scope: 'all', page: 1 }),
      ),
    )

    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(useGetEmailTemplatesMock).toHaveBeenLastCalledWith(
        'org-a',
        expect.objectContaining({ scope: 'all', page: 2 }),
      ),
    )
  })

  it('lists the org templates in the order the server sent, with a subject', () => {
    renderWithProviders(<Settings_EmailTemplatesTab />)

    const names = screen.getAllByRole('cell').map((cell) => cell.textContent)
    expect(names).toContain('Discovery follow-up')
    expect(names).toContain('Pricing recap')
    expect(screen.getByText('Great speaking with you')).toBeInTheDocument()
    // A template saved without a subject says so rather than showing a gap.
    expect(screen.getByText('No subject')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' }).closest('tr')).toHaveClass('bg-surface')
  })

  it('names the author, and never shows a raw user id', () => {
    renderWithProviders(<Settings_EmailTemplatesTab />)

    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Bee Ta')).toBeInTheDocument()
    // A null author is the rep having left, which is a fact, not a blank cell.
    expect(screen.getByText('Former member')).toBeInTheDocument()
    expect(screen.queryByText('user-b')).not.toBeInTheDocument()
  })

  it('shows a loading state while the list is pending', () => {
    useGetEmailTemplatesMock.mockReturnValue(listState({ data: undefined, isPending: true }))

    renderWithProviders(<Settings_EmailTemplatesTab />)

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText('Discovery follow-up')).not.toBeInTheDocument()
  })

  it('offers a retry when the list fails', async () => {
    const refetch = vi.fn()
    useGetEmailTemplatesMock.mockReturnValue(
      listState({ data: undefined, isPending: false, isError: true, refetch }),
    )
    const user = userEvent.setup()

    renderWithProviders(<Settings_EmailTemplatesTab />)
    expect(screen.getByText('Could not load your templates.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('the empty state', () => {
  it('invites the writing and opens the form', async () => {
    useGetEmailTemplatesMock.mockReturnValue(listState({ data: { templates: [], total: 0 } }))
    const user = userEvent.setup()

    renderWithProviders(<Settings_EmailTemplatesTab />)
    expect(screen.getByText('Write a template you can reuse.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New template' }))

    expect(screen.getByRole('heading', { name: 'New template' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveValue('')
  })
})

describe('writing a template', () => {
  it('keeps a new template private until the creator explicitly shares it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'New template' }))
    const sharing = screen.getByRole('checkbox', { name: 'Share with organization' })
    expect(sharing).not.toBeChecked()

    await user.type(screen.getByLabelText(/^Name/), 'Cold outreach')
    await user.click(screen.getByRole('button', { name: 'Save template' }))

    await waitFor(() => expect(saveMutateMock).toHaveBeenCalled())
    expect(saveMutateMock.mock.calls[0][0]).toMatchObject({
      orgId: 'org-a',
      name: 'Cold outreach',
      visibility: 'PRIVATE',
    })
  })

  it('shares a new template only when the creator turns sharing on', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'New template' }))
    await user.type(screen.getByLabelText(/^Name/), 'Cold outreach')
    await user.click(screen.getByRole('checkbox', { name: 'Share with organization' }))
    await user.click(screen.getByRole('button', { name: 'Save template' }))

    await waitFor(() => expect(saveMutateMock).toHaveBeenCalled())
    expect(saveMutateMock.mock.calls[0][0]).toMatchObject({ visibility: 'ORGANIZATION' })
  })

  it('saves a new one with no templateId', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'New template' }))
    await user.type(screen.getByLabelText(/^Name/), 'Cold outreach')
    await user.type(screen.getByLabelText('Subject'), 'Quick question')
    await typeBody('<p>Hello there</p>')

    await user.click(screen.getByRole('button', { name: 'Save template' }))

    await waitFor(() => expect(saveMutateMock).toHaveBeenCalled())
    const [variables] = saveMutateMock.mock.calls[0]
    expect(variables).toMatchObject({
      orgId: 'org-a',
      name: 'Cold outreach',
      subject: 'Quick question',
    })
    expect(variables).not.toHaveProperty('templateId')
    expect(variables.bodyHtml).toContain('Hello there')
  })

  it('refuses a name of nothing but spaces and says what to do', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'New template' }))
    await user.type(screen.getByLabelText(/^Name/), '   ')
    await user.click(screen.getByRole('button', { name: 'Save template' }))

    expect(toastErrorMock).toHaveBeenCalledWith('Name the template to save it.')
    expect(saveMutateMock).not.toHaveBeenCalled()
  })

  it('keeps the form open and explains how to recover when saving fails', async () => {
    saveMutateMock.mockImplementation((_variables, options) => options.onError(new Error('offline')))
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'New template' }))
    await user.type(screen.getByLabelText(/^Name/), 'Cold outreach')
    await user.click(screen.getByRole('button', { name: 'Save template' }))

    expect(toastErrorMock).toHaveBeenCalledWith('Could not save the template. Try again.')
    expect(screen.getByRole('heading', { name: 'New template' })).toBeInTheDocument()
  })

  it('returns to the list on cancel without saving', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'New template' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Discovery follow-up')).toBeInTheDocument()
    expect(saveMutateMock).not.toHaveBeenCalled()
  })
})

describe('editing a template', () => {
  it('opens the form seeded with the stored template', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for Discovery follow-up' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    expect(screen.getByRole('heading', { name: 'Edit template' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Name/)).toHaveValue('Discovery follow-up')
    expect(screen.getByLabelText('Subject')).toHaveValue('Great speaking with you')
    // The shared editor opened on the stored body, not on an empty document.
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveTextContent(
      'Thanks for your time.',
    )
  })

  it('saves the edit with the templateId, so the hook sends a PATCH', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for Discovery follow-up' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    await user.clear(screen.getByLabelText(/^Name/))
    await user.type(screen.getByLabelText(/^Name/), 'Discovery recap')
    await user.click(screen.getByRole('button', { name: 'Save template' }))

    await waitFor(() => expect(saveMutateMock).toHaveBeenCalled())
    expect(saveMutateMock.mock.calls[0][0]).toMatchObject({
      orgId: 'org-a',
      templateId: 'tpl-1',
      name: 'Discovery recap',
    })
  })

  it('seeds sharing from the stored template and unshares through the same save', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for Discovery follow-up' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const sharing = screen.getByRole('checkbox', { name: 'Share with organization' })
    expect(sharing).toBeChecked()

    await user.click(sharing)
    await user.click(screen.getByRole('button', { name: 'Save template' }))

    await waitFor(() => expect(saveMutateMock).toHaveBeenCalled())
    expect(saveMutateMock.mock.calls[0][0]).toMatchObject({
      orgId: 'org-a',
      templateId: 'tpl-1',
      visibility: 'PRIVATE',
    })
  })
})

describe('template management', () => {
  it('hides management actions for an organization template the viewer did not create', () => {
    renderWithProviders(<Settings_EmailTemplatesTab />)

    expect(screen.queryByRole('button', { name: 'Show actions for Pricing recap' })).not.toBeInTheDocument()
    expect(screen.getByText('Organization templates can be managed by their creator or an admin.')).toBeInTheDocument()
  })

  it('lets an organization admin manage a teammate\'s shared template', () => {
    useAuthMock.mockReturnValue({ org: ORG, user: VIEWER, isAdmin: true })

    renderWithProviders(<Settings_EmailTemplatesTab />)

    expect(screen.getByRole('button', { name: 'Show actions for Pricing recap' })).toBeInTheDocument()
  })
})

describe('deleting a template', () => {
  it('names the effect and only deletes after the confirm', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for Discovery follow-up' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(await screen.findByText('Delete Discovery follow-up?')).toBeInTheDocument()
    expect(
      screen.getByText(/Emails already written from it stay as they are/),
    ).toBeInTheDocument()
    expect(deleteMutateMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteMutateMock).toHaveBeenCalledWith(
        { orgId: 'org-a', templateId: 'tpl-1' },
        expect.anything(),
      ),
    )
  })

  it('does not delete when the confirm is cancelled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Settings_EmailTemplatesTab />)

    await user.click(screen.getByRole('button', { name: 'Show actions for Discovery follow-up' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(deleteMutateMock).not.toHaveBeenCalled()
  })
})
