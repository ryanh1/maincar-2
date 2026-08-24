import prisma from '../../db.js'
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import type { LinkTarget } from '../../crm/taskNote.js'

type Db = Pick<PrismaClient, '$transaction'>

export interface CalendarEventMetadataPatch {
  orgId: string
  userId: string
  eventId: string
  meetingLink?: string | null
  timeZone?: string | null
  links?: LinkTarget[]
}

/** Keep Maincar-only event metadata on the same tenant-scoped projection row and RecordLink seam. */
export function saveCalendarEventMetadata(input: CalendarEventMetadataPatch, db: Db = prisma) {
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const data = {
      ...(input.meetingLink !== undefined ? { meetingLinkOverride: input.meetingLink } : {}),
      ...(input.timeZone !== undefined ? { timeZoneOverride: input.timeZone } : {}),
    }
    if (Object.keys(data).length > 0) {
      const changed = await tx.calendarEvent.updateMany({
        where: { id: input.eventId, orgId: input.orgId, userId: input.userId },
        data,
      })
      if (changed.count !== 1) throw new Error('Calendar event metadata target was not found.')
    }

    if (input.links === undefined) return
    await tx.recordLink.deleteMany({ where: { orgId: input.orgId, calendarEventId: input.eventId } })
    if (input.links.length === 0) return
    await tx.recordLink.createMany({
      data: input.links.map((link) => ({
        orgId: input.orgId,
        fromObject: 'calendar-event',
        fromId: input.eventId,
        attribute: null,
        toObject: link.object,
        toId: link.id,
        calendarEventId: input.eventId,
      })),
    })
  })
}
