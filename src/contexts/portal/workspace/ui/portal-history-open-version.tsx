// The version dialog of the History tab: a version opened from "View" or from a
// tile of the Versions rail. It reads the version itself, draws the version's
// page beside what it lists, and turns into the confirmation when the choice to
// make it live again has started.

import { listedTileCount } from './portal-version-page-note'
import { usePortalHistory, type HistorySelection } from './portal-history-context'
import { PortalHistoryRestore } from './portal-history-restore'
import { PortalVersionDialog } from './portal-version-dialog'
import { PortalVersionPreview } from './portal-version-preview'
import { useVersionDetail } from './use-portal-history-reads'

function OpenVersion({ selection }: Readonly<{ selection: HistorySelection }>) {
  const { portalId, reads, now, timeZone, canMakeLive, submitting, select } =
    usePortalHistory()
  const { version, mode } = selection
  const detail = useVersionDetail(version)
  return (
    <PortalVersionDialog
      version={version}
      detail={detail.detail}
      status={detail.status}
      now={now}
      timeZone={timeZone}
      canMakeLive={canMakeLive}
      preview={
        reads.getVersionPreview ? (
          <PortalVersionPreview
            // Another version is another page: its language and state start over.
            key={version}
            portalId={portalId}
            version={version}
            getVersionPreview={reads.getVersionPreview}
            listedTileCount={listedTileCount(detail.detail)}
          />
        ) : null
      }
      confirmation={
        mode === 'restore' ? (
          <PortalHistoryRestore host="dialog" version={version} detail={detail} />
        ) : null
      }
      submitting={submitting}
      onMakeLive={() => select({ version, mode: 'restore', host: 'dialog' })}
      onRetry={detail.retry}
      retrying={detail.retrying}
      onClose={() => select(null)}
    />
  )
}

export function PortalHistoryOpenVersion() {
  const { selection } = usePortalHistory()
  return selection !== null && selection.host === 'dialog' ? (
    <OpenVersion selection={selection} />
  ) : null
}
