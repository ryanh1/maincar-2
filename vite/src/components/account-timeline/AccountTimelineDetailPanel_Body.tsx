import type { AccountTimelineDetail } from '@/lib/accountTimelineTypes'
import { AccountTimelineDetailPanel_Call } from './AccountTimelineDetailPanel_Call'
import { AccountTimelineDetailPanel_Email } from './AccountTimelineDetailPanel_Email'
import { AccountTimelineDetailPanel_Meeting } from './AccountTimelineDetailPanel_Meeting'
import { AccountTimelineDetailPanel_Sms } from './AccountTimelineDetailPanel_Sms'
import { AccountTimelineDetailPanel_Change, AccountTimelineDetailPanel_Note, AccountTimelineDetailPanel_Task } from './AccountTimelineDetailPanel_Work'

export function AccountTimelineDetailPanel_Body({ detail, orgId, timeZone }: { detail: AccountTimelineDetail; orgId?: string | null; timeZone?: string | null }) {
  switch (detail.type) {
    case 'call':
      return <AccountTimelineDetailPanel_Call detail={detail} orgId={orgId} />
    case 'email':
      return <AccountTimelineDetailPanel_Email detail={detail} timeZone={timeZone} />
    case 'sms':
      return <AccountTimelineDetailPanel_Sms detail={detail} timeZone={timeZone} />
    case 'meeting':
      return <AccountTimelineDetailPanel_Meeting detail={detail} timeZone={timeZone} />
    case 'note':
      return <AccountTimelineDetailPanel_Note detail={detail} orgId={orgId} timeZone={timeZone} />
    case 'task':
      return <AccountTimelineDetailPanel_Task detail={detail} orgId={orgId} timeZone={timeZone} />
    case 'stage_change':
      return <AccountTimelineDetailPanel_Change detail={detail} timeZone={timeZone} />
    default:
      return <p className="text-sm text-text-muted">This event has no additional detail to show.</p>
  }
}
