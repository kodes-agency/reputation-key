import type { Brand } from '#/shared/domain/brand'
import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'

/** Fixed retention horizon for Review Analysis derivatives. */
export const DERIVATIVE_RETENTION_MILLIS = 730 * 24 * 60 * 60 * 1_000

export type AiOperationId = Brand<string, 'AiOperationId'>
export type InternalAiSubjectId = Brand<string, 'InternalAiSubjectId'>
export type InternalActorId = UserId

export type AiProcessingCellResult =
  | Readonly<{
      status: 'available'
      processingRegion: 'global'
      providerDeploymentProfileVersion: 'private-beta-global-v1'
      routingPolicyVersion: 1
    }>
  | Readonly<{ status: 'policy_unavailable' }>

export type AiPropertyProcessingProfile = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  countryCode: string
  timezone: string
  processingRegion: 'global'
  routingPolicyVersion: number
  sourceEpoch: number
  profileVersion: number
  lifecycleState: 'active' | 'deleting'
}>

export type AiPropertyProfileResult =
  | Readonly<{ status: 'available'; profile: AiPropertyProcessingProfile }>
  | Readonly<{
      status:
        | 'not_found'
        | 'deleting'
        | 'source_epoch_changed'
        | 'property_profile_changed'
        | 'routing_policy_changed'
        | 'policy_unavailable'
    }>

export type AiCapabilityFence =
  | Readonly<{ capability: 'review_analysis'; reviewAnalysisEpoch: number }>
  | Readonly<{
      capability: 'reply_drafting'
      replyDraftingEpoch: number
      baseReplyStateRevision: number
    }>
  | Readonly<{
      capability: 'property_trends'
      reviewAnalysisEpoch: number
      propertyTrendsEpoch: number
    }>

export type AiExecutionStopFence = Readonly<{
  globalControlId: string
  globalGeneration: number
  providerControlId: string
  providerGeneration: number
  capabilityControlId: string
  capabilityGeneration: number
}>

/** Persisted BCP-47/`und` tag, distinct from the evaluated catalogue object. */
export type EvaluatedReviewLanguageTag = string
export type ConcreteReplyLanguage = Readonly<{
  tag: string
  templateGroup: string
}>

export type AiExecutionBinding = Readonly<{
  authorizationLineageId: string
  noticeVersion: string
  noticeDigest: string
  capabilityFence: AiCapabilityFence
  sourceEpoch: number
  evaluatedLanguage: EvaluatedReviewLanguageTag | null
  concreteReplyLanguage: ConcreteReplyLanguage | null
  languageCatalogueDigest: string | null
  replyLanguageVerifierDigest: string | null
  languageScriptConsistencyDigest: string | null
  zhOrthographyVerifierDigest: string | null
  sourceRevision: number | null
  reviewedAtEpochMillis: number | null
  propertyProfileVersion: number
  /** Absent only on operations created before grounded Brand Profile binding. */
  replyBrandProfileVersion?: number | null
  /** Absent only on operations created before grounded Brand Profile binding. */
  replyBrandDisplayNameDigest?: string | null
  routingPolicyVersion: number
  sourcePolicyId: string
  sourceCanonicalizerDigest: string
  redactionProfileVersion: string
  outputLeakageProfileVersion: string | null
  outputLeakageProfileDigest: string | null
  replyTemplateCatalogueVersion: string | null
  replyTemplateCatalogueDigest: string | null
  providerDeploymentProfileVersion: string
  operationProfileVersion: string
  capabilityRuntimeProfileVersion: string
  aiSubjectHmacKeyVersion: string | null
  stopFence: AiExecutionStopFence
}>

export type AiOperationBinding = AiExecutionBinding

export type AiOperationCommand = 'analysis' | 'reply' | 'trend'

export type AiOperationIdentity =
  | Readonly<{
      subjectKind: 'property'
      command: 'analysis'
      capability: 'review_analysis'
      organizationId: string
      propertyId: string
      actorId: null
      systemPrincipal: 'review_event_consumer'
      reviewId: string
      originEventId: string
      subjectHmac: string
      subjectHmacKeyVersion: string
      sourceEpoch: number
      sourceRevision: number
      reviewedAtEpochMillis: number
      analysisSequence: number
    }>
  | Readonly<{
      subjectKind: 'property'
      command: 'reply'
      capability: 'reply_drafting'
      organizationId: string
      propertyId: string
      actorId: string
      systemPrincipal: null
      reviewId: string
      sourceEpoch: number
      sourceRevision: number
      reviewedAtEpochMillis: number
      tone: 'professional' | 'friendly' | 'casual'
      baseReplyStateRevision: number
    }>
  | Readonly<{
      subjectKind: 'property'
      command: 'trend'
      capability: 'property_trends'
      organizationId: string
      propertyId: string
      actorId: null
      systemPrincipal: 'property_trend_coordinator'
      sourceEpoch: number
      dueLocalDate: string
      terminalAnalysisSequence: number
      aggregateRevision: number
    }>

export type ReviewAnalysisAspectV2 =
  | 'service'
  | 'staff'
  | 'quality'
  | 'value'
  | 'cleanliness'
  | 'wait_time'
  | 'atmosphere'
  | 'location'
  | 'accessibility'
  | 'other'
  | 'room'
  | 'food_and_drink'
  | 'noise'
  | 'wifi_and_tech'
  | 'check_in_out'
  | 'parking'
  | 'amenities'
  | 'events'

