import { describe, expect, it } from 'vitest'
import {
  createAiOperationIdentity,
  parseAiExecutionBinding,
  parseAiPrivateBetaPolicy,
  resolveAiProcessingCell,
} from './rules'
import policySource from './catalogues/ai-private-beta-policy-v1.json'

const DIGEST = 'a'.repeat(64)
const UUID_A = '00000000-0000-4000-8000-000000000001'
const UUID_B = '00000000-0000-4000-8000-000000000002'
const UUID_C = '00000000-0000-4000-8000-000000000003'

const stopFence = {
  globalControlId: UUID_A,
  globalGeneration: 1,
  providerControlId: UUID_B,
  providerGeneration: 1,
  capabilityControlId: UUID_C,
  capabilityGeneration: 1,
} as const

const commonBinding = {
  authorizationLineageId: UUID_A,
  noticeVersion: 'merchant-ai-notice-2026-08-15.v1',
  noticeDigest: DIGEST,
  sourceEpoch: 2,
  propertyProfileVersion: 3,
  routingPolicyVersion: 1,
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  sourceCanonicalizerDigest: DIGEST,
  redactionProfileVersion: 'gbp-review-global-v1',
  providerDeploymentProfileVersion: 'private-beta-global-v1',
  stopFence,
} as const

describe('AI private-beta policy', () => {
  it('accepts the sole closed and reference-complete policy source', () => {
    const result = parseAiPrivateBetaPolicy(policySource)

    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.capabilities.map((entry) => entry.id)).toEqual([
      'property_trends',
      'reply_drafting',
      'review_analysis',
    ])
    expect(result.value.releaseGates.every((gate) => gate.owner.length > 0)).toBe(true)
  })

  it('rejects extra, reordered, duplicate, dangling, and unused policy rows', () => {
    const source = structuredClone(policySource) as Record<string, unknown>
    const extra = parseAiPrivateBetaPolicy({ ...source, waiver: true })
    expect(extra.isErr() && extra.error.message).toMatch(/unknown policy field/i)

    const reordered = structuredClone(policySource)
    reordered.capabilities.reverse()
    const orderResult = parseAiPrivateBetaPolicy(reordered)
    expect(orderResult.isErr() && orderResult.error.message).toMatch(
      /sorted capability IDs/i,
    )

    const duplicate = structuredClone(policySource)
    duplicate.capabilities[1] = duplicate.capabilities[0]
    const duplicateResult = parseAiPrivateBetaPolicy(duplicate)
    expect(duplicateResult.isErr() && duplicateResult.error.message).toMatch(
      /duplicate capability ID/i,
    )

    const dangling = structuredClone(policySource)
    dangling.capabilities[0]!.routeId = 'missing-route'
    const danglingResult = parseAiPrivateBetaPolicy(dangling)
    expect(danglingResult.isErr() && danglingResult.error.message).toMatch(
      /dangling route reference/i,
    )

    const unused = structuredClone(policySource)
    unused.routes.push({
      id: 'unused-route',
      sourceClassId: 'aggregate-only',
      outputClassId: 'trend-selection',
      retentionPolicyId: 'trend-report-24-months',
    })
    const unusedResult = parseAiPrivateBetaPolicy(unused)
    expect(unusedResult.isErr() && unusedResult.error.message).toMatch(
      /unconsumed route/i,
    )
  })
})

describe('AI processing cell routing', () => {
  it.each([
    ['US', 'America/New_York'],
    ['DE', 'Europe/Berlin'],
    ['JP', 'Asia/Tokyo'],
    ['NZ', 'Pacific/Auckland'],
  ])(
    'routes canonical %s properties to the explicit global cell',
    (countryCode, timezone) => {
      expect(resolveAiProcessingCell({ countryCode, timezone })).toEqual({
        status: 'available',
        processingRegion: 'global',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
        routingPolicyVersion: 1,
      })
    },
  )

  it.each([
    ['', 'UTC'],
    ['ZZ', 'UTC'],
    ['us', 'America/New_York'],
    ['US', 'GMT+1'],
    ['US', 'Not/AZone'],
  ])(
    'denies malformed country/timezone inputs without a fallback',
    (countryCode, timezone) => {
      expect(resolveAiProcessingCell({ countryCode, timezone })).toEqual({
        status: 'policy_unavailable',
      })
    },
  )
})

describe('AI execution binding and operation identity', () => {
  it('accepts the exact analysis binding and rejects reply-only fields', () => {
    const analysis = {
      ...commonBinding,
      capabilityFence: { capability: 'review_analysis', reviewAnalysisEpoch: 4 },
      evaluatedLanguage: 'en',
      concreteReplyLanguage: null,
      languageCatalogueDigest: DIGEST,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: 5,
      reviewedAtEpochMillis: 1_786_867_200_000,
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      operationProfileVersion: 'review-analysis-v1',
      capabilityRuntimeProfileVersion: 'review-analysis-runtime-v1',
      aiSubjectHmacKeyVersion: 'ai-subject-hmac-v1',
    } as const

    const accepted = parseAiExecutionBinding(analysis)
    expect(accepted.isOk() && accepted.value).toEqual(analysis)
    const rejected = parseAiExecutionBinding({
      ...analysis,
      replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
    })
    expect(rejected.isErr() && rejected.error.message).toMatch(/analysis binding/i)
  })

  it('enforces the four-branch operation identity matrix', () => {
    const analysis = createAiOperationIdentity({
      command: 'analysis',
      organizationId: 'org-1',
      propertyId: UUID_A,
      actorId: null,
      systemPrincipal: 'review_event_consumer',
      reviewId: UUID_B,
      originEventId: UUID_C,
      subjectHmac: DIGEST,
      subjectHmacKeyVersion: 'ai-subject-hmac-v1',
      sourceEpoch: 1,
      sourceRevision: 2,
      reviewedAtEpochMillis: 1_786_867_200_000,
      analysisSequence: 3,
    })
    expect(analysis.isOk() && analysis.value.subjectKind).toBe('property')
    expect(analysis.isOk() && analysis.value.capability).toBe('review_analysis')

    if (analysis.isErr()) return
    const crossWired = createAiOperationIdentity({
      ...analysis.value,
      command: 'trend',
    } as never)
    expect(crossWired.isErr() && crossWired.error.message).toMatch(/trend identity/i)

    const canary = createAiOperationIdentity({
      command: 'synthetic_canary',
      actorId: null,
      systemPrincipal: 'release_canary',
      releaseSha: 'b'.repeat(40),
      canaryAuthorizationId: UUID_A,
      canaryAuthorizationGeneration: 1,
      canaryProfileVersion: 'synthetic-canary-v1',
    })
    expect(canary.isOk() && canary.value.subjectKind).toBe('synthetic_canary')
    expect(canary.isOk() && canary.value.capability).toBeNull()
  })
})
