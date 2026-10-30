import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  GuestVoiceIssueGroup,
  GuestVoiceReview,
} from '../read-models/guest-voice-v2-facts'
import type { AiPropertyAggregateCoverage } from './ai-property-aggregate-store.port'

/**
 * The Property and the fences a Guest voice 2.0 read is made under: the same four the
 * v2 insights read passes the aggregate store, so a Property whose authorization, source
 * or processing profile has moved reads nothing of what came before.
 */
export type GuestVoiceFactsScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
}>

export type GuestVoiceFactsPeriod = Readonly<{
  startLocalDate: string
  endLocalDate: string
}>

/** A review the analysis could not read (its language), by the key Review counts it under. */
export type GuestVoiceUnavailableReview = Readonly<{
  reviewId: string
  sourceRevision: number
  analysisSequence: number
  localDate: string
}>

export type GuestVoiceFactsRead = Readonly<{
  /** How far the analysis is: reviews owed and reviews settled. */
  coverage: AiPropertyAggregateCoverage
  /** Reviews with a current, ready v3 analysis in the period, with their mentions. */
  reviews: readonly GuestVoiceReview[]
  unavailable: readonly GuestVoiceUnavailableReview[]
  /** The Property's issues, with a manager's names and hiding. */
  groups: readonly GuestVoiceIssueGroup[]
}>

/** One mention whose cited sentences are wanted. */
export type GuestVoiceMentionRef = Readonly<{
  reviewId: string
  sourceRevision: number
  analysisSequence: number
  mentionOrdinal: number
}>

export function mentionRefKey(
  ref: Pick<GuestVoiceMentionRef, 'reviewId' | 'mentionOrdinal'>,
): string {
  return `${ref.reviewId}:${ref.mentionOrdinal}`
}

/**
 * What the Guest voice 2.0 read needs of the AI store. Content-free: ids, days, stars
 * and the analysis's mentions, never a sentence.
 */
export type AiGuestVoiceFactsPort = Readonly<{
  /** Whether the Property has any current v3 analysis under these fences. */
  hasV3Analyses(scope: GuestVoiceFactsScope): Promise<boolean>
  /**
   * The reviews of the period with a current v3 analysis, as one consistent read of
   * the Property's aggregate. Null when the Property has no aggregate to read yet.
   */
  readFacts(
    scope: GuestVoiceFactsScope,
    period: GuestVoiceFactsPeriod,
  ): Promise<GuestVoiceFactsRead | null>
  /** The sentence numbers each mention cites, keyed by `mentionRefKey`. */
  readMentionSentences(
    scope: GuestVoiceFactsScope,
    refs: readonly GuestVoiceMentionRef[],
  ): Promise<ReadonlyMap<string, readonly number[]>>
}>
