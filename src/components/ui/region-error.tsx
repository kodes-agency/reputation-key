import { AlertCircle, Loader2 } from 'lucide-react'
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

/** Phone-sized targets, until the Button carries a density of its own. */
const TOUCH = 'max-md:min-h-11'

type RetryButtonProps = Readonly<{
  onRetry: () => void
  /** The retry is reading. The button stays (so focus does not fall to <body>) but is inert. */
  retrying?: boolean
  size?: 'sm' | 'xs'
}>

/**
 * "Try again", for a failure shown inline in a notice or a status line where a
 * whole RegionError panel would be too much. One variant, one label.
 */
export function RetryButton({
  onRetry,
  retrying = false,
  size = 'sm',
}: RetryButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={size === 'sm' ? TOUCH : undefined}
      // aria-disabled, not disabled: a focused button that becomes disabled drops
      // focus to <body> in Chromium.
      aria-disabled={retrying || undefined}
      onClick={() => {
        if (!retrying) onRetry()
      }}
    >
      {retrying ? (
        <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : null}
      {retrying ? 'Trying again…' : 'Try again'}
    </Button>
  )
}

type Props = Readonly<{
  /** What failed, as one sentence: "The goal couldn’t be loaded." */
  message: string
  /** What is unaffected, or what to do meanwhile. */
  description?: ReactNode
  onRetry: () => void
  retrying?: boolean
  size?: 'default' | 'compact'
  /** A second action beside Try again, such as Cancel. */
  secondary?: ReactNode
}>

export function RegionError({
  message,
  description,
  onRetry,
  retrying = false,
  size = 'default',
  secondary,
}: Props) {
  return (
    <EmptyState
      icon={AlertCircle}
      tone="error"
      size={size}
      title={message}
      description={description}
      action={
        <>
          <RetryButton onRetry={onRetry} retrying={retrying} />
          {secondary}
        </>
      }
    />
  )
}
