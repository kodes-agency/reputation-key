// The link check: the manager entry point for the governed
// `portal.content_review.completed`, `portal.configuration_completeness` and
// `portal.approved_destination_ratio` facts. The server records them against
// the published page, so the card names that page (the live version) and says
// that changes still waiting to go live are not covered. It is not called a
// "review": Review & publish and the Google review already use the word.
//
// The facts record no author, so the card cannot show when or by whom the last
// check was made; it confirms only the check made here.

import { useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { ContentReviewAttestation } from './content-review-attestation'
import { liveVersionName, reviewStatusMessage } from './content-review-status'
import type {
  CompleteReviewResult,
  CompleteReviewVariables,
  PortalData,
} from '../shared/types'

type Props = Readonly<{
  portal: PortalData
  mutation: Action<CompleteReviewVariables, CompleteReviewResult>
  disabled: boolean
  /** The version guests open; null when no version can be read. */
  liveVersion: number | null
  /** Saved changes are waiting to go live: they are not what the check covers. */
  hasPendingChanges: boolean
}>

export function ContentReviewCard({
  portal,
  mutation,
  disabled,
  liveVersion,
  hasPendingChanges,
}: Props) {
  // The fact asserts a human act, so the manager has to make the assertion
  // before the button will send it. Held here rather than in the attestation
  // branch so an unpublish/republish round trip does not silently clear it.
  const [attested, setAttested] = useState(false)
  // The use case rejects completion for anything but published content
  // (complete-content-review.ts: invalid_publication_transition).
  const isPublished = portal.publicationState === 'published'
  const live = liveVersionName(liveVersion)

  return (
    <div className="space-y-3 rounded-md border px-4 py-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Link check</h3>
        <p className="text-xs text-muted-foreground">
          Open the {live} and check that the Google link and every Linktree link open the
          page they should, then record the check here.
        </p>
      </div>

      {isPublished ? (
        <>
          {hasPendingChanges ? (
            <p className="text-xs text-muted-foreground">
              Changes waiting to go live are not covered: the check is of the {live}.
            </p>
          ) : null}
          <ContentReviewAttestation
            portalId={portal.id}
            mutation={mutation}
            disabled={disabled}
            attested={attested}
            onAttestedChange={setAttested}
            live={live}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Publish this portal first: the check is of the page guests can open.
        </p>
      )}

      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {reviewStatusMessage(mutation.isPending, mutation.data)}
      </p>
    </div>
  )
}
