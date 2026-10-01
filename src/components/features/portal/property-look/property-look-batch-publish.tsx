// The status bar's action on the Property look page (board 9): "Review & publish
// N portals", N being the live portals the look reaches. It opens the batch
// dialog. It is absent when the viewer may not publish or no portal is live,
// and unavailable while an edit is still being saved, so the review never reads
// a draft that is about to change.
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import { PropertyLookBatchDialog } from './property-look-batch-dialog'
import type { AffectedPortalRow } from './property-look-rules'
import type { PortalReviewReader, PublishPortalsAction } from './use-property-look-batch'

type Props = Readonly<{
  propertyId: string
  /** The live portals the look reaches. */
  live: readonly AffectedPortalRow[]
  /** The viewer holds `portal.update` and Portals writes are switched on. */
  canPublish: boolean
  /** An edit is waiting, in flight or refused: what would be reviewed is not settled. */
  isSettling: boolean
  getPortalReview: PortalReviewReader
  publishPortals: PublishPortalsAction
}>

export function PropertyLookBatchPublish({
  propertyId,
  live,
  canPublish,
  isSettling,
  getPortalReview,
  publishPortals,
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  if (!canPublish || live.length === 0) return null
  return (
    <>
      <Button type="button" disabled={isSettling} onClick={() => setIsOpen(true)}>
        Review &amp; publish {live.length === 1 ? '1 portal' : `${live.length} portals`}
      </Button>
      {isOpen ? (
        <PropertyLookBatchDialog
          propertyId={propertyId}
          live={live}
          getPortalReview={getPortalReview}
          publishPortals={publishPortals}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}
