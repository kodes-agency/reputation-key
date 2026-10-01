// The History tab, fully controlled: the ledger beside the Versions rail, the
// inline confirmation under a publish line, and the version dialog. It holds no
// state and reads nothing, so a story can drive every state of it; the tab that
// reads and writes is `portal-history-tab.tsx`.

import type { ReactNode } from 'react'
import type {
  PortalVersionDetail,
  PortalVersions,
} from '#/contexts/portal/application/public-api'
import { Button } from '#/components/ui/button'
import { PortalHistoryLedger } from './portal-history-ledger'
import type { HistoryFilterKey, HistoryRow } from './portal-history-rows'
import { PortalRestoreConfirmation } from './portal-restore-confirmation'
import { PortalVersionDialog } from './portal-version-dialog'
import { PortalVersionsRail } from './portal-versions-rail'

/** What is open: a version seen in a dialog, or the choice to make it live again, on its line or in a dialog. */
export type HistorySelection = Readonly<{
  version: number
  mode: 'view' | 'restore'
  host: 'row' | 'dialog'
}>

export type HistoryDetailState = Readonly<{
  status: 'loading' | 'error' | 'ready'
  detail: PortalVersionDetail | null
  retry: () => void
}>

type Props = Readonly<{
  portalName: string
  now: Date
  timeZone: string
  filter: HistoryFilterKey
  onFilterChange: (filter: HistoryFilterKey) => void
  rows: readonly HistoryRow[]
  entriesState: 'loading' | 'error' | 'ready'
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onRetry: () => void
  onShowEarlier: () => void
  versions: PortalVersions | null
  versionsFailed: boolean
  pendingChangeCount: number
  canMakeLive: boolean
  note?: ReactNode
  selection: HistorySelection | null
  detail: HistoryDetailState
  submitting: boolean
  restoreError: string | null
  onSelect: (selection: HistorySelection | null) => void
  onConfirmRestore: (version: number) => void
}>

export function PortalHistoryView(props: Props) {
  const { selection, detail, now, timeZone } = props
  const close = () => props.onSelect(null)

  const confirmation = (host: 'row' | 'dialog', version: number): ReactNode => {
    if (detail.status === 'ready' && detail.detail !== null) {
      return (
        <PortalRestoreConfirmation
          detail={detail.detail}
          draftChangeCount={props.pendingChangeCount}
          timeZone={timeZone}
          now={now}
          submitting={props.submitting}
          error={props.restoreError}
          onCancel={close}
          onConfirm={() => props.onConfirmRestore(version)}
          focusOnOpen={host === 'row'}
        />
      )
    }
    return (
      <div
        id={`restore-v${version}`}
        className="my-1 rounded-lg border bg-card p-4 text-sm"
        aria-live="polite"
      >
        {detail.status === 'error' ? (
          <p role="alert" className="text-destructive">
            Could not check what would change.{' '}
            <Button type="button" variant="link" size="xs" onClick={detail.retry}>
              Try again
            </Button>{' '}
            <Button type="button" variant="link" size="xs" onClick={close}>
              Cancel
            </Button>
          </p>
        ) : (
          <p className="text-muted-foreground">Checking what would change…</p>
        )}
      </div>
    )
  }

  const dialogOpen = selection !== null && selection.host === 'dialog'
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <PortalHistoryLedger
        rows={props.rows}
        state={props.entriesState}
        filter={props.filter}
        onFilterChange={props.onFilterChange}
        portalName={props.portalName}
        now={now}
        timeZone={timeZone}
        canMakeLive={props.canMakeLive}
        restoreVersion={
          selection !== null && selection.mode === 'restore' && selection.host === 'row'
            ? selection.version
            : null
        }
        renderRestore={(version) => confirmation('row', version)}
        onView={(version) => props.onSelect({ version, mode: 'view', host: 'dialog' })}
        onAskRestore={(version) =>
          props.onSelect({ version, mode: 'restore', host: 'row' })
        }
        onShowEarlier={props.onShowEarlier}
        hasMore={props.hasMore}
        loadingMore={props.loadingMore}
        onLoadMore={props.onLoadMore}
        onRetry={props.onRetry}
        note={props.note}
      />
      <PortalVersionsRail
        versions={props.versions}
        failed={props.versionsFailed}
        pendingChangeCount={props.pendingChangeCount}
        now={now}
        timeZone={timeZone}
        activeVersion={selection?.version ?? null}
        onSelect={(version) => props.onSelect({ version, mode: 'view', host: 'dialog' })}
      />
      {dialogOpen ? (
        <PortalVersionDialog
          version={selection.version}
          detail={detail.detail}
          status={detail.status}
          now={now}
          timeZone={timeZone}
          canMakeLive={props.canMakeLive}
          confirmation={
            selection.mode === 'restore'
              ? confirmation('dialog', selection.version)
              : null
          }
          onMakeLive={() =>
            props.onSelect({
              version: selection.version,
              mode: 'restore',
              host: 'dialog',
            })
          }
          onRetry={detail.retry}
          onClose={close}
        />
      ) : null}
    </div>
  )
}
