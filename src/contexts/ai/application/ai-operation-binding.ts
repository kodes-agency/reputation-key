// AI context — the identity and execution binding an AI operation is claimed
// and fenced on. Both feed the RFC 8785 request fingerprint that makes a claim
// idempotent (ai-workflow-support.ts), so a changed field, key or null is a
// different operation. Pure: every value arrives from the calling use case.

import type { OrganizationId, PropertyId, ReviewId, UserId } from '#/shared/domain/ids'
import {
  AI_SOURCE_CANONICALIZER_PROFILE_V1,
  type AiOperationProfile,
} from '#/shared/ai-operation-profiles'
import {
  LANGUAGE_CATALOGUE_DIGEST,
  type ConcreteReplyLanguage,
} from '#/shared/ai-review-language-catalogue'
import { AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST } from '#/shared/ai-language-script-consistency'
import { AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST } from '#/shared/ai-reply-language-verifier'
import {
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
  AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
} from '#/shared/ai-reply-output-leakage'
import {
  AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
  AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
  type ReplyTone,
} from '#/shared/ai-reply-template-catalogue'
import { AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST } from '#/shared/ai-zh-orthography-verifier'
import type { AiAuthorizationPort } from './ports/ai-authorization.port'
import type {
  AiExecutionBinding,
  AiExecutionStopFence,
  AiOperationIdentity,
  AiPropertyProcessingProfile,
} from '../domain/types'

type MerchantAuthorization = NonNullable<
  Awaited<ReturnType<AiAuthorizationPort['readMerchantAuthorization']>>
>

/** The authorization facts every binding pins, besides its proven lineage. */
type BindingAuthorization = Pick<
  MerchantAuthorization,
  | 'noticeVersion'
  | 'noticeDigest'
  | 'redactionProfileFamily'
  | 'providerDeploymentProfileVersion'
>

type BindingOperationProfile = Pick<
  AiOperationProfile,
  'profileVersion' | 'capabilityRuntimeProfileVersion'
>

/** What a manager's reply-draft request names. */
type ReplyOperationRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  actorUserId: UserId
  tone: ReplyTone
  expectedSourceEpoch: number
  expectedSourceRevision: number
}>

/** What a review-analysis event names. */
type AnalysisOperationRequest = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  eventEnvelopeId: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
}>

/** The operation a reply-draft request claims. */
export function replyOperationIdentity(
  input: ReplyOperationRequest,
  reviewedAtEpochMillis: number,
  baseReplyStateRevision: number,
): AiOperationIdentity {
  return {
    subjectKind: 'property',
    command: 'reply',
    capability: 'reply_drafting',
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    actorId: input.actorUserId,
    systemPrincipal: null,
    reviewId: input.reviewId,
    sourceEpoch: input.expectedSourceEpoch,
    sourceRevision: input.expectedSourceRevision,
    tone: input.tone,
    reviewedAtEpochMillis,
    baseReplyStateRevision,
  }
}

