// Unit tests for the Email string unions and the row → API mappers (MAI-137 T9).
//
// These prove the two promises the mappers make, which are the two that matter
// for §5.12:
//   - a participant's RAW address is returned whether or not it is linked to a
//     Person, so an email full of strangers still renders;
//   - orgId never leaves the server, and neither does an attachment's storage key.
import { describe, expect, it } from 'vitest'

import {
  EMAIL_DIRECTIONS,
  EMAIL_IMPORTANCES,
  EMAIL_PARTICIPANT_ROLES,
  EMAIL_PROVIDERS,
  isEmailDirection,
  isEmailImportance,
  isEmailParticipantRole,
  isEmailProvider,
  mapAttachmentToApi,
  mapEmailToDetailApi,
  mapEmailToListApi,
  mapParticipantToApi,
} from '../emailActivity.js'
import type { Email, EmailAttachment, EmailParticipant } from '../../generated/prisma/client.js'

const NOW = new Date('2026-08-21T12:00:00.000Z')
const SENT = new Date('2026-08-20T09:30:00.000Z')

function emailRow(overrides: Partial<Email> = {}): Email {
  return {
    id: 'em-1',
    orgId: 'org-a',
    companyId: null,
    dealId: null,
    manualAttach: false,
    mailAccountId: 'mba-1',
    direction: 'outbound',
    subject: 'Following up',
    bodyHtml: '<p>Hi</p>',
    bodyText: 'Hi',
    snippet: 'Hi',
    internetMessageId: '<abc@mail.example.com>',
    conversationId: 'thread-1',
    inReplyTo: null,
    references: [],
    importance: 'normal',
    isRead: false,
    isDraft: false,
    hasAttachments: false,
    provider: 'gmail',
    providerMessageId: 'gmail-1',
    providerThreadId: 'gthread-1',
    folderOrLabels: ['SENT'],
    webLink: 'https://mail.google.com/x',
    syncCursor: 'history-99',
    sentAt: SENT,
    receivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function participantRow(overrides: Partial<EmailParticipant> = {}): EmailParticipant {
  return {
    id: 'ep-1',
    orgId: 'org-a',
    emailId: 'em-1',
    role: 'to',
    name: 'Stranger Danger',
    address: 'stranger@elsewhere.test',
    personId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function attachmentRow(overrides: Partial<EmailAttachment> = {}): EmailAttachment {
  return {
    id: 'ea-1',
    orgId: 'org-a',
    emailId: 'em-1',
    filename: 'proposal.pdf',
    contentType: 'application/pdf',
    sizeBytes: 4096,
    isInline: false,
    contentId: null,
    storageUrl: null,
    providerAttachmentId: 'att-1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('email string unions', () => {
  it('lists the values the schema comments document', () => {
    expect([...EMAIL_DIRECTIONS]).toEqual(['outbound', 'inbound'])
    expect([...EMAIL_IMPORTANCES]).toEqual(['low', 'normal', 'high'])
    expect([...EMAIL_PARTICIPANT_ROLES]).toEqual(['from', 'sender', 'to', 'cc', 'bcc', 'reply_to'])
    expect([...EMAIL_PROVIDERS]).toEqual(['gmail', 'm365', 'imap'])
  })

  it('keeps `from` and `sender` as separate roles', () => {
    // RFC5322: a delegate can SEND mail written by someone else. Collapsing the
    // two roles would lose the fact that an assistant sent it.
    expect(isEmailParticipantRole('from')).toBe(true)
    expect(isEmailParticipantRole('sender')).toBe(true)
  })

  it('narrows a known value and refuses an unknown one', () => {
    expect(isEmailDirection('inbound')).toBe(true)
    expect(isEmailDirection('sideways')).toBe(false)
    expect(isEmailImportance('high')).toBe(true)
    expect(isEmailImportance('urgent')).toBe(false)
    expect(isEmailParticipantRole('bcc')).toBe(true)
    expect(isEmailParticipantRole('BCC')).toBe(false)
    expect(isEmailProvider('m365')).toBe(true)
    expect(isEmailProvider('exchange')).toBe(false)
    expect(isEmailDirection(null)).toBe(false)
    expect(isEmailProvider(7)).toBe(false)
  })
})

describe('mapParticipantToApi', () => {
  it('returns the RAW address for a participant with no Person (§5.12)', () => {
    const mapped = mapParticipantToApi(participantRow())
    expect(mapped).toEqual({
      id: 'ep-1',
      role: 'to',
      name: 'Stranger Danger',
      address: 'stranger@elsewhere.test',
      personId: null,
    })
  })

  it('still returns the raw address once the participant IS linked to a Person', () => {
    // The link is added TO the row; it does not replace what the message said.
    const mapped = mapParticipantToApi(participantRow({ personId: 'per-1' }))
    expect(mapped.personId).toBe('per-1')
    expect(mapped.address).toBe('stranger@elsewhere.test')
  })

  it('never leaks orgId or emailId', () => {
    expect(Object.keys(mapParticipantToApi(participantRow())).sort()).toEqual([
      'address',
      'id',
      'name',
      'personId',
      'role',
    ])
  })
})

describe('mapAttachmentToApi', () => {
  it('reports isStored false and hides the storage key while the download is pending', () => {
    const mapped = mapAttachmentToApi(attachmentRow())
    expect(mapped.isStored).toBe(false)
    expect(mapped).not.toHaveProperty('storageUrl')
  })

  it('reports isStored true once our copy exists, still without the key', () => {
    const mapped = mapAttachmentToApi(attachmentRow({ storageUrl: 'bucket/org-a/em-1/ea-1.pdf' }))
    expect(mapped.isStored).toBe(true)
    expect(JSON.stringify(mapped)).not.toContain('bucket/')
  })
})

describe('mapEmailToListApi', () => {
  it('carries the inbox-row fields and no message body', () => {
    const mapped = mapEmailToListApi(emailRow())
    expect(mapped.subject).toBe('Following up')
    expect(mapped.snippet).toBe('Hi')
    expect(mapped.sentAt).toBe('2026-08-20T09:30:00.000Z')
    expect(mapped.receivedAt).toBeNull()
    expect(mapped).not.toHaveProperty('bodyHtml')
    expect(mapped).not.toHaveProperty('bodyText')
    expect(mapped).not.toHaveProperty('orgId')
  })

  it('includes participants only when they were loaded', () => {
    expect(mapEmailToListApi(emailRow())).not.toHaveProperty('participants')
    const withParticipants = mapEmailToListApi(
      Object.assign(emailRow(), { participants: [participantRow()] }),
    )
    expect(withParticipants.participants).toHaveLength(1)
    expect(withParticipants.participants?.[0].address).toBe('stranger@elsewhere.test')
  })
})

describe('mapEmailToDetailApi', () => {
  const detail = mapEmailToDetailApi(
    Object.assign(emailRow(), {
      participants: [
        participantRow({ id: 'ep-from', role: 'from', address: 'rep@ourco.test' }),
        participantRow(),
      ],
      attachments: [attachmentRow()],
    }),
  )

  it('carries the bodies, the threading headers, participants, and attachments', () => {
    expect(detail.bodyHtml).toBe('<p>Hi</p>')
    expect(detail.internetMessageId).toBe('<abc@mail.example.com>')
    expect(detail.conversationId).toBe('thread-1')
    expect(detail.participants.map((p) => p.role)).toEqual(['from', 'to'])
    expect(detail.attachments[0].filename).toBe('proposal.pdf')
  })

  it('never returns orgId or the sync bookkeeping a client cannot act on', () => {
    expect(detail).not.toHaveProperty('orgId')
    expect(detail).not.toHaveProperty('syncCursor')
    expect(detail).not.toHaveProperty('providerMessageId')
    expect(detail).not.toHaveProperty('providerThreadId')
  })

  it('returns the mailbox as an id only — never an address, token, or scope', () => {
    // Mail credentials and mailbox identity belong to OAuthConnection/MailAccount.
    // An Email points at a mailbox and stops there.
    expect(detail.mailAccountId).toBe('mba-1')
    const serialized = JSON.stringify(detail)
    expect(serialized).not.toContain('refreshToken')
    expect(serialized).not.toContain('accessToken')
    expect(serialized).not.toContain('scopes')
  })
})
