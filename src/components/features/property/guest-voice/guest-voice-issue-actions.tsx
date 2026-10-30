import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { useGuestVoice } from './guest-voice-context'
import { issueReviewsSearch } from './guest-voice-links'
import { reviewsPhrase } from './guest-voice-words'

/** What can be done with an issue: read every review behind it, or say it is wrong. */
export function GuestVoiceIssueActions({
  issueId,
  reviewCount,
}: Readonly<{ issueId: string; reviewCount: number }>) {
  const { propertyId, startLocalDate, endLocalDate, onNotRight } = useGuestVoice()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm">
        <Link
          to="/inbox"
          search={issueReviewsSearch({
            propertyId,
            startLocalDate,
            endLocalDate,
            issueId,
          })}
        >
          {reviewCount === 1 ? 'See the review' : `See all ${reviewsPhrase(reviewCount)}`}
        </Link>
      </Button>
      {onNotRight === undefined ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onNotRight(issueId)}
        >
          Not right?
        </Button>
      )}
    </div>
  )
}
