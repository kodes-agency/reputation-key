// The History tab: the Portal's ledger, versions and what is open, and the write
// that makes a version live again. The ledger, the Versions rail and the version
// dialog each read their own data, so one that is slow or fails does not hold up
// the others (`use-portal-history-reads.ts`).

import {
  PortalHistoryProvider,
  type MakeVersionLiveAction,
  type PortalHistoryReads,
} from './portal-history-context'
import { PortalHistoryView } from './portal-history-view'

type Props = Readonly<{
  portalId: string
  portalName: string
  /** The property's IANA zone: its days are what "yesterday" means. */
  timeZone: string
  /** The viewer holds `portal.update` and `portal.write`. */
  mayMakeLive: boolean
  /** The page is on: only a live page has a version to switch. */
  pageIsLive: boolean
  reads: PortalHistoryReads
  makeLive: MakeVersionLiveAction
}>

export function PortalHistoryTab(props: Props) {
  return (
    <PortalHistoryProvider {...props}>
      <PortalHistoryView />
    </PortalHistoryProvider>
  )
}
