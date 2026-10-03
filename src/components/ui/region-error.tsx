import { CircleAlert, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/ui/empty-state'

// A region of a page (a list, a strip, a card, a rail, a preview) that could
// not be read. It says what failed and always offers the same recovery, "Try
// again", wired to the region's own refetch. Page-level failures (a route that
// could not load) are PageState's; a failed *action* (a save, a publish) is the
// form's banner or a toast.
//
// Copy: "The goal couldn’t be loaded." One sentence naming the thing, past
// tense, curly apostrophe. Never "Retry", "Check again" or "Please try again".

/**
 * How tall the recovery is on a phone, until the Button carries a density of its
 * own (plan D1, decision 1).
 *
 *   default  the 44px touch target
 *   compact  the named dense-workspace density, 36px: the Inbox's panes, whose
 *            controls were measured at 36px on purpose (WCAG 2.5.8 AA asks for
 *            24, and 44 is what inflated the phone pane)
 */
export type RetryDensity = 'default' | 'compact'

const PHONE_HEIGHT: Readonly<Record<RetryDensity, string>> = {
  default: 'max-md:min-h-11',
  compact: 'max-md:h-9',
}

type RetryButtonProps = Readonly<{
  onRetry: () => void
  /** The retry is reading. The button stays (so focus does not fall to <body>) but is inert. */
  retrying?: boolean
  size?: 'sm' | 'xs'
  density?: RetryDensity
}>

/**
 * "Try again", for a failure shown inline in a notice or a status line where a
 * whole RegionError panel would be too much. One variant, one label.
 */
export function RetryButton({
  onRetry,
  retrying = false,
  size = 'sm',
  density = 'default',
}: RetryButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={size === 'sm' ? PHONE_HEIGHT[density] : undefined}
      // aria-disabled, not disabled: a focused button that becomes disabled drops
      // focus to <body> in Chromium.
      aria-disabled={retrying || undefined}
      aria-busy={retrying || undefined}
      onClick={() => {
        if (!retrying) onRetry()
      }}
    >
      {retrying ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : null}
      {/* The name a screen reader hears never changes. A RegionError is a
          role="alert", so a changed label would read the whole panel out again
          every time the retry starts and ends; the busy button says the rest. */}
      <span className={retrying ? 'sr-only' : undefined}>Try again</span>
      {retrying ? <span aria-hidden="true">Trying again…</span> : null}
    </Button>
  )
}

type Props = Readonly<{
  /** What failed, as one sentence: "The goal couldn’t be loaded." */
  message: string
  /** What is unaffected, or what to do meanwhile. */
  description?: ReactNode
  onRetry: () => void
  /**
   * The retry is reading. A refetch after a failure keeps the query in its error
   * state while it reads, so the panel stays, its button busy, until the answer
   * comes. Required so that a caller states it (`query.isFetching`) rather than
   * leaving the button silent.
   */
  retrying: boolean
  size?: 'default' | 'compact'
  density?: RetryDensity
  /** Leave the region instead of trying again, beside Try again (a dialog's Cancel). */
  onCancel?: () => void
}>

export function RegionError({
  message,
  description,
  onRetry,
  retrying,
  size = 'default',
  density = 'default',
  onCancel,
}: Props) {
  return (
    <EmptyState
      icon={CircleAlert}
      tone="error"
      size={size}
      title={message}
      description={description}
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <RetryButton onRetry={onRetry} retrying={retrying} density={density} />
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={PHONE_HEIGHT[density]}
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      }
    />
  )
}
