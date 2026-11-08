import type { AiReviewInsightsPort } from '#/contexts/inbox/application/ports/ai-review-insights.port'
import type { ReviewContextApi } from '#/contexts/review/build'
import type { buildAiContext } from '#/contexts/ai/build'
import type {
  InboxMentionV3,
  InboxReviewAnalysis,
} from '#/contexts/inbox/application/public-api'

type ReadyV3Read = Readonly<{
  analysisSequence: number
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
  attention: 'urgent' | 'high' | 'medium' | 'low'
  urgentReason: 'safety' | 'health' | 'discrimination' | 'legal_threat' | null
  generatedAtEpochMillis: number
  mentions: readonly Readonly<{
    mentionOrdinal: number
    topic: InboxMentionV3['topic']
    polarity: InboxMentionV3['polarity']
    strength: InboxMentionV3['strength']
    thing: string | null
    issue: string | null
    issueGroupId: string | null
    /** One-based, by `review-sentences-v1`. */
    sentences: readonly number[]
    namesPerson: InboxMentionV3['namesPerson']
    correction: InboxMentionV3['correction']
  }>[]
}>

export function inboxReadyV3Of(
  analysis: ReadyV3Read,
): Extract<InboxReviewAnalysis, { status: 'ready_v3' }> {
  return {
    status: 'ready_v3',
    analysisSequence: analysis.analysisSequence,
    sentiment: analysis.sentiment,
    attention: analysis.attention,
    urgentReason: analysis.urgentReason,
    generatedAtEpochMillis: analysis.generatedAtEpochMillis,
    mentions: analysis.mentions.map((mention) => ({
      mentionOrdinal: mention.mentionOrdinal,
      topic: mention.topic,
      polarity: mention.polarity,
      strength: mention.strength,
      thing: mention.thing,
      issue: mention.issue,
      issueGroupId: mention.issueGroupId,
      sentenceNumbers: mention.sentences,
      namesPerson: mention.namesPerson,
      correction: mention.correction,
    })),
  }
}

/** Resolve the current Review fence before asking AI's authorized delivery read. */
export function createInboxReviewAnalysisReader(
  sources: Pick<ReviewContextApi['publicApi']['aiReviewSource'], 'readCurrentSource'> &
    Pick<ReturnType<typeof buildAiContext>['publicApi'], 'readReviewAnalysis'>,
): AiReviewInsightsPort['readCurrentReviewAnalysis'] {
  return async (request) => {
    const current = await sources.readCurrentSource({
      organizationId: request.organizationId,
      reviewId: request.reviewId,
    })
    if (
      current.status === 'not_found' ||
      current.source.propertyId !== request.propertyId
    ) {
      return { status: 'none' } as const
    }
    const analysis = await sources.readReviewAnalysis({
      ...request,
      sourceEpoch: current.source.sourceEpoch,
      sourceRevision: current.source.sourceRevision,
      analysisSequence: current.source.analysisSequence,
    })
    if (analysis.status === 'ready_v3') return inboxReadyV3Of(analysis)
    if (analysis.status !== 'ready') return analysis
    return {
      status: 'ready',
      sentiment: analysis.sentiment,
      aspects: analysis.aspects,
      primaryCategory: analysis.primaryCategory,
      attention: analysis.attention,
      ...(analysis.issueLabel === null ? {} : { issueLabel: analysis.issueLabel }),
      generatedAtEpochMillis: analysis.generatedAtEpochMillis,
    }
  }
}
