// Inbox activity timeline — displays chronological activity log for an inbox item.
// Built with shadcn primitives instead of ReUI (ReUI registry is inaccessible via CLI).

import { useEffect, useState, useCallback } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { useAction } from '#/components/hooks/use-action'
import type { getActivityTimelineFn } from '#/contexts/activity/server/activity'
import { Badge } from '#/components/ui/badge'
import { Skeleton } from '#/components/ui/skeleton'
import type { ActivityLog } from '#/contexts/activity/application/public-api'
import {
  actionIcon,
  actionLabel,
  formatDate,
  formatActorAndTime,
} from './inbox-timeline-helpers'

type InboxActivityTimelineProps = Readonly<{
  inboxItemId: string
  /** Bumped on status change — triggers a re-fetch so timeline updates after mark-as-read. */
  refreshKey?: number
  /** Raw server fn — wrapped with useServerFn per src/components/CONTEXT.md:55. */
  getActivityTimeline: typeof getActivityTimelineFn
}>

export function InboxActivityTimeline({
  inboxItemId,
  refreshKey,
  getActivityTimeline,
}: InboxActivityTimelineProps) {
  const getTimeline = useAction(useServerFn(getActivityTimeline))
  const [entries, setEntries] = useState<readonly ActivityLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadTimeline = useCallback(async () => {
    if (!inboxItemId) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await getTimeline({
        data: { resourceType: 'inbox_item', resourceId: inboxItemId },
      })
      if (result) setEntries(result)
    } catch {
      setError('Failed to load activity')
    } finally {
      setIsLoading(false)
    }
  }, [inboxItemId])

  // F122: Fixed double fetch — initial load and refreshKey-triggered load are
  // separated into distinct effects. Previously, loadTimeline was in deps
  // causing it to re-run whenever inboxItemId changed even when refreshKey didn't.
  useEffect(() => {
    loadTimeline()
  }, [loadTimeline])

  // When refreshKey changes (status change, note added), the BullMQ pipeline
  // (event → handler → job → worker → DB insert) takes ~1-2s.
  // Schedule a delayed re-fetch to pick up the new activity row.
  useEffect(() => {
    if (refreshKey === undefined) return
    const timer = setTimeout(loadTimeline, 2000)
    return () => clearTimeout(timer)
  }, [loadTimeline, refreshKey])

  if (isLoading) return <TimelineSkeleton />
  if (error) return <TimelineError message={error} />
  if (entries.length === 0) return <TimelineEmpty />

  let lastDate = ''

  return (
    <div className="border-t pt-4">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Activity</h3>
      <div className="relative ml-1.5">
        <div className="absolute left-[11px] top-1.5 bottom-1.5 w-px bg-border" />
        <div className="space-y-4">
          {entries.map((entry) => {
            const date = formatDate(entry.createdAt)
            const showDate = date !== lastDate
            lastDate = date

            return (
              <div key={entry.id}>
                {showDate && (
                  <div className="flex items-center gap-3 mb-3">
                    <div className="size-2 rounded-full bg-border shrink-0" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {date}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-3 ml-0.5">
                  <div className="relative z-10 flex items-center justify-center size-6 rounded-full bg-background border shrink-0">
                    {actionIcon(entry.action)}
                  </div>
                  <div className="flex-1 min-w-0 pb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm">{actionLabel(entry)}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                        {entry.action}
                      </Badge>
                    </div>
                    {formatActorAndTime(entry.actorName, entry.createdAt)}
                    {entry.action === 'added' && entry.payload.detail && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2 italic">
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
    </div>
  )
}

function TimelineSkeleton() {
  return (
    <div className="border-t pt-4 space-y-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

function TimelineError({ message }: { message: string }) {
  return <div className="border-t pt-4 text-sm text-muted-foreground">{message}</div>
}

function TimelineEmpty() {
  return (
    <div className="border-t pt-4 text-sm text-muted-foreground">
      No activity recorded yet.
    </div>
  )
}
