// Composition — what the Inbox is told of a review's v3 reading.
//
// The AI context answers a current-analysis read in its own vocabulary and the Inbox
// holds a port of its own (`AiReviewInsightsPort`), so the root is where one is turned
// into the other. A v3 reading keeps every field the Inbox draws: the causes it names, the
// numbers of the sentences that state them (the Inbox cuts the guest's words with the same
// rule and underlines those), the issue each belongs to now, and a manager's correction
// laid beside it. Nothing here is the guest's text.
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