export type ReviewAnalysisCurrentnessV1 = Readonly<{
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  analysisProfileVersion: string
}>

/**
 * One mention of a v3 analysis: a topic, how the review feels about it, how
 * strongly, the cause (a thing and what is wrong with it, each up to three
 * lowercase words), the one-based numbers of the sentences that state it, and
 * whether it names a team member or someone else. Nothing here is review text;
 * a sentence is a number the live display resolves against the original.
 */
export type ReviewAnalysisMentionV3 = Readonly<{
  topic: ReviewAnalysisTopicV3
  polarity: 'positive' | 'neutral' | 'negative'
  strength: 'mild' | 'clear' | 'strong'
  thing: string | null
  issue: string | null
  sentences: readonly number[]
  namesPerson: 'team_member' | 'other' | null
}>

/** A manager's word on one mention, as the current-analysis read gives it back. */
export type ReviewAnalysisMentionCorrectionV3 =
  | Readonly<{ kind: 'remove_topic'; correctedAtEpochMillis: number }>
  | Readonly<{ kind: 'not_a_problem'; correctedAtEpochMillis: number }>
  | Readonly<{
      kind: 'change_cause'
      /** The cause the manager gave, in place of the answer's `thing` and `issue`. */
      thing: string | null
      issue: string | null
      correctedAtEpochMillis: number
    }>

/**
 * A mention as the current-analysis read gives it: the kept answer's, with the place it
 * has in the answer (the handle a correction names), the Property issue it belongs to
 * now (a changed cause's, or the answer's followed through a merge), and the manager's
 * correction if there is one. The answer's own fields are never changed by a correction.
 */
export type ReviewAnalysisMentionReadV3 = ReviewAnalysisMentionV3 &
  Readonly<{
    mentionOrdinal: number
    issueGroupId: string | null
    correction: ReviewAnalysisMentionCorrectionV3 | null
  }>

/**
 * The twelve topics of `review-topic-taxonomy-v3`. Spelled here because the
 * domain imports nothing but its own kernel; `review-analysis-runtime.test.ts`
 * proves this union and the taxonomy's are the same type.
 */
export type ReviewAnalysisTopicV3 =
  | 'staff_service'
  | 'speed_waiting'
  | 'booking_arrival'
  | 'main_service'
  | 'food_drink'
  | 'cleanliness'
  | 'facilities_equipment'
  | 'price_billing'
  | 'atmosphere_noise'
  | 'location_access'
  | 'safety'
  | 'communication'

export type ReviewAnalysisReadV1 =
  | Readonly<{ status: 'disabled' }>
  | Readonly<ReviewAnalysisCurrentnessV1 & { status: 'none' }>
  | Readonly<
      ReviewAnalysisCurrentnessV1 & {
        status: 'unavailable'
        reason: 'language_not_supported'
      }
    >
  | Readonly<
      ReviewAnalysisCurrentnessV1 & {
        status: 'ready'
        sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
        primaryCategory: ReviewAnalysisAspectV2
        aspects: readonly Readonly<{
          aspect: ReviewAnalysisAspectV2
          polarity: 'positive' | 'neutral' | 'negative'
          intensity: number
        }>[]
        issueLabel: string | null
        attention: 'urgent' | 'high' | 'medium' | 'low'
        generatedAtEpochMillis: number
      }
    >
  /**
   * A v3 analysis (contract section 3.1): topics with causes and evidence instead
   * of one primary category and aspects. It is a status of its own so that every
   * reader of the v2 shape keeps compiling until it learns the v3 one.
   */
  | Readonly<
      ReviewAnalysisCurrentnessV1 & {
        status: 'ready_v3'
        sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
        attention: 'urgent' | 'high' | 'medium' | 'low'
        urgentReason: 'safety' | 'health' | 'discrimination' | 'legal_threat' | null
        mentions: readonly ReviewAnalysisMentionReadV3[]
        generatedAtEpochMillis: number
      }
    >

export type AiPrivateBetaPolicy = Readonly<{
  version: 'ai-private-beta-policy-v1'
  region: 'global'
  manualPublicationRequired: true
  initialBundle: ReadonlyArray<string>
  capabilities: ReadonlyArray<
    Readonly<{
      id: string
      platformCapability: string
      permission: string
      actorKind: 'manager' | 'worker'
      routeId: string
      runtimeProfileVersion: string
      requires: ReadonlyArray<string>
    }>
  >
  roles: ReadonlyArray<
    Readonly<{
      id: string
      permissions: ReadonlyArray<string>
    }>
  >
  routes: ReadonlyArray<
    Readonly<{
      id: string
      sourceClassId: string
      outputClassId: string
      retentionPolicyId: string
    }>
  >
  sourceClasses: ReadonlyArray<
    Readonly<{
      id: string
      containsRawReviewContent: boolean
    }>
  >
  outputClasses: ReadonlyArray<
    Readonly<{
      id: string
      durable: boolean
    }>
  >
  retentionPolicies: ReadonlyArray<
    Readonly<{
      id: string
      duration: 'response_lifetime' | '24_months'
    }>
  >
  releaseGates: ReadonlyArray<
    Readonly<{
      id: string
      stage: 'candidate' | 'activation'
      owner: string
      contentClass: 'content_free'
    }>
  >
}>

export type AiCapability = MerchantAiCapability
export type AiOwnerScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  actorId?: UserId
}>
export type AiReviewIdentity = Readonly<{
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
}>
