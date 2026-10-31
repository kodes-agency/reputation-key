import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Popover, PopoverContent } from '#/components/ui/popover'
import { ExplainTrigger } from '#/components/ui/explain-trigger'
import { InlineLink } from '#/components/ui/inline-link'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type { GuestVoiceMatchingReviewScope } from '#/contexts/ai/application/public-api'
import { useGuestVoice } from './guest-voice-context'
import { reviewsPhrase } from './guest-voice-words'
import { issueReviewsSearch, urgentReviewsSearch } from './guest-voice-links'

export function GuestVoiceIssueActions({
  scope,
  reviewCount,
}: Readonly<{ scope: GuestVoiceMatchingReviewScope; reviewCount: number }>) {
  const { propertyId } = useGuestVoice()
  const { can } = usePermissions()
  if (!can('inbox.read')) return null
  const search =
    scope.issueId === null
      ? {
          ...urgentReviewsSearch(propertyId),
          since: scope.startLocalDate,
          until: scope.endLocalDate,
        }
      : issueReviewsSearch({
          propertyId,
          ...scope,
          issueId: scope.issueId,
          sense: scope.sense ?? 'complaint',
        })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size="sm" className="flex-1 whitespace-normal">
        <Link
          to="/inbox"
          search={search}
          aria-label={`Open these reviews in the Inbox · ${reviewsPhrase(reviewCount)} counted here`}
        >
          Open these reviews in the Inbox
        </Link>
      </Button>
      <Popover>
        <ExplainTrigger asChild>
          <Button type="button" variant="ghost" size="sm">
            Not right?
          </Button>
        </ExplainTrigger>
        <PopoverContent>
          <p className="text-sm">
            Choose a review in the Inbox, then correct its reading.{' '}
            <InlineLink underline="always" to="/inbox" search={search}>
              Open the Inbox
            </InlineLink>
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
