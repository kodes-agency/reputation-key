import { Button } from '#/components/ui/button'
import { LoadMoreButton } from '#/components/ui/load-more-button'

type Props = Readonly<{
  selectedCount: number
  loadedCount: number
  isLoadingCandidates: boolean
  isLoadingMoreCandidates: boolean
  hasMoreCandidates: boolean
  isSelectingAll: boolean
  onSelectAllEligible: () => void
  onLoadMoreCandidates: () => void
  onReview: () => void
}>

/**
 * Selection tally plus the three actions that act on it. Split out of the
 * discovery panel so the panel keeps only the account/loading branch and this
 * file owns the per-button pending and availability states.
 */
export function GoogleImportSelectionFooter({
  selectedCount,
  loadedCount,
  isLoadingCandidates,
  isLoadingMoreCandidates,
  hasMoreCandidates,
  isSelectingAll,
  onSelectAllEligible,
  onLoadMoreCandidates,
  onReview,
}: Props) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div aria-live="polite" className="text-sm text-muted-foreground">
        <p>
          {selectedCount} selected · {loadedCount} matching loaded
        </p>
        <p className="mt-0.5 text-xs">
          Select all eligible loads every remaining Google page first.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          pending={isSelectingAll}
          pendingLabel="Loading all locations…"
          disabled={isLoadingCandidates || loadedCount === 0}
          onClick={onSelectAllEligible}
        >
          Select all eligible locations
        </Button>
        {hasMoreCandidates ? (
          <LoadMoreButton
            size="default"
            label="Load more locations"
            loading={isLoadingMoreCandidates}
            onLoadMore={onLoadMoreCandidates}
          />
        ) : null}
        <Button type="button" disabled={selectedCount === 0} onClick={onReview}>
          Review {selectedCount || ''} {selectedCount === 1 ? 'property' : 'properties'}
        </Button>
      </div>
    </div>
  )
}
