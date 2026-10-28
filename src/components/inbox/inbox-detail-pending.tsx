import type { ReactNode } from 'react'
import { Skeleton } from '#/components/ui/skeleton'

/**
 * What the detail pane draws while its first read is on its way: the case
 * toolbar's row, the conversation, and the composer's dock, each in the box it
 * fills once loaded, so the page does not jump when the pane arrives. The header
 * above is already the real one (the list row has what it needs).
 *
 * The classes of the two bars repeat the toolbar's (`inbox-case-toolbar.tsx`)
 * and the composer region's (`reply-composer.tsx`) frame; the dock is a compose
 * form's height (a head row, a text box, a foot row), the usual first state.
 */
export function InboxDetailPending(): ReactNode {
  return (
    <>
      <div
        aria-hidden="true"
        className="flex min-h-12 shrink-0 items-center gap-3 border-b px-5 py-1 max-md:min-h-11 max-md:px-4 max-md:py-0.5 lg:px-6"
      >
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="ml-auto h-8 w-20" />
      </div>

      <section
        aria-label="Conversation"
        aria-busy="true"
        className="min-h-0 flex-1 overflow-hidden"
      >
        <div className="flex min-w-0 flex-col gap-6 p-5 max-md:px-4 lg:p-6">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-4 w-1/2" />
          <span className="sr-only" role="status">
            Loading the review…
          </span>
        </div>
      </section>

      <div
        aria-hidden="true"
        className="flex shrink-0 flex-col gap-3 border-t px-5 py-4 max-md:px-4 lg:px-6"
      >
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-9 w-28 self-end" />
      </div>
    </>
  )
}
