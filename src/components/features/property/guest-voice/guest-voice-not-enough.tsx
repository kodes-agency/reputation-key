import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import { InlineLink } from '#/components/ui/inline-link'
import type { GuestVoiceV2NotEnough } from '#/contexts/ai/application/public-api'
import { GuestVoiceNothingHere, GuestVoiceSection } from './guest-voice-section'
import { reviewDay, reviewsPhrase } from './guest-voice-words'

/**
 * The page of a property with under about 10 reviews with text in the year: there are
 * no patterns to spot, and the page says so instead of drawing rankings out of two
 * reviews. What it has to show is the latest reviews, and the way to the Inbox.
 */
export function GuestVoiceNotEnough({
  read,
  propertyId,
}: Readonly<{ read: GuestVoiceV2NotEnough; propertyId: string }>) {
  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Alert variant="info">
        <AlertTitle>Not enough reviews yet to spot patterns</AlertTitle>
        <AlertDescription>
          <p>
            Guest voice looks for problems and strengths that several guests mention, so
            it needs about 10 reviews with text in 12 months. This property has{' '}
            {read.textReviewCount === 0
              ? 'none'
              : `${reviewsPhrase(read.textReviewCount)}`}
            . Until then, here are the latest reviews.
          </p>
        </AlertDescription>
      </Alert>
      <GuestVoiceSection title="Latest reviews">
        {read.latestReviews.length === 0 ? (
          <GuestVoiceNothingHere>No reviews have come in yet.</GuestVoiceNothingHere>
        ) : (
          <ul className="flex flex-col gap-3">
            {read.latestReviews.map((review) => (
              <li
                key={review.inboxItemId}
                className="flex flex-col gap-1.5 rounded-xl border bg-card p-4"
              >
                <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                  <span>
                    <span aria-hidden="true">{review.rating}★</span>
                    <span className="sr-only">{review.rating} stars</span>
                  </span>
                  <span>{reviewDay(review.reviewedAt)}</span>
                </p>
                {review.text === null ? null : (
                  <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">
                    {review.text}
                  </p>
                )}
                <InlineLink
                  to="/inbox"
                  search={{ propertyId, itemId: review.inboxItemId }}
                  className="inline-flex min-h-11 w-fit items-center md:min-h-0"
                >
                  Open in the inbox
                </InlineLink>
              </li>
            ))}
          </ul>
        )}
      </GuestVoiceSection>
    </div>
  )
}
