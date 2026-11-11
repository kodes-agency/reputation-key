// The History tab's section: it reads the publication history (for the count of
// changes the draft holds), says so itself while that loads or if it cannot be
// read, and then draws the tab, which owns the ledger and versions reads.

import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { PortalPublicationHistory } from '#/contexts/portal/application/portal-management-contracts'
import { countPendingChanges } from './portal-detail-rules'
import type { PortalDetailPortal } from './portal-detail-types'
import {
  PortalHistoryTab,
  type MakeVersionLiveAction,
  type PortalHistoryReads,
} from './portal-history-tab'
import { PortalReadState, type SectionRead } from './portal-read-state'

type Props = Readonly<{
  portal: PortalDetailPortal
  /** The property's IANA zone, whose days "yesterday" means. */
  timeZone: string
  history: SectionRead<PortalPublicationHistory>
  /** The tab's ledger, version and preview reads. */
  reads: PortalHistoryReads
  /** "Make live again": the live activation moves to another version. */
  makeLive: MakeVersionLiveAction
}>

export function PortalHistorySection({
  portal,
  timeZone,
  history,
  reads,
  makeLive,
}: Props) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  if (!history.data)
    return <PortalReadState queries={[history]} label="publication history" />
  return (
    <PortalHistoryTab
      portalId={portal.id}
      portalName={portal.name}
      timeZone={timeZone}
      pendingChangeCount={countPendingChanges(history.data)}
      mayMakeLive={can('portal.update') && has('portal.write')}
      pageIsLive={portal.publicationState === 'published'}
      reads={reads}
      makeLive={makeLive}
    />
  )
}
