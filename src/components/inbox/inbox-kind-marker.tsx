// Which kind of work an item is, in the rail's own words (ADR 0057, amended
// 2026-10-28). The shared views (Mine, Escalated, All open) mix Reviews and
// private feedback, so the row and the open item have to say which one they are:
// a glyph and a word, so colour never carries the kind alone.
import { Badge } from '#/components/ui/badge'
import { cn } from '#/lib/utils'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { KIND_GLYPH } from './inbox-queues'

type KindedItem = Pick<InboxItem, 'sourceType' | 'platform'>

/** The words for the open item's kind: "Google review", "Review", "Private feedback". */
export function kindMarkerWords(item: KindedItem): string {
  if (item.sourceType === 'feedback') return 'Private feedback'
  return item.platform?.toLowerCase() === 'google' ? 'Google review' : 'Review'
}

/**
 * A list row's "Private" badge, first on its line, before the rating. A
 * Review's row carries none: the rating star is its mark, and the rail's
 * Reviews section is where it lives.
 */
export function PrivateBadge() {
  const Glyph = KIND_GLYPH.feedback.icon
  return (
    // 18 px, the height of the row's first line, so the line does not grow.
    <Badge variant="neutral" className="gap-1 px-1.5 py-0">
      <Glyph aria-hidden="true" />
      Private
    </Badge>
  )
}

/** The kind's glyph at the detail header's size. The words that name it are `kindMarkerWords`. */
export function KindGlyph({ item }: Readonly<{ item: KindedItem }>) {
  const { icon: Glyph, className } = KIND_GLYPH[item.sourceType]
  return <Glyph aria-hidden="true" className={cn('size-4 shrink-0', className)} />
}
