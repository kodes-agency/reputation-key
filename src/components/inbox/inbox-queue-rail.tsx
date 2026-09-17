import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import { Separator } from '#/components/ui/separator'
import type {
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { cn } from '#/lib/utils'
import {
  CLOSED_INBOX_QUEUE,
  queueCount,
  queuesForViewer,
  type InboxQueueItem,
} from './inbox-queues'

type Props = Readonly<{
  queue: InboxQueue
  counts: InboxQueueCounts | undefined
  canManageReplies: boolean
  /** The property select, above the queues because it decides their counts.
   * Absent when there is no property choice to offer. */
  scopeControl?: ReactNode
  onQueueChange: (queue: InboxQueue) => void
  onOpenShortcuts: () => void
}>

function QueueButton({
  item,
  active,
  count,
  onSelect,
}: Readonly<{
  item: InboxQueueItem
  active: boolean
  count: number | null
  onSelect: () => void
}>) {
  const Icon = item.icon
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'h-8 w-full justify-start gap-2 px-2 text-[13px] font-medium',
        active && 'bg-accent text-foreground',
      )}
      onClick={onSelect}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span>{item.label}</span>
      {count !== null && count > 0 && (
        <span
          className={cn(
            'ml-auto text-xs tabular-nums text-muted-foreground',
            item.key === 'escalated' && 'text-negative',
          )}
        >
          {count}
        </span>
      )}
    </Button>
  )
}

export function InboxQueueRail({
  queue,
  counts,
  canManageReplies,
  scopeControl,
  onQueueChange,
  onOpenShortcuts,
}: Props) {
  return (
    <aside
      data-inbox-queue-rail
      className="flex h-full w-56 shrink-0 flex-col border-r bg-background"
    >
      {scopeControl && <div className="shrink-0 px-3 pt-4">{scopeControl}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <nav aria-label="Queues">
          <p className="mb-2 px-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            Queues
          </p>
          <div className="space-y-1">
            {queuesForViewer(canManageReplies).map((item) => (
              <QueueButton
                key={item.key}
                item={item}
                active={queue === item.key}
                count={queueCount(counts, item.key)}
                onSelect={() => onQueueChange(item.key)}
              />
            ))}
          </div>
          <Separator className="my-3" />
          <QueueButton
            item={CLOSED_INBOX_QUEUE}
            active={queue === 'closed'}
            count={queueCount(counts, 'closed')}
            onSelect={() => onQueueChange('closed')}
          />
        </nav>
      </div>
      <div className="border-t p-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full justify-start px-2 text-[13px]"
          onClick={onOpenShortcuts}
        >
          Keyboard shortcuts
          <Kbd className="ml-auto bg-background">?</Kbd>
        </Button>
      </div>
    </aside>
  )
}
