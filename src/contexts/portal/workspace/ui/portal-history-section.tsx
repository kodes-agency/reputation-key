// The History tab's section: it works out what the viewer may do with the Portal
// and draws the tab, whose ledger and Versions rail each read for themselves and
// say so while they load or if they cannot be read.

import { useCapabilities } from '#/shared/hooks/useCapabilities'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { MakeVersionLiveAction, PortalHistoryReads } from './portal-history-context'
import type { PortalDetailPortal } from './portal-detail-types'
import { PortalHistoryTab } from './portal-history-tab'

type Props = Readonly<{
  portal: PortalDetailPortal
  /** The property's IANA zone, whose days "yesterday" means. */
  timeZone: string
  /** The tab's ledger, version, publication history and preview reads. */
  reads: PortalHistoryReads
  /** "Make live again": the live activation moves to another version. */
  makeLive: MakeVersionLiveAction
}>

export function PortalHistorySection({ portal, timeZone, reads, makeLive }: Props) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  return (
    <PortalHistoryTab
      portalId={portal.id}
      portalName={portal.name}
      timeZone={timeZone}
      mayMakeLive={can('portal.update') && has('portal.write')}
      pageIsLive={portal.publicationState === 'published'}
      reads={reads}
      makeLive={makeLive}
    />
  )
}
