import type {
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { cn } from '#/lib/utils'
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
  return (
    <nav
      aria-label="Queues"
      className="flex h-11 shrink-0 snap-x items-center gap-2 overflow-x-auto border-b px-3 [scrollbar-width:none]"
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
