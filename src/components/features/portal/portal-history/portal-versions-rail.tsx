// The Versions rail: the draft, then every published version newest first.
// Each version is one button that opens it for viewing. The draft is not a
// button: it is where the manager already is.

import { ShieldCheck } from 'lucide-react'
import type { PortalVersions } from '#/contexts/portal/application/public-api'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import { formatHistoryTime } from './portal-history-time'
import { PhraseView } from './portal-phrase-view'
import { summarizeVersion } from './portal-version-summary'

type Props = Readonly<{
  /** Null while the read is loading or after it failed (see `failed`). */
  versions: PortalVersions | null
  failed: boolean
  /** How many changes the draft holds, from the same read the header's note uses. */
  pendingChangeCount: number
  now: Date
  timeZone: string
  /** The version open in a dialog or a confirmation, drawn as the chosen tile. */
  activeVersion: number | null
  onSelect: (version: number) => void
}>

const changesLine = (count: number): string =>
  count === 0
    ? 'No changes waiting'
    : `${count} ${count === 1 ? 'change' : 'changes'} not live`

function DraftTile({
  versions,
  pendingChangeCount,
  now,
  timeZone,
}: Pick<Props, 'pendingChangeCount' | 'now' | 'timeZone'> &
  Readonly<{ versions: PortalVersions }>) {
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
          <time dateTime={edited.dateTime} title={edited.title}>
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

export function PortalVersionsRail(props: Props) {
  const { versions, failed, now, timeZone, activeVersion, onSelect, pendingChangeCount } =
    props
  const published = versions?.versions.length ?? 0
  const hasDraft = versions !== null && (pendingChangeCount > 0 || published === 0)
  return (
    <aside
      aria-labelledby="portal-versions-title"
      className="border-t px-4 py-5 md:px-6 lg:w-[22rem] lg:shrink-0 lg:border-t-0 lg:border-l"
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
      {versions === null ? (
        failed ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            Versions could not be loaded.
          </p>
        ) : (
          <div className="mt-4 space-y-3" aria-hidden="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )
      ) : (
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
      )}
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
