import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

// The one dashed "nothing here / this could not be shown" panel. A page, a card
// body, a rail, a popover and a dialog all draw it, so the size and the tone
// are choices of this primitive and a caller never restyles it with a class.
//
//   size  default  the region is the page's content (first run, no results)
//         compact  a slot inside a list, a rail, a card, a popover or a dialog
//   tone  neutral  nothing to show yet, or nothing matches
//         error    the region failed (use RegionError, which adds "Try again")

const SIZE = {
  default: { panel: 'gap-3 px-4 py-12', disc: 'size-10' },
  compact: { panel: 'gap-2 px-4 py-6', disc: 'size-8' },
} as const

const TONE = {
  neutral: {
    disc: 'bg-muted',
    icon: 'text-muted-foreground',
    title: 'text-muted-foreground',
  },
  error: {
    disc: 'bg-destructive/10',
    icon: 'text-destructive',
    title: 'text-destructive',
  },
} as const

type Props = Readonly<{
  icon: LucideIcon
  title: string
  /** One or two quiet sentences under the title. A node, so a sentence can carry a link. */
  description?: ReactNode
  /** What to do about it: a button or a link. Last in the panel. */
  action?: ReactNode
  size?: keyof typeof SIZE
  tone?: keyof typeof TONE
  className?: string
  /** Free-form content in a column under the action. Prefer `description` and `action`. */
  children?: ReactNode
}>

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = 'default',
  tone = 'neutral',
  className,
  children,
}: Props) {
  const sizing = SIZE[size]
  const toning = TONE[tone]
  return (
    <div
      data-slot="empty-state"
      data-size={size}
      data-tone={tone}
      // A failed region is announced; "nothing here" is not news.
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center rounded-lg border border-dashed text-center',
        sizing.panel,
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full',
          sizing.disc,
          toning.disc,
        )}
      >
        <Icon className={cn('size-4', toning.icon)} />
      </div>
      <p className={cn('text-sm font-medium', toning.title)}>{title}</p>
      {description ? (
        <p
          data-slot="empty-state-description"
          className="max-w-md text-sm text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
      {action ? (
        <div
          data-slot="empty-state-action"
          className="flex flex-wrap items-center justify-center gap-2"
        >
          {action}
        </div>
      ) : null}
      {children ? (
        <div className="flex flex-col items-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}
