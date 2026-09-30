// Rating & Google: the rating card and the Google review action are part of
// every portal, so this section explains them and shows where Google stands; it
// has nothing to switch. The content review lives here too: it attests that the
// saved page's destinations open the intended review pages.

import { PortalEditorSectionFrame } from '../portal-editor-section-frame'
import { ContentReviewCard } from '../../portal-settings/content-review-card'
import { GoogleReviewDestinationCard } from '../../portal-settings/google-review-destination-card'
import type { PortalEditorSectionProps } from '../portal-editor-types'

export function RatingSection({ resources, canEdit }: PortalEditorSectionProps) {
  return (
    <PortalEditorSectionFrame
      section="rating"
      description="Guests rate first, then are offered a Google review. Both are part of every portal and cannot be turned off."
    >
      <GoogleReviewDestinationCard destination={resources.googleReviewDestination} />
      <ContentReviewCard
        portal={resources.portal}
        mutation={resources.completeReviewMutation}
        disabled={!canEdit}
      />
    </PortalEditorSectionFrame>
  )
}
