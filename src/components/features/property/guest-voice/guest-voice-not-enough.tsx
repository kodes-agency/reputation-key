import { TouchInlineLink as InlineLink } from '#/components/ui/inline-touch-link'
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
    <div className="flex flex-col gap-4">
      <GuestVoiceSection
        title="What are guests saying?"
        icon="reviews"
        answer="Not enough reviews to spot patterns yet"
        hint={`Guest voice needs about 10 reviews with text in 12 months. This property has ${reviewsPhrase(read.textReviewCount)}. Here are your latest reviews.`}
      >
        {!read.latestReviews.length ? (
          <p className="py-2 text-sm text-muted-foreground">
            No reviews have come in during this period.
          </p>
        ) : (
          <ul className="divide-y">
            {read.latestReviews.slice(0, 3).map((review) => (
              <li key={review.inboxItemId} className="py-3">
                <p className="text-sm text-muted-foreground">
                  <span aria-hidden="true" className="text-warn">
                    {'★'.repeat(review.rating)}
                    {'☆'.repeat(5 - review.rating)}
                  </span>
                  <span className="sr-only">{review.rating} stars</span> ·{' '}
                  {reviewDay(review.reviewedAt)}
                </p>
                {review.text === null ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    The words of this review aren’t available here.
                  </p>
                ) : review.text.length <= 140 ? (
                  <p className="py-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
                    {review.text}
                  </p>
                ) : (
                  <GuestVoiceDisclosure label={`${review.text.slice(0, 140)}…`}>
                    <p className="py-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
                      {review.text}
                    </p>
                  </GuestVoiceDisclosure>
                )}
              </li>
            ))}
          </ul>
        )}
        {can('inbox.read') ? (
          <InlineLink
            underline="always"
            to="/inbox"
            search={{
              propertyId,
              since: read.context.startLocalDate,
              until: read.context.endLocalDate,
            }}
          >
            See all {reviewsPhrase(read.allReviewCount)}
          </InlineLink>
        ) : null}
      </GuestVoiceSection>
      {can('portal.read') && has('portal.read') ? (
        <div className="rounded-xl border bg-muted/30 px-4 py-3 text-sm">
          <p>
            Invite more guests to review to see what’s working and what needs attention.
          </p>
          <InlineLink
            underline="always"
            to="/properties/$propertyId/portals"
            params={{ propertyId }}
          >
            Invite guests to review
          </InlineLink>
        </div>
      ) : null}
    </div>
  )
}
