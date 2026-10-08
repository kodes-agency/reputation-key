// "Review & publish N portals" (board 9's button): what publishing the look
// does to each live portal, before it does it. Every live portal is asked what
// it would publish and whether anything stops it; the ready ones are ticked, a
// manager may leave one out, and one press publishes the rest in turn. A portal
// that cannot be published does not hold the others back, and the result says
// what happened to each.
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogCancel,
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
  describeStop,
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

// fallow-ignore-next-line complexity
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
  // What a run left stays on screen while a retry is in flight.
  const shown =
    run.status === 'done' ? run : run.status === 'publishing' ? run.previous : null
  const sending = run.status === 'publishing' ? run.sending : []

  return (
    <Dialog
      open
      // Closing in the middle of a publish would hide what it did.
      busy={isPublishing}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent size="lg" aria-busy={batch.rows === null || isPublishing}>
        <DialogHeader>
          <DialogTitle>Review &amp; publish {portalsOf(live.length)}</DialogTitle>
          <DialogDescription>
            {shown !== null
              ? 'Here is what happened to each portal.'
              : 'Publishing sends a portal’s whole saved draft live as a new version: the new look, and anything else saved on it. Portals with other draft edits start unticked. Printed codes keep working.'}
          </DialogDescription>
        </DialogHeader>

        {shown !== null ? (
          <>
            <p className="text-sm font-medium" role="status">
              {describeOutcomesSummary(shown.outcomes)}
            </p>
            {shown.error === null || isPublishing ? null : (
              <p role="alert" className="text-sm text-negative">
                {describeStop(actionErrorMessage(shown.error), {
                  untried: batch.untried,
                })}
              </p>
            )}
            <BatchOutcomeRows
              rows={live}
              attempted={shown.attempted}
              outcomes={shown.outcomes}
              unconfirmed={shown.unconfirmed}
              sending={sending}
            />
          </>
        ) : batch.rows === null ? (
          <div role="status" className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Checking {portalsOf(live.length)}…
            </p>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {describeBatchSummary(totalsOf(batch.rows.map((item) => item.entry)))}
            </p>
            <BatchReviewRows
              propertyId={propertyId}
              rows={batch.rows}
              leftOut={batch.leftOut}
              isLocked={isPublishing}
              onToggle={batch.toggle}
            />
          </>
        )}

        <DialogFooter>
          {shown !== null ? (
            <>
              {batch.retryable.length > 0 || isPublishing ? (
                <Button
                  type="button"
                  variant="outline"
                  pending={isPublishing}
                  pendingLabel="Publishing…"
                  onClick={() => void batch.retry()}
                >
                  {`Try ${batch.retryable.length === 1 ? 'it' : 'them'} again`}
                </Button>
              ) : null}
              <Button type="button" disabled={isPublishing} onClick={onClose}>
                Done
              </Button>
            </>
          ) : (
            <>
              <DialogCancel />
              <Button
                type="button"
                pending={isPublishing}
                pendingLabel="Publishing…"
                disabled={batch.publishable.length === 0}
                onClick={() => void batch.publish()}
              >
                {batch.publishable.length === 0
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
