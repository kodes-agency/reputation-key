// "Showing 1–20 of 45" and the way to the other pages. The page is in the URL,
// so a reload or a shared link lands on the same page.
import { Button } from '#/components/ui/button'
import { describeRange, type PortalOverviewPage } from './portal-overview-view'

type Props = Readonly<{
  overview: Pick<PortalOverviewPage, 'from' | 'to' | 'matched' | 'page' | 'lastPage'>
  onPage: (page: number) => void
}>

export function PortalOverviewPager({ overview, onPage }: Props) {
  const { page, lastPage } = overview
  return (
    <div className="flex items-center justify-between gap-4">
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {describeRange(overview)}
      </p>
      {lastPage > 1 && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            disabled={page === 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            disabled={page === lastPage}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
