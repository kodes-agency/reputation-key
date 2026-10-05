// "Load more" for a cursor feed (UI consistency scan: COLL-16): the Inbox list, the
// notification list, the Portal history ledger and the Google import lists. A list
// with page numbers (the Portals overview) is `PortalOverviewPager`, not this.
//
// While a page loads the button shows a spinner and "Loading…" and is
// `aria-disabled`, not `disabled`: a focused button that becomes disabled drops
// focus to <body> in Chromium, which is outside a non-modal popover. A `Button`
// `pending` is natively disabled, so this one draws its own spinner (the same
// allowance as `RetryButton`).
import { Loader2 } from 'lucide-react'
import { Button, type ButtonProps } from '#/components/ui/button'
import { cn } from '#/lib/utils'

type Props = Readonly<
  Omit<
    ButtonProps,
    'variant' | 'size' | 'pending' | 'pendingLabel' | 'asChild' | 'children' | 'onClick'
  > & {
    onLoadMore: () => void
    /** A page is loading. */
    loading: boolean
    /** The last attempt failed: the label is "Try again". */
    failed?: boolean
    /** What it loads, when the feed has a noun: "Load earlier activity". */
    label?: string
    size?: 'sm' | 'default'
    /** Fill the column, for a button at the foot of a card. */
    block?: boolean
  }
>

export function LoadMoreButton({
  onLoadMore,
  loading,
  failed = false,
  label = 'Load more',
  size = 'sm',
  block = false,
  className,
  ...props
}: Props) {
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={() => {
        if (!loading) onLoadMore()
      }}
      className={cn('aria-disabled:cursor-default', block && 'w-full', className)}
      {...props}
    >
      {loading ? (
        <>
          <Loader2
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Loading…
        </>
      ) : failed ? (
        'Try again'
      ) : (
        label
      )}
    </Button>
  )
}
