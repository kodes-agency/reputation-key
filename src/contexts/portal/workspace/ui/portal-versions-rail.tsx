// The selectable version rows keep their multiline publication evidence.
// The Versions rail: the draft, then every published version newest first.
// Each version is one button that opens it for viewing. The draft is not a
// button: it is where the manager already is.

import { ShieldCheck } from 'lucide-react'
import type { PortalVersions } from '#/contexts/portal/application/portal-management-contracts'
import { PAGE_GUTTER_X } from '#/components/layout/page-shell'
import { RegionError } from '#/components/ui/region-error'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import { hasFailed, isRetrying } from '#/components/hooks/is-retrying'
import { countPendingChanges } from './portal-detail-rules'
import { usePortalHistory } from './portal-history-context'
import { formatHistoryTime } from './portal-history-time'
import { PhraseView } from './portal-phrase-view'
import { summarizeVersion } from './portal-version-summary'
import { useHistoryPublication, useHistoryVersions } from './use-portal-history-reads'

const changesLine = (count: number): string =>
  count === 0
    ? 'No changes waiting'
    : `${count} ${count === 1 ? 'change' : 'changes'} not live`

function DraftTile({
  versions,
  pendingChangeCount,
  now,
  timeZone,
}: Readonly<{
  versions: PortalVersions
  pendingChangeCount: number
  now: Date
  timeZone: string
}>) {
  const { draft } = versions
  const edited = draft.lastEdit
    ? formatHistoryTime(draft.lastEdit.at, now, timeZone)
    : null
  const by = draft.lastEdit?.actor
  return (
    <li className="rounded-md px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">Draft</span>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full border border-current"
          />
          {changesLine(pendingChangeCount)}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {draft.basedOnVersion === null
          ? 'Not published yet'
          : `Based on version ${draft.basedOnVersion}`}
      </p>
      {edited === null ? null : (
        <p className="text-xs text-muted-foreground">
          Edited{' '}
          <time
            dateTime={edited.dateTime}
            title={edited.title}
            className="whitespace-nowrap"
          >
            {edited.label}
          </time>
          {by ? ` by ${by.displayName ?? 'someone'}` : ''}
        </p>
      )}
    </li>
  )
}

function VersionTile({
  item,
  now,
  timeZone,
  active,
  onSelect,
}: Readonly<{
  item: PortalVersions['versions'][number]
  now: Date
  timeZone: string
  active: boolean
  onSelect: () => void
}>) {
  const { date } = formatHistoryTime(item.publishedAt, now, timeZone)
  const by = item.publishedBy?.displayName ?? null
  return (
    <li>
      <button
        data-slot="picker-tile"
        type="button"
        onClick={onSelect}
        aria-label={`Version ${item.version}${item.isLive ? ', live now' : ''}, published ${date}${by ? ` by ${by}` : ''}`}
        className={cn(
          'w-full rounded-md px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
          active && 'bg-muted',
        )}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Version {item.version}</span>
          {item.isLive ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              Live now
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {date}
          {by ? ` · ${by}` : ''}
        </span>
        <span className="block text-xs text-muted-foreground">
          <PhraseView phrase={summarizeVersion(item, { capitalised: true })} />
        </span>
      </button>
    </li>
  )
}

type ReadFailure = Readonly<{
  message: string
  retry: () => void
  retrying: boolean
}>

function VersionList({
  versions,
  pendingChangeCount,
  now,
  timeZone,
  activeVersion,
  onSelect,
  failure,
}: Readonly<{
  versions: PortalVersions | null
  pendingChangeCount: number
  now: Date
  timeZone: string
  activeVersion: number | null
  onSelect: (version: number) => void
  failure: ReadFailure | null
}>) {
  if (versions === null) {
    return failure ? (
      <div className="mt-4">
        <RegionError
          size="compact"
          message={failure.message}
          onRetry={failure.retry}
          retrying={failure.retrying}
        />
      </div>
    ) : (
      <div className="mt-4 space-y-3" aria-hidden="true">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }
  return (
    <ol aria-labelledby="portal-versions-title" className="mt-3 space-y-0.5">
      <DraftTile
        versions={versions}
        pendingChangeCount={pendingChangeCount}
        now={now}
        timeZone={timeZone}
      />
      {versions.versions.map((item) => (
        <VersionTile
          key={item.version}
          item={item}
          now={now}
          timeZone={timeZone}
          active={item.version === activeVersion}
          onSelect={() => onSelect(item.version)}
        />
      ))}
    </ol>
  )
}

export function PortalVersionsRail() {
  const { now, timeZone, selection, select } = usePortalHistory()
  const versionsRead = useHistoryVersions()
  const publication = useHistoryPublication()
  // The draft's tile needs both reads, so the rail waits for both.
  const versions =
    versionsRead.data !== undefined && publication.data !== undefined
      ? versionsRead.data
      : null
  const pendingChangeCount = publication.data ? countPendingChanges(publication.data) : 0
  const failedReads = [versionsRead, publication].filter(hasFailed)
  const failure: ReadFailure | null =
    failedReads.length === 0
      ? null
      : {
          message: hasFailed(versionsRead)
            ? 'Versions couldn’t be loaded.'
            : 'The publication history couldn’t be loaded.',
          retry: () => {
            void Promise.all(failedReads.map((read) => read.refetch()))
          },
          retrying: isRetrying(versionsRead, publication),
        }
  const activeVersion = selection?.version ?? null
  const onSelect = (version: number) => select({ version, mode: 'view', host: 'dialog' })
  const published = versions?.versions.length ?? 0
  const hasDraft = versions !== null && (pendingChangeCount > 0 || published === 0)
  return (
    <aside
      aria-labelledby="portal-versions-title"
      className={cn(
        PAGE_GUTTER_X,
        'border-t py-5 lg:w-[22rem] lg:shrink-0 lg:border-t-0 lg:border-l',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="portal-versions-title" className="text-base font-semibold">
          Versions
        </h2>
        {versions === null ? null : (
          <span className="text-xs text-muted-foreground">
            {published}
            {versions.truncated ? '+' : ''} published{hasDraft ? ' · 1 draft' : ''}
          </span>
        )}
      </div>
      <VersionList
        versions={versions}
        pendingChangeCount={pendingChangeCount}
        now={now}
        timeZone={timeZone}
        activeVersion={activeVersion}
        onSelect={onSelect}
        failure={failure}
      />
      {versions?.truncated ? (
        <p className="mt-2 px-3 text-xs text-muted-foreground">
          Older versions are kept but not listed here.
        </p>
      ) : null}
      <p className="mt-4 flex items-start gap-2 border-t px-3 pt-4 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Making an earlier version live again keeps its number and deletes nothing. Your
          draft stays as it is.
        </span>
      </p>
    </aside>
  )
}
