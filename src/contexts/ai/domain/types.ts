import type { Brand } from '#/shared/domain/brand'
import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'

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

export type ReviewAnalysisCurrentnessV1 = Readonly<{
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
  analysisProfileVersion: string
}>

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
        primaryCategory:
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
        attention: 'urgent' | 'high' | 'medium' | 'low'
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
