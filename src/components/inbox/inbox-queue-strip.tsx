import { useLayoutEffect, useRef } from 'react'
import type {
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { cn } from '#/lib/utils'
import { revealCurrentItem, stripFadeStyle } from '#/components/ui/strip-scroll'
import { useStripOverflow } from '#/components/ui/use-strip-overflow'
import { CLOSED_INBOX_QUEUE, queueCount, queuesForViewer } from './inbox-queues'

export function InboxQueueStrip({
  queue,
  counts,
  canManageReplies,
  onQueueChange,
}: Readonly<{
  queue: InboxQueue
  counts: InboxQueueCounts | undefined
  canManageReplies: boolean
  onQueueChange: (queue: InboxQueue) => void
}>) {
  const items = [...queuesForViewer(canManageReplies), CLOSED_INBOX_QUEUE]
  const navRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    if (navRef.current) revealCurrentItem(navRef.current)
  }, [queue])

  const edges = useStripOverflow(navRef)

  // scroll-px-6 is the edge fade's width (STRIP_FADE_PX), so a pill that snaps
  // or scrolls in clears the fade. The first pill's snap position is negative
  // (its left is 16px, less than 24), so it stays on the gutter at rest: with
  // no scroll padding snap-start would have swallowed the gutter on load and
  // put it on x=0.
  return (
    <nav
      ref={navRef}
      aria-label="Queues"
      style={stripFadeStyle(edges)}
      className="flex h-11 shrink-0 snap-x items-center gap-2 overflow-x-auto border-b px-3 scroll-px-6 [scrollbar-width:none] max-md:px-4"
    >
      {items.map((item) => {
        const count = queueCount(counts, item.key)
        return (
          <button
            key={item.key}
            type="button"
            aria-current={queue === item.key ? 'page' : undefined}
            className={cn(
              'h-8 shrink-0 snap-start rounded-full px-3 text-xs font-medium',
              queue === item.key
                ? 'bg-accent text-(--accent)'
                : 'bg-muted text-muted-foreground',
            )}
            onClick={() => onQueueChange(item.key)}
          >
            {item.label}
            {count !== null && count > 0 ? ` ${count}` : ''}
          </button>
        )
      })}
    </nav>
  )
}
