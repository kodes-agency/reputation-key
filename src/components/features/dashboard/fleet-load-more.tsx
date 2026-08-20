// Fleet pagination control.
//
// The projection pages at FLEET_PAGE_SIZE = 50 and hands back an opaque cursor.
// Without this the fifty-first property was unreachable AND unsignalled — the
// row list simply stopped. Mirrors the inbox list's LoadMoreButton so the two
// paginated surfaces behave alike.
//
// Extracted from fleet-overview.tsx for the 200-line cap.
import { Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'

export function FleetLoadMore({
  nextCursor,
  isFetchingNextPage,
  onLoadMore,
}: Readonly<{
  nextCursor: string | null
  isFetchingNextPage: boolean
  onLoadMore?: () => void
}>) {
  // No cursor means this is the last page, and the ABSENCE of the control is the
  // signal that nothing was truncated. `onLoadMore` is absent in the fixture and
  // story cases that render one settled page.
  if (nextCursor === null || !onLoadMore) return null
  return (
    <div className="flex justify-center">
      <Button
        variant="outline"
        size="sm"
        disabled={isFetchingNextPage}
        onClick={onLoadMore}
      >
        {isFetchingNextPage ? (
          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
        ) : null}
        Load more properties
      </Button>
    </div>
  )
}
