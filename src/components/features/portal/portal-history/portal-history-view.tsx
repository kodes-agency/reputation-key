// The History tab, fully controlled: the ledger beside the Versions rail, the
// inline confirmation under a publish line, and the version dialog. It holds no
// state and reads nothing, so a story can drive every state of it; the tab that
// reads and writes is `portal-history-tab.tsx`.

import type { ReactNode } from 'react'
import type {
  PortalVersionDetail,
  PortalVersions,
} from '#/contexts/portal/application/public-api'
import { RegionError } from '#/components/ui/region-error'
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
  /** `retry` is reading; the failure stays, its button busy. */
  retrying?: boolean
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
  /** `onRetry` is reading; the history failure stays, its button busy. */
  entriesRetrying?: boolean
  onShowEarlier: (firstVersion: number) => void
  /** The first version that "Show" revealed, whose line takes focus. */
  revealedVersion: number | null
  /** The version just made live again, for focus; announced in `announcement`. */
  restoredVersion: number | null
  /** Said politely to a screen reader once, e.g. that a version is live again. */
  announcement: string | null
  versions: PortalVersions | null
  versionsFailed: boolean
  onRetryVersions: () => void
  /** `onRetryVersions` is reading; the versions failure stays, its button busy. */
  versionsRetrying?: boolean
  pendingChangeCount: number
  canMakeLive: boolean
  note?: ReactNode
  selection: HistorySelection | null
  detail: HistoryDetailState
  /** The selected version's page as guests see it, for the dialog; it reads for itself. */
  versionPreview?: ReactNode
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
        // The checking line is announced as it appears; a failure is its own
        // alert, and a live region around it would read it out twice.
        aria-live={detail.status === 'error' ? undefined : 'polite'}
      >
        {detail.status === 'error' ? (
          <RegionError
            size="compact"
            message="What would change couldn’t be checked."
            onRetry={detail.retry}
            retrying={detail.retrying === true}
            onCancel={close}
          />
        ) : (
          <p className="text-muted-foreground">Checking what would change…</p>
        )}
      </div>
    )
  }

  const dialogOpen = selection !== null && selection.host === 'dialog'
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <p role="status" aria-live="polite" className="sr-only">
        {props.announcement}
      </p>
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
        revealedVersion={props.revealedVersion}
        restoredVersion={props.restoredVersion}
        hasMore={props.hasMore}
        loadingMore={props.loadingMore}
        onLoadMore={props.onLoadMore}
        onRetry={props.onRetry}
        retrying={props.entriesRetrying}
        note={props.note}
      />
      <PortalVersionsRail
        versions={props.versions}
        failed={props.versionsFailed}
        onRetry={props.onRetryVersions}
        retrying={props.versionsRetrying}
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
          preview={props.versionPreview}
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
          retrying={detail.retrying}
          onClose={close}
        />
      ) : null}
    </div>
  )
}
