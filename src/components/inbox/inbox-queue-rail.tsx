import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import type {
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { InboxQueueList } from './inbox-queue-list'
import { railSections, type InboxQueueViewer } from './inbox-queue-sections'

type Props = Readonly<{
  queue: InboxQueue
  counts: InboxQueueCounts | undefined
  /** What the viewer may see: reply stages, and each kind's read permission. */
  viewer: InboxQueueViewer
  /** The property select, above the queues because it decides their counts.
   * Absent when there is no property choice to offer. */
  scopeControl?: ReactNode
  onQueueChange: (queue: InboxQueue) => void
  onOpenShortcuts: () => void
}>

export function InboxQueueRail({
  queue,
  counts,
  viewer,
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
        <InboxQueueList
          sections={railSections(viewer)}
          queue={queue}
          counts={counts}
          density="rail"
          onSelect={onQueueChange}
        />
      </div>
      <div className="border-t p-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start px-2 text-[13px]"
          onClick={onOpenShortcuts}
        >
          Keyboard shortcuts
          <Kbd className="ml-auto bg-background">?</Kbd>
        </Button>
      </div>
    </aside>
  )
}
