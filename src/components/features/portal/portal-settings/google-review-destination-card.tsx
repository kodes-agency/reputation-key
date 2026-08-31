import { Badge } from '#/components/ui/badge'
import {
  presentGoogleReviewDestination,
  type GoogleReviewDestinationStatus,
} from './google-review-destination-status'

export function GoogleReviewDestinationCard({
  destination,
}: Readonly<{ destination: GoogleReviewDestinationStatus }>) {
  const presentation = presentGoogleReviewDestination(destination)

  return (
    <div
      className="rounded-md border px-4 py-3"
      aria-labelledby="google-destination-title"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="google-destination-title" className="text-sm font-medium">
          Google review destination
        </h3>
        <Badge variant={presentation.badgeVariant}>{presentation.label}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {presentation.description} No separate link needs to be entered for this portal.
      </p>
      {presentation.confirmedAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          Last confirmed {presentation.confirmedAt}
        </p>
      )}
    </div>
  )
}
