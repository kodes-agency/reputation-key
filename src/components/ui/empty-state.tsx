import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

// The one dashed "nothing here / this could not be shown" panel. A page, a card
// body, a rail, a popover and a dialog all draw it, so the size and the tone
// are choices of this primitive and a caller never restyles it with a class.
//
//   size  default  the region is the page's content (first run, no results)
//         compact  a slot inside a list, a rail, a card, a popover or a dialog
//   tone  neutral  nothing to show yet, or nothing matches
//         error    the region failed (use RegionError, which adds "Try again")
//
// It sits on the first-paint path (a missing or unavailable page draws it), so it
// stays small: two flags, three slots, no lookup tables.

type Props = Readonly<{
  icon: LucideIcon
  title: string
  /** One or two quiet sentences under the title. A node, so a sentence can carry a link. */
  description?: ReactNode
  /** What to do about it: a button or a link; for several, pass them already in a row. Last in the panel. */
  action?: ReactNode
  size?: 'default' | 'compact'
  tone?: 'neutral' | 'error'
}>

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'default',
  tone = 'neutral',
}: Props) {
  const compact = size === 'compact'
  const failed = tone === 'error'
  const ink = failed ? 'text-destructive' : 'text-muted-foreground'
  return (
    <div
      data-slot="empty-state"
      // A failed region is announced; "nothing here" is not news.
      role={failed ? 'alert' : undefined}
      className={`flex flex-col items-center rounded-lg border border-dashed px-4 text-center ${compact ? 'gap-2 py-6' : 'gap-3 py-12'}`}
    >
      <div
        className={`flex items-center justify-center rounded-full ${compact ? 'size-8' : 'size-10'} ${failed ? 'bg-destructive/10' : 'bg-muted'}`}
      >
        <Icon className={`size-4 ${ink}`} />
      </div>
      <p className={`text-sm font-medium ${ink}`}>{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action}
    </div>
  )
}
