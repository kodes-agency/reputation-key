// The History tab: the ledger beside the Versions rail, the inline confirmation
// under a publish line, and the version dialog. It holds no state and reads
// nothing itself; each part reads what it shows from `PortalHistoryProvider`,
// which `portal-history-tab.tsx` mounts over the reads and the write.

import { usePortalHistory } from './portal-history-context'
import { PortalHistoryLedger } from './portal-history-ledger'
import { PortalHistoryOpenVersion } from './portal-history-open-version'
import { PortalVersionsRail } from './portal-versions-rail'

export function PortalHistoryView() {
  const { restoredVersion } = usePortalHistory()
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <p role="status" aria-live="polite" className="sr-only">
        {restoredVersion === null ? null : `Version ${restoredVersion} is live again.`}
      </p>
      <PortalHistoryLedger />
      <PortalVersionsRail />
      <PortalHistoryOpenVersion />
    </div>
  )
}