/** Every fence a reply draft's provider call is bound to. */
export function replyExecutionBinding(
  facts: Readonly<{
    input: ReplyOperationRequest
    authorization: BindingAuthorization
    authorizationLineageId: string
    operationProfile: BindingOperationProfile
    evaluatedLanguage: AiExecutionBinding['evaluatedLanguage']
    concreteReplyLanguage: ConcreteReplyLanguage
    reviewedAtEpochMillis: number
    profile: AiPropertyProcessingProfile
    brandProfile: Readonly<{ version: number; displayNameDigest: string }>
    replyDraftingEpoch: number
    baseReplyStateRevision: number
    stopFence: AiExecutionStopFence
  }>,
): AiExecutionBinding {
  const { input, authorization, profile, brandProfile } = facts
  return {
    authorizationLineageId: facts.authorizationLineageId,
    noticeVersion: authorization.noticeVersion,
    noticeDigest: authorization.noticeDigest,
    capabilityFence: {
      capability: 'reply_drafting',
      replyDraftingEpoch: facts.replyDraftingEpoch,
      baseReplyStateRevision: facts.baseReplyStateRevision,
    },
    sourceEpoch: input.expectedSourceEpoch,
    evaluatedLanguage: facts.evaluatedLanguage,
    concreteReplyLanguage: facts.concreteReplyLanguage,
    languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
    replyLanguageVerifierDigest: AI_REPLY_LANGUAGE_VERIFIER_PROFILE_DIGEST,
    languageScriptConsistencyDigest: AI_LANGUAGE_SCRIPT_CONSISTENCY_PROFILE_DIGEST,
    zhOrthographyVerifierDigest: AI_ZH_ORTHOGRAPHY_PROFILE_DIGEST,
    sourceRevision: input.expectedSourceRevision,
    reviewedAtEpochMillis: facts.reviewedAtEpochMillis,
    propertyProfileVersion: profile.profileVersion,
    replyBrandProfileVersion: brandProfile.version,
    replyBrandDisplayNameDigest: brandProfile.displayNameDigest,
    routingPolicyVersion: profile.routingPolicyVersion,
    sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
    sourceCanonicalizerDigest:
      AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
    redactionProfileVersion: authorization.redactionProfileFamily,
    outputLeakageProfileVersion: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_VERSION,
    outputLeakageProfileDigest: AI_REPLY_OUTPUT_LEAKAGE_PROFILE_DIGEST,
    replyTemplateCatalogueVersion: AI_REPLY_TEMPLATE_CATALOGUE_VERSION,
    replyTemplateCatalogueDigest: AI_REPLY_TEMPLATE_CATALOGUE_DIGEST,
    providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
    operationProfileVersion: facts.operationProfile.profileVersion,
    capabilityRuntimeProfileVersion:
      facts.operationProfile.capabilityRuntimeProfileVersion!,
    aiSubjectHmacKeyVersion: null,
    stopFence: facts.stopFence,
  }
}

/** The operation a review-analysis event claims. */
export function analysisOperationIdentity(
  input: AnalysisOperationRequest,
  subject: Readonly<{ digest: string; keyVersion: string }>,
  reviewedAtEpochMillis: number,
): AiOperationIdentity {
  return {
    subjectKind: 'property',
    command: 'analysis',
    capability: 'review_analysis',
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    actorId: null,
    systemPrincipal: 'review_event_consumer',
    reviewId: input.reviewId,
    originEventId: input.eventEnvelopeId,
    subjectHmac: subject.digest,
    subjectHmacKeyVersion: subject.keyVersion,
    sourceEpoch: input.sourceEpoch,
    sourceRevision: input.sourceRevision,
    reviewedAtEpochMillis,
    analysisSequence: input.analysisSequence,
  }
}

/**
 * Every fence a review analysis's provider call is bound to. The reply-only
 * fences stay null and the Brand Profile fences are absent.
 */
export function analysisExecutionBinding(
  facts: Readonly<{
    input: AnalysisOperationRequest
    authorization: BindingAuthorization
    authorizationLineageId: string
    operationProfile: BindingOperationProfile
    reviewAnalysisEpoch: number
    evaluatedLanguage: AiExecutionBinding['evaluatedLanguage']
    reviewedAtEpochMillis: number
    profile: AiPropertyProcessingProfile
    subjectHmacKeyVersion: string
    stopFence: AiExecutionStopFence
  }>,
): AiExecutionBinding {
  const { input, authorization, profile } = facts
  return {
    authorizationLineageId: facts.authorizationLineageId,
    noticeVersion: authorization.noticeVersion,
    noticeDigest: authorization.noticeDigest,
    capabilityFence: {
      capability: 'review_analysis',
      reviewAnalysisEpoch: facts.reviewAnalysisEpoch,
    },
    sourceEpoch: input.sourceEpoch,
    evaluatedLanguage: facts.evaluatedLanguage,
    concreteReplyLanguage: null,
    languageCatalogueDigest: LANGUAGE_CATALOGUE_DIGEST,
    replyLanguageVerifierDigest: null,
    languageScriptConsistencyDigest: null,
    zhOrthographyVerifierDigest: null,
    sourceRevision: input.sourceRevision,
    reviewedAtEpochMillis: facts.reviewedAtEpochMillis,
    propertyProfileVersion: profile.profileVersion,
    routingPolicyVersion: profile.routingPolicyVersion,
    sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
    sourceCanonicalizerDigest:
      AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
    redactionProfileVersion: authorization.redactionProfileFamily,
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
    providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
    operationProfileVersion: facts.operationProfile.profileVersion,
    capabilityRuntimeProfileVersion:
      facts.operationProfile.capabilityRuntimeProfileVersion!,
    aiSubjectHmacKeyVersion: facts.subjectHmacKeyVersion,
    stopFence: facts.stopFence,
  }
}
