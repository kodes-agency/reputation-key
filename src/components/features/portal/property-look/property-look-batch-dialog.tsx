// "Review & publish N portals" (board 9's button): what publishing the look
// does to each live portal, before it does it. Every live portal is asked what
// it would publish and whether anything stops it; the ready ones are ticked, a
// manager may leave one out, and one press publishes the rest in turn. A portal
// that cannot be published does not hold the others back, and the result says
// what happened to each.
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Skeleton } from '#/components/ui/skeleton'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { BatchOutcomeRows, BatchReviewRows } from './property-look-batch-rows'
import {
  describeBatchSummary,
  describeOutcomesSummary,
  totalsOf,
} from './property-look-batch-rules'
import {
  usePropertyLookBatch,
  type PortalReviewReader,
  type PublishPortalsAction,
} from './use-property-look-batch'
import type { AffectedPortalRow } from './property-look-rules'

type Props = Readonly<{
  propertyId: string
  live: readonly AffectedPortalRow[]
  getPortalReview: PortalReviewReader
  publishPortals: PublishPortalsAction
  onClose: () => void
}>

const portalsOf = (count: number) => (count === 1 ? '1 portal' : `${count} portals`)

export function PropertyLookBatchDialog({
  propertyId,
  live,
  getPortalReview,
  publishPortals,
  onClose,
}: Props) {
  const batch = usePropertyLookBatch({
    propertyId,
    live,
    getPortalReview,
    publishPortals,
  })
  const { run } = batch
  const isPublishing = run.status === 'publishing'
  const isDone = run.status === 'done'

  return (
    <Dialog
      open
      // Closing in the middle of a publish would hide what it did.
      onOpenChange={(open) => (open || isPublishing ? undefined : onClose())}
    >
      <DialogContent className="sm:max-w-xl" aria-busy={batch.isLoading || isPublishing}>
        <DialogHeader>
          <DialogTitle>Review &amp; publish {portalsOf(live.length)}</DialogTitle>
          <DialogDescription>
            {isDone
              ? 'Here is what happened to each portal.'
              : 'Each live portal gets its saved draft, with the new look, as a new version. Printed codes keep working.'}
          </DialogDescription>
        </DialogHeader>

        {isDone ? (
          <>
            <p className="text-sm font-medium" role="status">
              {describeOutcomesSummary(run.outcomes)}
            </p>
            {run.error === null ? null : (
              <p role="alert" className="text-sm text-negative">
                Publishing stopped: {actionErrorMessage(run.error)} The portals after it
                were not touched.
              </p>
            )}
            <BatchOutcomeRows
              rows={live}
              attempted={run.attempted}
              outcomes={run.outcomes}
            />
          </>
        ) : batch.isLoading ? (
          <div role="status" className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Checking {portalsOf(live.length)}…
            </p>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : batch.rows === null || batch.hasReadFailed ? (
          <p role="alert" className="text-sm text-negative">
            The portals could not be checked.{' '}
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto p-0"
              onClick={batch.reload}
            >
              Try again
            </Button>
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {describeBatchSummary(totalsOf(batch.rows.map((item) => item.entry)))}
            </p>
            <BatchReviewRows
              propertyId={propertyId}
              rows={batch.rows}
              leftOut={batch.leftOut}
              onToggle={batch.toggle}
            />
          </>
        )}

        <DialogFooter>
          {isDone ? (
            <>
              {batch.retryable.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void batch.retry()}
                >
                  Try {batch.retryable.length === 1 ? 'it' : 'them'} again
                </Button>
              ) : null}
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={isPublishing}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isPublishing || batch.publishable.length === 0}
                onClick={() => void batch.publish()}
              >
                {isPublishing
                  ? 'Publishing…'
                  : batch.publishable.length === 0
                    ? 'Nothing to publish'
                    : `Publish ${portalsOf(batch.publishable.length)}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
