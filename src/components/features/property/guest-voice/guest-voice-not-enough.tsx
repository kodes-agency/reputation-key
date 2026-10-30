import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { InlineLink } from '#/components/ui/inline-link'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { useCapabilities } from '#/shared/hooks/useCapabilities'
import type { GuestVoiceV2NotEnough } from '#/contexts/ai/application/public-api'
import { GuestVoiceSection } from './guest-voice-section'
import { GuestVoiceDisclosure } from './guest-voice-disclosure'
import { reviewDay, reviewsPhrase } from './guest-voice-words'

export function GuestVoiceNotEnough({
  read,
  propertyId,
}: Readonly<{ read: GuestVoiceV2NotEnough; propertyId: string }>) {
  const { can } = usePermissions()
  const { has } = useCapabilities()
  return (
    <div className="flex flex-col gap-5">
      <Alert variant="info">
        <AlertTitle>Not enough reviews to spot patterns yet</AlertTitle>
        <AlertDescription>
          Guest voice needs about 10 reviews with text in 12 months. This property has{' '}
          {read.textReviewCount ? reviewsPhrase(read.textReviewCount) : 'none'}. Until
          then, here are your latest reviews in this period.
        </AlertDescription>
      </Alert>
      <GuestVoiceSection title="Your latest reviews">
        {!read.latestReviews.length ? (
          <p className="text-sm text-muted-foreground">
            No reviews have come in during this period.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card px-4">
            {read.latestReviews.slice(0, 3).map((review) => (
              <li key={review.inboxItemId} className="py-3">
                <p className="text-sm text-muted-foreground">
                  <span aria-label={`${review.rating} stars`}>{review.rating}★</span> ·{' '}
                  {reviewDay(review.reviewedAt)}
                </p>
                {review.text === null ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    The words of this review aren’t available here.
                  </p>
                ) : (
                  <GuestVoiceDisclosure
                    label={
                      review.text.length > 140
                        ? `${review.text.slice(0, 140)}…`
                        : review.text
                    }
                  >
                    <p className="py-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
                      {review.text}
                    </p>
                  </GuestVoiceDisclosure>
                )}
                {can('inbox.read') ? (
                  <InlineLink
                    to="/inbox"
                    search={{ propertyId, itemId: review.inboxItemId }}
                  >
                    Open in the inbox
                  </InlineLink>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </GuestVoiceSection>
      <div className="flex flex-wrap gap-4 text-sm">
        {can('inbox.read') ? (
          <InlineLink
            to="/inbox"
            search={{
              propertyId,
              since: read.context.startLocalDate,
              until: read.context.endLocalDate,
            }}
          >
            Open this period’s reviews in the inbox
          </InlineLink>
        ) : null}
        {can('portal.read') && has('portal.read') ? (
          <InlineLink to="/properties/$propertyId/portals" params={{ propertyId }}>
            Invite guests to review
          </InlineLink>
        ) : null}
      </div>
    </div>
  )
}
