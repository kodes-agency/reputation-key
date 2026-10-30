import type { AspectPolarityV1, AspectTaxonomyV1Id } from '#/shared/aspect-taxonomy'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ReviewTopicV3 } from '#/shared/review-topic-taxonomy'
import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

export type ReviewAttention = 'urgent' | 'high' | 'medium' | 'low'
export type ReviewAspect = AspectTaxonomyV1Id
export type ReviewAspectPolarity = AspectPolarityV1
export type ReviewAnalysisAspect = Readonly<{
  aspect: ReviewAspect
  polarity: ReviewAspectPolarity
  intensity: number
}>

/** A manager's word on one mention of a v3 analysis, as the pane shows it. */
export type InboxMentionCorrection =
  | Readonly<{ kind: 'remove_topic'; correctedAtEpochMillis: number }>
  | Readonly<{ kind: 'not_a_problem'; correctedAtEpochMillis: number }>
  | Readonly<{
      kind: 'change_cause'
      /** The cause the manager gave, in place of the answer's. */
      thing: string | null
      issue: string | null
      correctedAtEpochMillis: number
    }>

/**
 * One thing the AI found in a review (v3): a topic, which way the review feels about
 * it, how strongly, the cause as a thing and what was wrong with it, and the numbers of
 * the sentences that say it. The words are the AI's, and a correction sits beside them.
 */
export type InboxMentionV3 = Readonly<{
  /** Its place in the answer: the handle a correction names. */
  mentionOrdinal: number
  topic: ReviewTopicV3
  polarity: ReviewAspectPolarity
  strength: 'mild' | 'clear' | 'strong'
  thing: string | null
  issue: string | null
  /** The Property issue it belongs to now (followed through a merge, or a changed cause's). */
  issueGroupId: string | null
  /** One-based, by `review-sentences-v1`: resolved against the review's own words, never stored. */
  sentenceNumbers: readonly number[]
  namesPerson: 'team_member' | 'other' | null
  correction: InboxMentionCorrection | null
}>

export type InboxReviewAnalysis =
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'unavailable'; reason: 'language_not_supported' }>
  | Readonly<{
      status: 'ready'
      sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
      aspects: readonly ReviewAnalysisAspect[]
      primaryCategory: ReviewAspect
      attention: ReviewAttention
      issueLabel?: string
      generatedAtEpochMillis: number
    }>
  | Readonly<{
      status: 'ready_v3'
      /** Which reading of the review this is: a correction names the one it was made on. */
      analysisSequence: number
      sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
      attention: ReviewAttention
      urgentReason: 'safety' | 'health' | 'discrimination' | 'legal_threat' | null
      mentions: readonly InboxMentionV3[]
      generatedAtEpochMillis: number
    }>

export type AiReviewInsightsPort = Readonly<{
  readCurrentReviewAnalysis(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      /** The reader of the item; the AI context authorizes it again itself. */
      actor: AuthContext
    }>,
  ): Promise<InboxReviewAnalysis>
  findCurrentReviewIdsByAttention(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds?: readonly PropertyId[]
      /** Optional page-bounded review set used for list-row enrichment. */
      reviewIds?: readonly ReviewId[]
      attention: readonly ReviewAttention[]
    }>,
  ): Promise<readonly ReviewId[]>
  /**
   * Review ids whose current analysis names one Property issue, with a manager's
   * corrections laid over it. `polarities`, when given, constrain the same mention.
   */
  findCurrentReviewIdsByIssue(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds?: readonly PropertyId[]
      issueId: string
      polarities?: readonly ReviewAspectPolarity[]
    }>,
  ): Promise<readonly ReviewId[]>
  /** Review ids whose current analysis contains a matching aspect mention.
   * When both arrays are supplied, a single mention must satisfy both. */
  findCurrentReviewIdsByAspect(
    input: Readonly<{
      organizationId: OrganizationId
      propertyIds?: readonly PropertyId[]
      aspects?: readonly ReviewAspect[]
      polarities?: readonly ReviewAspectPolarity[]
    }>,
  ): Promise<readonly ReviewId[]>
}>
