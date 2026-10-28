// The queues as sections: the rail draws them down the side, the phone's queue
// sheet draws the same list, so the two cannot disagree (ADR 0057, amended
// 2026-10-28). Each titled section is a labelled group inside the one
// "Queues" navigation; the shared views sit below a separator with no heading.
import { useId } from 'react'
import { Button } from '#/components/ui/button'
import { NavCount } from '#/components/ui/nav-count'
import { Separator } from '#/components/ui/separator'
import { cn } from '#/lib/utils'
import type {
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import type { InboxQueueSection } from './inbox-queue-sections'
import { KIND_GLYPH, queueCount, type InboxQueueItem } from './inbox-queues'

/** `rail`: the desktop column's 32 px rows. `sheet`: the phone's touch rows (44 px). */
type InboxQueueListDensity = 'rail' | 'sheet'

function QueueRow({
  item,
  active,
  count,
  density,
  onSelect,
}: Readonly<{
  item: InboxQueueItem
  active: boolean
  count: number | null
  density: InboxQueueListDensity
  onSelect: () => void
}>) {
  const Icon = item.icon
  return (
    <Button
      variant="ghost"
      size={density === 'rail' ? 'sm' : 'lg'}
      aria-current={active ? 'page' : undefined}
      className={cn(
        // `has-[>svg]:px-2`: the Button's own padding for a row that starts with a
        // glyph is wider than this (10 px in the rail, 16 px in the sheet), which
        // would set the glyph off from the section heading above it.
        'w-full justify-start gap-2 px-2 font-medium has-[>svg]:px-2 aria-[current=page]:bg-accent aria-[current=page]:hover:bg-accent',
        density === 'rail' && 'text-[13px]',
      )}
      onClick={onSelect}
    >
      <Icon aria-hidden="true" />
      <span>{item.label}</span>
      {count !== null && count > 0 && (
        <NavCount
          tone={item.key === 'escalated' ? 'negative' : 'default'}
          className="ml-auto"
        >
          {count}
        </NavCount>
      )}
    </Button>
  )
}

function SectionHeading({
  id,
  section,
}: Readonly<{ id: string; section: InboxQueueSection }>) {
  const glyph = section.kind === null ? null : KIND_GLYPH[section.kind]
  const Glyph = glyph?.icon
  return (
    <p
      id={id}
      className="mb-1.5 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase"
    >
      {Glyph && <Glyph aria-hidden="true" className={cn('size-3', glyph.className)} />}
      {section.heading}
    </p>
  )
}

export function InboxQueueList({
  sections,
  queue,
  counts,
  density,
  onSelect,
}: Readonly<{
  sections: ReadonlyArray<InboxQueueSection>
  queue: InboxQueue
  counts: InboxQueueCounts | undefined
  density: InboxQueueListDensity
  onSelect: (queue: InboxQueue) => void
}>) {
  const baseId = useId()
  return (
    <nav aria-label="Queues">
      {sections.map((section, index) => {
        const headingId = `${baseId}-${section.id}`
        const rows = (
          <div className="space-y-1">
            {section.queues.map((item) => (
              <QueueRow
                key={item.key}
                item={item}
                active={queue === item.key}
                count={queueCount(counts, item.key)}
                density={density}
                onSelect={() => onSelect(item.key)}
              />
            ))}
          </div>
        )
        return section.heading === null ? (
          <div key={section.id}>
            {index > 0 && <Separator className="my-3" />}
            {rows}
          </div>
        ) : (
          <div
            key={section.id}
            role="group"
            aria-labelledby={headingId}
            className={index > 0 ? 'mt-4' : undefined}
          >
            <SectionHeading id={headingId} section={section} />
            {rows}
          </div>
        )
      })}
    </nav>
  )
}
