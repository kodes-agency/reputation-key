import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#/components/ui/collapsible'
import { inboxKeys } from '#/shared/queries/query-keys'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import {
  actionIcon,
  actionLabel,
  formatDate,
  formatActorAndTime,
} from './inbox-timeline-helpers'

type Props = Readonly<{
  inboxItemId: string
  getActivityTimeline: typeof getActivityTimelineFn
}>

type Entries = Awaited<ReturnType<typeof getActivityTimelineFn>>

function TimelineEntries({ entries }: Readonly<{ entries: Entries }>) {
  return (
    <div className="relative ml-1.5 mt-4">
      <div className="absolute bottom-1.5 left-[11px] top-1.5 w-px bg-border" />
      <div className="space-y-4">
        {entries.map((entry, index) => {
          const date = formatDate(entry.createdAt)
          const previousDate =
            index === 0 ? null : formatDate(entries[index - 1]!.createdAt)
          const showDate = date !== previousDate
          return (
            <div key={entry.id}>
              {showDate && (
                <div className="mb-3 flex items-center gap-3">
                  <div className="size-2 shrink-0 rounded-full bg-border" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {date}
                  </span>
                </div>
              )}
              <div className="ml-0.5 flex items-start gap-3">
                <div className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background">
                  {actionIcon(entry.action)}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{actionLabel(entry)}</span>
                    <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px]">
                      {entry.action}
                    </Badge>
                  </div>
                  {formatActorAndTime(entry.actorName, entry.createdAt)}
                  {entry.action === 'added' && entry.payload.detail && (
                    <p className="mt-1 line-clamp-2 text-xs italic text-muted-foreground">
                      &ldquo;{entry.payload.detail}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function InboxActivityTimeline({ inboxItemId, getActivityTimeline }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: inboxKeys.activity(inboxItemId),
    queryFn: () =>
      getActivityTimeline({
        data: { resourceType: 'inbox_item', resourceId: inboxItemId },
      }),
    staleTime: 0,
  })
  const entries = data ?? []
  return (
    <Collapsible className="group border-t pt-1">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-3 text-left text-sm font-medium">
        Activity
        <span className="text-xs font-normal text-muted-foreground">
          {isLoading
            ? 'Loading…'
            : `${entries.length} ${entries.length === 1 ? 'event' : 'events'}`}
        </span>
        <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-4">
        {error ? (
          <p className="text-sm text-muted-foreground">Failed to load activity.</p>
        ) : entries.length ? (
          <TimelineEntries entries={entries} />
        ) : (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
