// The choice to make a version live again: the confirmation under a publish
// line or in the version dialog. It says "Checking what would change…" until
// the version and the draft's changes are read, and offers the same Try again
// if either cannot be.

import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { RegionError } from '#/components/ui/region-error'
import { countPendingChanges } from './portal-detail-rules'
import { usePortalHistory } from './portal-history-context'
import {
  useHistoryPublication,
  useVersionDetail,
  type HistoryDetailState,
} from './use-portal-history-reads'
import { PortalRestoreConfirmation } from './portal-restore-confirmation'

type Props = Readonly<{
  host: 'row' | 'dialog'
  version: number
  detail: HistoryDetailState
}>

export function PortalHistoryRestore({ host, version, detail }: Props) {
  const { timeZone, now, submitting, restoreError, select, confirmRestore } =
    usePortalHistory()
  const publication = useHistoryPublication()
  const close = () => select(null)

  // The draft's changes are part of what is shown, so they are awaited too.
  const state: HistoryDetailState =
    detail.status !== 'ready' || publication.data !== undefined
      ? detail
      : {
          status: hasFailed(publication) ? 'error' : 'loading',
          detail: null,
          retry: () => void publication.refetch(),
          retrying: isRetrying(publication),
        }

  if (state.status === 'ready' && state.detail !== null && publication.data) {
    if (!state.detail.restorable) {
      return (
        <p className="text-sm text-muted-foreground">
          This earlier page design is view-only.
        </p>
      )
    }
    return (
      <PortalRestoreConfirmation
        detail={state.detail}
        draftChangeCount={countPendingChanges(publication.data)}
        timeZone={timeZone}
        now={now}
        submitting={submitting}
        error={restoreError}
        onCancel={close}
        onConfirm={() => void confirmRestore(version)}
        focusOnOpen={host === 'row'}
      />
    )
  }
  return (
    <div
      id={`restore-v${version}`}
      className="my-1 rounded-lg border bg-card p-4 text-sm"
      // The checking line is announced as it appears; a failure is its own
      // alert, and a live region around it would read it out twice.
      aria-live={state.status === 'error' ? undefined : 'polite'}
    >
      {state.status === 'error' ? (
        <RegionError
          size="compact"
          message="What would change couldn’t be checked."
          onRetry={state.retry}
          retrying={state.retrying}
          onCancel={close}
        />
      ) : (
        <p className="text-muted-foreground">Checking what would change…</p>
      )}
    </div>
  )
}

/** The confirmation under a publish line, which reads its own version. */
export function PortalHistoryRowRestore({ version }: Readonly<{ version: number }>) {
  const detail = useVersionDetail(version)
  return <PortalHistoryRestore host="row" version={version} detail={detail} />
}
