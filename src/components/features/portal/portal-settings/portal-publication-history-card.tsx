import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import type {
  PortalPublicationHistory,
  PortalPublicationHistoryItem,
} from '#/contexts/portal/application/public-api'
import { PortalSavedSettingsStatus } from './portal-saved-settings-status'

const timestampFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : timestampFormatter.format(date)
}

const activityTitle = (item: PortalPublicationHistoryItem): string =>
  item.kind === 'rollback'
    ? `Returned to version ${item.version}`
    : `Version ${item.version} published`

const closureLabel = (
  reason: PortalPublicationHistoryItem['deactivationReason'],
): string | null => {
  switch (reason) {
    case 'disabled':
      return 'Public page paused'
    case 'archived':
      return 'Portal archived'
    case 'replaced':
      return 'Followed by another publication'
    case null:
      return null
  }
}

function CurrentPublication({
  current,
}: Readonly<{ current: PortalPublicationHistoryItem | null }>) {
  if (!current) {
    return (
      <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
        No version is live right now.
      </p>
    )
  }
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Version {current.version} is live</p>
        <Badge variant="secondary">Current</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {current.kind === 'rollback' ? 'Returned to this version' : 'Published'} on{' '}
        <time dateTime={current.activatedAt}>{formatTimestamp(current.activatedAt)}</time>
        .
      </p>
    </div>
  )
}

function EarlierActivity({
  activations,
}: Readonly<{ activations: readonly PortalPublicationHistoryItem[] }>) {
  if (activations.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No earlier publication activity yet.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Earlier activity
      </h4>
      <ol className="divide-y rounded-md border px-3">
        {activations.map((item) => {
          const closure = closureLabel(item.deactivationReason)
          return (
            <li key={item.activationSequence} className="space-y-1 py-3">
              <p className="text-sm font-medium">{activityTitle(item)}</p>
              <p className="text-xs text-muted-foreground">
                <time dateTime={item.activatedAt}>
                  {formatTimestamp(item.activatedAt)}
                </time>
                {closure ? ` · ${closure}` : ''}
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function PortalPublicationHistoryCard({
  history,
  portalId,
  loadMoreAction,
}: Readonly<{
  history: PortalPublicationHistory
  portalId?: string
  loadMoreAction?: Action<
    { data: { portalId: string; cursor?: number; limit?: number } },
    PortalPublicationHistory
  >
}>) {
  const sourceKey = [
    history.current?.activationSequence ?? 'paused',
    history.priorActivations
      .map(({ activationSequence }) => activationSequence)
      .join(','),
    history.nextCursor ?? 'end',
    history.hasPendingChanges ? 'pending' : 'current',
  ].join(':')
  const [continuation, setContinuation] = useState<{
    sourceKey: string
    pages: PortalPublicationHistory[]
  }>({ sourceKey, pages: [] })
  const pages = continuation.sourceKey === sourceKey ? continuation.pages : []
  const earlier = [
    ...history.priorActivations,
    ...pages.flatMap((page) => page.priorActivations),
  ].filter(
    (item, index, all) =>
      all.findIndex(
        (candidate) => candidate.activationSequence === item.activationSequence,
      ) === index,
  )
  const nextCursor =
    pages.length > 0 ? pages[pages.length - 1]!.nextCursor : history.nextCursor

  const loadMore = async () => {
    if (!loadMoreAction || !portalId || nextCursor === null) return
    const page = await loadMoreAction({
      data: { portalId, cursor: nextCursor, limit: 20 },
    })
    setContinuation((current) => ({
      sourceKey,
      pages: current.sourceKey === sourceKey ? [...current.pages, page] : [page],
    }))
  }

  return (
    <section
      className="space-y-3 rounded-md border px-4 py-3"
      aria-labelledby="portal-publication-history-title"
    >
      <div className="space-y-1">
        <h3 id="portal-publication-history-title" className="text-sm font-medium">
          Publication history
        </h3>
        <PortalSavedSettingsStatus history={history} />
      </div>
      <CurrentPublication current={history.current} />
      <EarlierActivity activations={earlier} />
      {nextCursor !== null && loadMoreAction && portalId && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadMoreAction.isPending}
            onClick={() => void loadMore()}
          >
            {loadMoreAction.isPending ? 'Loading…' : 'Load earlier activity'}
          </Button>
          {loadMoreAction.error ? (
            <p role="alert" className="text-xs text-destructive">
              Earlier publication activity could not be loaded. Please try again.
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
