import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

/**
 * The body of a dashboard topic page below its header, while the next range is
 * being read.
 *
 * Choosing a range used to replace the whole page with its skeleton: the header
 * and the range control unmounted under the person's hand and the keyboard focus
 * was lost (an arrow key chooses a segment, so the next arrow went nowhere). The
 * page now keeps the range it has, dimmed and marked busy, until the new one
 * arrives, so the control and the page frame stay where they are. The body
 * spaces its children as `PageShell` does, so the wrapper moves nothing.
 *
 * Opacity is a compositor property: no layout, and `motion-reduce` makes the
 * change instant.
 */
export function RangeBusyRegion({
  busy,
  children,
}: Readonly<{ busy: boolean; children: ReactNode }>) {
  return (
    <div
      aria-busy={busy}
      className={cn(
        'space-y-5 transition-opacity duration-150 motion-reduce:transition-none md:space-y-8',
        busy && 'opacity-60',
      )}
    >
      {children}
    </div>
  )
}
