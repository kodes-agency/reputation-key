// Rating & Google: the Google action and the Portal's usual private rating
// journey. A Portal may skip the rating in Private note. This section
// has nothing to switch. The link check lives here too: the manager records
// that the live page's Google link and Linktree links open the pages they
// should.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { ContentReviewCard } from '../../portal-settings/content-review-card'
import { GoogleReviewDestinationCard } from '../../portal-settings/google-review-destination-card'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function RatingSection({ resources, canEdit }: PortalEditorSectionProps) {
  return (
    <PortalEditorSectionFrame
      section="rating"
      description={
        resources.portal.skipPrivateRating
          ? 'Guests go straight to the Google button. If Google is unavailable, guests can leave a private rating.'
          : 'Guests rate first, then are offered a Google review. To skip the private rating, use the Private note section.'
      }
    >
      <GoogleReviewDestinationCard destination={resources.googleReviewDestination} />
      <ContentReviewCard
        portal={resources.portal}
        mutation={resources.completeReviewMutation}
        disabled={!canEdit}
        liveVersion={resources.publicationHistory.current?.version ?? null}
        hasPendingChanges={resources.publicationHistory.hasPendingChanges}
      />
    </PortalEditorSectionFrame>
  )
}
