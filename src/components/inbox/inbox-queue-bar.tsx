// The phone's queue bar (ADR 0057, amended 2026-10-28): one button naming the
// queue in view, which opens the desktop rail's sections in a bottom sheet, and
// a chip beside it that jumps to the other kind's open work. It replaces the
// strip of pills, which could not show the section headings and left the
// private feedback off the screen. The bar keeps #675's phone grid: a 44 px bar
// on the 16 px gutter, with 36 px controls.
import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { IconButton } from '#/components/ui/icon-button'
import { NavCount } from '#/components/ui/nav-count'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '#/components/ui/sheet'
import type {
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import { InboxQueueList } from './inbox-queue-list'
import {
  otherKindShortcut,
  railSections,
  type InboxQueueViewer,
} from './inbox-queue-sections'
import { queueCount, queueItem } from './inbox-queues'

type Props = Readonly<{
  queue: InboxQueue
  counts: InboxQueueCounts | undefined
  viewer: InboxQueueViewer
  onQueueChange: (queue: InboxQueue) => void
}>

/** The queue sheet: the rail's sections, with 44 px rows, in the pattern of "Sort and filter". */
function QueueSheetContent({
  queue,
  counts,
  viewer,
  onChoose,
}: Readonly<{
  queue: InboxQueue
  counts: InboxQueueCounts | undefined
  viewer: InboxQueueViewer
  onChoose: (queue: InboxQueue) => void
}>) {
  return (
    <SheetContent
      side="bottom"
      showCloseButton={false}
      data-inbox-queue-sheet
      className="max-h-[85dvh] gap-0 rounded-t-xl p-0"
    >
      <div
        data-density="compact"
        className="flex h-11 shrink-0 items-center justify-between border-b px-4"
      >
        <SheetTitle className="text-base">Queues</SheetTitle>
        <SheetClose asChild>
          <IconButton variant="ghost" className="-mr-2.5" label="Close" tooltip={false}>
            <X />
          </IconButton>
        </SheetClose>
      </div>
      <SheetDescription className="sr-only">
        Choose which queue the list shows.
      </SheetDescription>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <InboxQueueList
          sections={railSections(viewer)}
          queue={queue}
          counts={counts}
          density="sheet"
          onSelect={onChoose}
        />
      </div>
    </SheetContent>
  )
}

export function InboxQueueBar({ queue, counts, viewer, onQueueChange }: Props) {
  const [open, setOpen] = useState(false)
  const current = queueItem(queue, viewer.canManageReplies)
  const CurrentGlyph = current.icon
  const count = queueCount(counts, queue)
  const shortcut = otherKindShortcut(queue, viewer, counts)

  function choose(next: InboxQueue) {
    setOpen(false)
    if (next !== queue) onQueueChange(next)
  }

  return (
    <div
      data-inbox-queue-bar
      className="flex h-11 shrink-0 items-center gap-2 border-b px-4"
    >
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            data-inbox-queue-button
            className="min-w-0 shrink justify-start gap-2 font-medium"
          >
            <CurrentGlyph aria-hidden="true" />
            <span className="truncate">{current.label}</span>
            {count !== null && count > 0 && (
              <NavCount tone={queue === 'escalated' ? 'negative' : 'default'}>
                {count}
              </NavCount>
            )}
            <ChevronDown aria-hidden="true" className="opacity-60" />
          </Button>
        </SheetTrigger>
        <QueueSheetContent
          queue={queue}
          counts={counts}
          viewer={viewer}
          onChoose={choose}
        />
      </Sheet>
      {shortcut !== null && (
        // Words and a count, no glyph: at 320 px the glyph is what would push the
        // queue's own name into a truncation ("Needs r…") on the commonest queue,
        // and the words say which kind it is.
        <Button
          variant="secondary"
          data-inbox-queue-chip
          className="ml-auto rounded-full px-3 font-medium"
          onClick={() => onQueueChange(shortcut.item.key)}
        >
          {shortcut.item.label}
          <NavCount className="text-foreground">{shortcut.count}</NavCount>
        </Button>
      )}
    </div>
  )
}
