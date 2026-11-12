import type { AiAdmissionDescriptorV1 } from '#/shared/ai-internal-transport-contract'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import {
  mintAiExecutionAdmission,
  type AiExecutionAdmission,
} from './execution-admission'

/**
 * An admission as the authority would mint it for this descriptor: issued a
 * second before the deadline window opens, and, on the reply route, adoptable
 * until the deadline unless the test says otherwise.
 */
export function admitForTest(
  descriptor: AiAdmissionDescriptorV1,
  issued: Partial<
    Readonly<{
      issuedAtEpochMillis: number
      replyTokenExpiresAtEpochMillis: number | null
      replyDraftExpiresAtEpochMillis: number | null
    }>
  > = {},
): AiExecutionAdmission {
  const reply = descriptor.route === 'reply-suggestion'
  const replyExpiry = reply ? descriptor.callerDeadlineEpochMillis : null
  return mintAiExecutionAdmission(descriptor, {
    issuedAtEpochMillis:
      issued.issuedAtEpochMillis ?? descriptor.callerDeadlineEpochMillis - 70_000,
    replyTokenExpiresAtEpochMillis:
      issued.replyTokenExpiresAtEpochMillis === undefined
        ? replyExpiry
        : issued.replyTokenExpiresAtEpochMillis,
    replyDraftExpiresAtEpochMillis:
      issued.replyDraftExpiresAtEpochMillis === undefined
        ? replyExpiry
        : issued.replyDraftExpiresAtEpochMillis,
  })
}

const UUIDS = {
  operation: '10000000-0000-4000-8000-000000000001',
  permit: '10000000-0000-4000-8000-000000000002',
  property: '10000000-0000-4000-8000-000000000003',
  authorization: '10000000-0000-4000-8000-000000000004',
  lineage: '10000000-0000-4000-8000-000000000005',
  controlGlobal: '10000000-0000-4000-8000-000000000006',
  controlProvider: '10000000-0000-4000-8000-000000000007',
  controlCapability: '10000000-0000-4000-8000-000000000008',
} as const

const SHA = 'a'.repeat(64)

/** A strict review-analysis descriptor the contract schema accepts. */
export function descriptorForTest(): AiAdmissionDescriptorV1 {
  return {
    version: 'ai-admission-descriptor-v1',
    subjectKind: 'property',
    route: 'review-analysis',
    operationId: UUIDS.operation,
    permitId: UUIDS.permit,
    attemptNumber: 1,
    organizationId: 'org_01',
    propertyId: UUIDS.property,
    internalSubjectId: 'review_01',
    actorId: null,
    binding: {
      authorizationLineageId: UUIDS.lineage,
      noticeVersion: MERCHANT_AI_NOTICE_VERSION,
      noticeDigest: SHA,
      capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 1 },
      sourceEpoch: 1,
      evaluatedLanguage: 'en-Latn',
      concreteReplyLanguage: null,
      languageCatalogueDigest: SHA,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: 1,
      reviewedAtEpochMillis: 1_780_000_000_000,
      propertyProfileVersion: 1,
      routingPolicyVersion: 1,
      sourcePolicyId: 'google-business-profile-source-policy-v1',
      sourceCanonicalizerDigest: SHA,
      redactionProfileVersion: 'gbp-review-global-v1',
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      operationProfileVersion: 'review-analysis-v2',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
      aiSubjectHmacKeyVersion: 'v1',
      stopFence: {
        globalControlId: UUIDS.controlGlobal,
        globalGeneration: 1,
        providerControlId: UUIDS.controlProvider,
        providerGeneration: 1,
        capabilityControlId: UUIDS.controlCapability,
        capabilityGeneration: 1,
      },
    },
    canaryBinding: null,
    releaseSha: null,
    canaryAuthorizationId: null,
    sourceDigest: SHA,
    preparedDigest: 'b'.repeat(64),
    sourceByteCount: 120,
    preparedByteCount: 400,
    providerPayloadByteCount: 220,
    promptCacheShard: 3,
    limits: {
      sourceBytes: 16_384,
      providerPayloadBytes: 32_768,
      preparedRequestBytes: 65_536,
      responseBytes: 65_536,
      outputTokens: 320,
      costMicros: 10_000,
    },
    callerDeadlineEpochMillis: 1_780_000_070_000,
    observedContentExpiresAtEpochMillis: 1_780_000_600_000,
    redactionCountry: 'US',
    redactionProfileVersion: 'gbp-review-global-v1',
    outputLeakageProfileVersion: null,
    outputLeakageProfileDigest: null,
    replyTemplateCatalogueVersion: null,
    replyTemplateCatalogueDigest: null,
  }
}
