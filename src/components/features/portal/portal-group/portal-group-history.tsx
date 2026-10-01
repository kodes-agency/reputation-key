// A group's history on its page (board 13): a short ledger on the same rail the
// inbox thread uses, newest first. Each line says what happened; a quiet second
// line says where a moved portal's earlier results stay.
import {
  Archive,
  CirclePlus,
  LogIn,
  LogOut,
  Pencil,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineIndicator,
  TimelineItem,
} from '#/components/ui/timeline'
import type { PortalGroupHistoryEntry } from '#/contexts/portal/application/public-api'
import {
  buildPortalGroupHistory,
  type HistoryFrame,
  type HistoryNames,
  type PortalGroupHistoryLine,
} from './portal-group-history-view'
import type { ReadState } from './portal-group-read-state'

type Props = Readonly<{
  state: ReadState<readonly PortalGroupHistoryEntry[]>
  names: HistoryNames
  frame: HistoryFrame
  onRetry: () => void
}>

const ICON: Readonly<Record<PortalGroupHistoryLine['kind'], typeof Pencil>> = {
  created: CirclePlus,
  renamed: Pencil,
  archived: Archive,
  added: UserPlus,
  removed: UserMinus,
  moved_in: LogIn,
  moved_out: LogOut,
}

function Line({ line }: Readonly<{ line: PortalGroupHistoryLine }>) {
  const Icon = ICON[line.kind]
  return (
    <TimelineItem>
      <TimelineIndicator>
        <Icon />
      </TimelineIndicator>
      <TimelineConnector />
      <TimelineContent className="pt-1 text-sm">
        <p>
          {line.text} ·{' '}
          <time dateTime={line.occurredAt} className="text-muted-foreground">
            {line.dateLabel}
          </time>
        </p>
        {line.detail ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{line.detail}</p>
        ) : null}
      </TimelineContent>
    </TimelineItem>
  )
}

export function PortalGroupHistory({ state, names, frame, onRetry }: Props) {
  if (state.status === 'off') return null
  const lines =
    state.status === 'ready' ? buildPortalGroupHistory(state.data, names, frame) : []
  return (
    <section aria-labelledby="group-history-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="group-history-heading" className="text-base font-semibold">
          History
        </h2>
        <p className="text-xs text-muted-foreground">Newest first</p>
      </div>
      {state.status === 'loading' ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Loading the history</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3"
        >
          <p className="text-sm text-muted-foreground">The history couldn’t be loaded.</p>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 md:min-h-8"
            onClick={onRetry}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {state.status === 'ready' && lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has happened to this group yet.
        </p>
      ) : null}
      {lines.length > 0 ? (
        <Timeline>
          {lines.map((line) => (
            <Line key={line.id} line={line} />
          ))}
        </Timeline>
      ) : null}
    </section>
  )
}
