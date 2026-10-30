import type { ReactNode } from 'react'
import { usePermissions } from '#/shared/hooks/usePermissions'
import { ReviewCorrectionDialog } from './review-correction-dialog'
import type {
  InboxItem,
  InboxReviewAnalysis,
} from '#/contexts/inbox/application/public-api'
import type { InboxServerFns } from './types'

/**
 * The way into "Not right?" for the review on screen, where it is offered: a review whose
 * reading names something, to a person who may act on the Inbox as a manager (the same
 * pair of permissions as the Priority control; the server asks for the write one again and
 * the AI context checks the Property), where the Inbox was given the means.
 */
export function ReviewCorrectionControl({
  item,
  analysis,
  correct,
}: Readonly<{
  item: InboxItem
  analysis: InboxReviewAnalysis | null
  correct: InboxServerFns['correctReviewMention']
}>): ReactNode {
  const { can } = usePermissions()
  if (correct === undefined || item.sourceType !== 'review') return null
  if (analysis?.status !== 'ready_v3' || analysis.mentions.length === 0) return null
  if (!can('inbox.write') || !can('inbox.manage')) return null
  return (
    <ReviewCorrectionDialog
      analysis={analysis}
      correct={correct}
      target={{
        inboxItemId: item.id,
        propertyId: item.propertyId,
        reviewId: item.sourceId,
        analysisSequence: analysis.analysisSequence,
      }}
    />
  )
}
