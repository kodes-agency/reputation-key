// AI context — the two ways a review analysis can be run.
//
// `analyze-review-event.ts` is one skeleton: authorize, read the source, claim an
// operation, call the provider, store what came back, settle. The v2 and the v3
// analysis differ at six points of it, and a contract names them (contract
// section 2.2: the runtime catalogue's selection decides which one a build runs):
// the profile facts the binding and the authorization gate compare, whether the
// source read also returns the numbered sentences, what is prepared before the
// claim (v3: the vocabulary hints, the provider and the normalizer the operation
// is claimed under), what the provider request carries beyond the review, and how
// the provider's answer is accepted and stored.
//
// The use case knows none of that. It asks the contract it was given, and the
// default is v2 exactly as it ran before the contract existed. v3 is built only
// when the live runtime catalogue selects it (`selectedReviewAnalysisRuntime`),
// which no build does until activation.

import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { ReviewPropertyContext } from '#/shared/review-vocabulary-hints'
import type { VocabularyHintIdentity } from '#/shared/review-vocabulary-hints'
import type {
  AiReviewSentence,
  AiReviewSourcePort,
} from '#/contexts/review/application/public-api'
import type { AiOperationProfile } from '#/shared/ai-operation-profiles'
import type { AiMerchantAuthorizationSnapshot } from './ports/ai-authorization.port'
import type {
  AiOperationNormalizationLineage,
  AiOperationProviderLineage,
} from './ports/ai-operation-store.port'
import type { AiOperationId } from '../domain/types'

/** The review as the source read hands it to a contract: text, rating, sentences. */
export type ReviewAnalysisObservation = Extract<
  Awaited<ReturnType<AiReviewSourcePort['readForAi']>>,
  { status: 'available' }
>['observation']

/** What the binding, the authorization gate and the request deadline read of a profile. */
export type ReviewAnalysisOperationProfile = Readonly<{
  profileVersion: AiOperationProfile['profileVersion']
  capabilityRuntimeProfileVersion: string
  requestDeadlineMs: number
}>

/** The provider identity a v3 request names: the one its operation was claimed under. */
export type ReviewAnalysisRequestProvider = Readonly<{
  id: AiOperationProviderLineage['providerId']
  model: string
  requestProfileVersion: string
  requestProfileDigest: string
}>

/** What a contract prepares once the source is known and before the operation is claimed. */
export type ReviewAnalysisPreparation =
  | Readonly<{
      status: 'ready'
      /** Added to the operation claim; the lineage a v3 operation must record. */
      claim: Readonly<{
        vocabularyHints?: VocabularyHintIdentity
        providerLineage?: AiOperationProviderLineage
        normalization?: AiOperationNormalizationLineage
      }>
      /** Added to the provider request beside the review itself. */
      request: Readonly<{
        sentences?: readonly AiReviewSentence[]
        propertyContext?: ReviewPropertyContext
        provider?: ReviewAnalysisRequestProvider
      }>
    }>
  /** A transient or configuration refusal: the review waits for it within its horizon. */
  | Readonly<{ status: 'refused'; code: string }>

export type ReviewAnalysisPreparationInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  observation: ReviewAnalysisObservation
}>

/** What storing an accepted answer needs, all of it known to the use case. */
export type ReviewAnalysisAcceptanceInput = Readonly<{
  operationId: AiOperationId
  expectedAttempt: number
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  authorizationLineageId: string
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  observation: ReviewAnalysisObservation
  /** The gateway's answer, not yet validated by anyone. */
  result: unknown
  completedAtEpochMillis: number
  inputTokens: number
  outputTokens: number
  preparation: Extract<ReviewAnalysisPreparation, { status: 'ready' }>
}>

/**
 * `invalid`: the answer does not satisfy the contract, and the call has been
 * charged. `stale`: the review or its authorization moved while the provider
 * was answering, so nothing was stored. `stored`: the analysis is committed.
 */
export type ReviewAnalysisAcceptance = 'invalid' | 'stale' | 'stored'

export type ReviewAnalysisContract = Readonly<{
  contract: 'v2' | 'v3'
  operationProfile: ReviewAnalysisOperationProfile
  /** Whether a Property's authorization was recorded under the contract this one serves. */
  isServedContract(
    authorization: Pick<
      AiMerchantAuthorizationSnapshot,
      'noticeVersion' | 'noticeDigest' | 'providerDeploymentProfileVersion'
    >,
  ): boolean
  /** Spread into the source read: v3 also asks for the numbered sentences. */
  sourceRead: Readonly<{ sentences?: true }>
  prepare(input: ReviewAnalysisPreparationInput): Promise<ReviewAnalysisPreparation>
  accept(input: ReviewAnalysisAcceptanceInput): Promise<ReviewAnalysisAcceptance>
}>
