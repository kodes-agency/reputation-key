import { cn } from '#/lib/utils'

/**
 * What a narrowed list says it kept: "3 of 6". The total never reads smaller
 * than what is shown (a queue count that lags a new arrival must not say "13 of
 * 12"), and a list that does not know its total says nothing, because "3" alone
 * is not a count.
 */
export function resultCountText(shown: number, total: number | null): string {
  if (total === null) return ''
  return `${shown} of ${Math.max(shown, total)}`
}

type Props = Readonly<{
  shown: number
  total: number | null
  /** The list is narrowed by a search or a filter; otherwise the count says nothing. */
  active: boolean
  className?: string
}>

/**
 * The list's result count (UI consistency scan: COLL-12): "N of M" beside the
 * toolbar's controls, and the same words in the Inbox's search bar, where it was
 * "N matches".
 *
 * It is always mounted, empty while the list is not narrowed, because a live
 * region that appears together with its text is not announced: this way a screen
 * reader hears the count change as you type.
 */
export function ResultCount({ shown, total, active, className }: Props) {
  return (
    <p
      data-slot="result-count"
      aria-live="polite"
      className={cn('text-sm tabular-nums text-muted-foreground', className)}
    >
      {active ? resultCountText(shown, total) : ''}
    </p>
  )
}
