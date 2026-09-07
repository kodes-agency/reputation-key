import { describe, expect, it } from 'vitest'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
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
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
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

const makeAnalysisBinding = (): Record<string, unknown> => ({
  ...commonBinding,
  stopFence: structuredClone(stopFence),
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
})

const makeReplyBinding = (): Record<string, unknown> => ({
  ...commonBinding,
  stopFence: structuredClone(stopFence),
  capabilityFence: {
    capability: 'reply_drafting',
    replyDraftingEpoch: 4,
    baseReplyStateRevision: 0,
  },
  evaluatedLanguage: 'en',
  concreteReplyLanguage: { tag: 'en', templateGroup: 'latin' },
  languageCatalogueDigest: DIGEST,
  replyLanguageVerifierDigest: DIGEST,
  languageScriptConsistencyDigest: DIGEST,
  zhOrthographyVerifierDigest: DIGEST,
  sourceRevision: 5,
  reviewedAtEpochMillis: 1_786_867_200_000,
  outputLeakageProfileVersion: 'reply-output-leakage-v1',
  outputLeakageProfileDigest: DIGEST,
  replyTemplateCatalogueVersion: 'gbp-reply-template-catalogue-v1',
  replyTemplateCatalogueDigest: DIGEST,
  operationProfileVersion: 'reply-suggestion-v1',
  capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v1',
  aiSubjectHmacKeyVersion: null,
})

const makeTrendBinding = (): Record<string, unknown> => ({
  ...commonBinding,
  capabilityFence: {
    capability: 'property_trends',
    reviewAnalysisEpoch: 4,
    propertyTrendsEpoch: 2,
  },
  evaluatedLanguage: null,
  stopFence: structuredClone(stopFence),
  concreteReplyLanguage: null,
  languageCatalogueDigest: null,
  replyLanguageVerifierDigest: null,
  languageScriptConsistencyDigest: null,
  zhOrthographyVerifierDigest: null,
  sourceRevision: null,
  reviewedAtEpochMillis: null,
  outputLeakageProfileVersion: null,
  outputLeakageProfileDigest: null,
  replyTemplateCatalogueVersion: null,
  replyTemplateCatalogueDigest: null,
  operationProfileVersion: 'property-trend-v1',
  capabilityRuntimeProfileVersion: 'property-trends-runtime-v1',
  aiSubjectHmacKeyVersion: null,
})

const recordAt = (value: Record<string, unknown>, key: string): Record<string, unknown> =>
  value[key] as Record<string, unknown>

const rowsAt = (
  value: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> => value[key] as Array<Record<string, unknown>>

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
    expect(accepted.isOk() && accepted.value).toEqual({
      ...analysis,
      replyBrandProfileVersion: null,
      replyBrandDisplayNameDigest: null,
    })
    const partiallyGrounded = parseAiExecutionBinding({
      ...analysis,
      replyBrandProfileVersion: 1,
    })
    expect(partiallyGrounded.isErr()).toBe(true)
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
  })
})

describe('AI private-beta policy fail-closed validation', () => {
  it.each([
    ['non-object', null],
    ['array', []],
    ['missing fields', {}],
    ['wrong version', { ...policySource, version: 'ai-private-beta-policy-v2' }],
    ['wrong region', { ...policySource, region: 'regional' }],
    ['optional publication', { ...policySource, manualPublicationRequired: false }],
    ['invalid initial bundle', { ...policySource, initialBundle: [1] }],
  ])('rejects an invalid %s root', (_label, value) => {
    expect(parseAiPrivateBetaPolicy(value).isErr()).toBe(true)
  })

  it.each([
    'capabilities',
    'roles',
    'routes',
    'sourceClasses',
    'outputClasses',
    'retentionPolicies',
    'releaseGates',
  ])('requires at least one %s row', (key) => {
    const policy = structuredClone(policySource) as unknown as Record<string, unknown>
    policy[key] = []
    expect(parseAiPrivateBetaPolicy(policy).isErr()).toBe(true)
  })

  it.each([
    [
      'unknown row field',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.unknown = true
      },
    ],
    [
      'non-object row',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0] = [] as unknown as Record<string, unknown>
      },
    ],
    [
      'invalid row ID',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.id = 'Not Valid'
      },
    ],
    [
      'invalid platform capability',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.platformCapability = ''
      },
    ],
    [
      'invalid permission',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.permission = ''
      },
    ],
    [
      'invalid runtime profile',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.runtimeProfileVersion = ''
      },
    ],
    [
      'invalid actor kind',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.actorKind = 'browser'
      },
    ],
    [
      'invalid route ID',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.routeId = ''
      },
    ],
    [
      'invalid dependency list',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.requires = [1]
      },
    ],
    [
      'dangling capability dependency',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'capabilities')[0]!.requires = ['missing-capability']
      },
    ],
    [
      'dangling source class',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'routes')[0]!.sourceClassId = 'missing-source'
      },
    ],
    [
      'dangling output class',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'routes')[0]!.outputClassId = 'missing-output'
      },
    ],
    [
      'dangling retention policy',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'routes')[0]!.retentionPolicyId = 'missing-retention'
      },
    ],
    [
      'invalid role permissions',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'roles')[0]!.permissions = [1]
      },
    ],
    [
      'invalid source class',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'sourceClasses')[0]!.containsRawReviewContent = 'yes'
      },
    ],
    [
      'invalid output class',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'outputClasses')[0]!.durable = 'yes'
      },
    ],
    [
      'invalid retention duration',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'retentionPolicies')[0]!.duration = 'forever'
      },
    ],
    [
      'invalid release stage',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'releaseGates')[0]!.stage = 'rollout'
      },
    ],
    [
      'missing release owner',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'releaseGates')[0]!.owner = ''
      },
    ],
    [
      'provider content release gate',
      (policy: Record<string, unknown>) => {
        rowsAt(policy, 'releaseGates')[0]!.contentClass = 'provider_content'
      },
    ],
    [
      'incomplete initial bundle',
      (policy: Record<string, unknown>) => {
        policy.initialBundle = ['property_trends']
      },
    ],
    [
      'reordered initial bundle',
      (policy: Record<string, unknown>) => {
        policy.initialBundle = [...(policy.initialBundle as Array<string>)].reverse()
      },
    ],
  ])('rejects a policy with %s', (_label, mutate) => {
    const policy = structuredClone(policySource) as unknown as Record<string, unknown>
    mutate(policy)
    expect(parseAiPrivateBetaPolicy(policy).isErr()).toBe(true)
  })
})

describe('AI execution binding fail-closed validation', () => {
  it.each([
    ['analysis', makeAnalysisBinding],
    ['reply', makeReplyBinding],
    ['trend', makeTrendBinding],
  ])('accepts an exact %s binding', (_label, createBinding) => {
    expect(parseAiExecutionBinding(createBinding()).isOk()).toBe(true)
  })

  it('accepts a reply grounded in a brand profile, and only when BOTH halves are present', () => {
    // The grounded pair had no coverage at all: every fixture left
    // replyBrandProfileVersion null, so the four operands that check a real
    // brand version and its display-name digest never ran. A binding that
    // names a brand profile without the digest it was rendered from — or the
    // digest without the version — is not grounded, and must be refused.
    const grounded = {
      ...makeReplyBinding(),
      replyBrandProfileVersion: 3,
      replyBrandDisplayNameDigest: DIGEST,
    }
    expect(parseAiExecutionBinding(grounded).isOk()).toBe(true)

    expect(
      parseAiExecutionBinding({ ...grounded, replyBrandDisplayNameDigest: null }).isErr(),
    ).toBe(true)
    expect(
      parseAiExecutionBinding({ ...grounded, replyBrandProfileVersion: null }).isErr(),
    ).toBe(true)
    expect(
      parseAiExecutionBinding({ ...grounded, replyBrandProfileVersion: 0 }).isErr(),
    ).toBe(true)
    expect(
      parseAiExecutionBinding({
        ...grounded,
        replyBrandDisplayNameDigest: 'not-a-digest',
      }).isErr(),
    ).toBe(true)
  })

  it.each([
    [
      'authorization lineage',
      (value: Record<string, unknown>) => {
        value.authorizationLineageId = 'not-a-uuid'
      },
    ],
    [
      'notice version',
      (value: Record<string, unknown>) => {
        value.noticeVersion = ''
      },
    ],
    [
      'notice digest',
      (value: Record<string, unknown>) => {
        value.noticeDigest = 'bad'
      },
    ],
    [
      'source epoch',
      (value: Record<string, unknown>) => {
        value.sourceEpoch = -1
      },
    ],
    [
      'property profile version',
      (value: Record<string, unknown>) => {
        value.propertyProfileVersion = Number.MAX_SAFE_INTEGER + 1
      },
    ],
    [
      'routing policy version',
      (value: Record<string, unknown>) => {
        value.routingPolicyVersion = -1
      },
    ],
    [
      'source policy ID',
      (value: Record<string, unknown>) => {
        value.sourcePolicyId = '\n'
      },
    ],
    [
      'source canonicalizer digest',
      (value: Record<string, unknown>) => {
        value.sourceCanonicalizerDigest = 'bad'
      },
    ],
    [
      'redaction profile',
      (value: Record<string, unknown>) => {
        value.redactionProfileVersion = ''
      },
    ],
    [
      'provider profile',
      (value: Record<string, unknown>) => {
        value.providerDeploymentProfileVersion = ''
      },
    ],
    [
      'operation profile',
      (value: Record<string, unknown>) => {
        value.operationProfileVersion = ''
      },
    ],
    [
      'runtime profile',
      (value: Record<string, unknown>) => {
        value.capabilityRuntimeProfileVersion = ''
      },
    ],
    [
      'language digest',
      (value: Record<string, unknown>) => {
        value.languageCatalogueDigest = 1
      },
    ],
    [
      'reply verifier digest',
      (value: Record<string, unknown>) => {
        value.replyLanguageVerifierDigest = 'bad'
      },
    ],
    [
      'script digest',
      (value: Record<string, unknown>) => {
        value.languageScriptConsistencyDigest = 'bad'
      },
    ],
    [
      'orthography digest',
      (value: Record<string, unknown>) => {
        value.zhOrthographyVerifierDigest = 'bad'
      },
    ],
    [
      'leakage digest',
      (value: Record<string, unknown>) => {
        value.outputLeakageProfileDigest = 'bad'
      },
    ],
    [
      'template digest',
      (value: Record<string, unknown>) => {
        value.replyTemplateCatalogueDigest = 'bad'
      },
    ],
    [
      'stop fence shape',
      (value: Record<string, unknown>) => {
        value.stopFence = null
      },
    ],
    [
      'global fence ID',
      (value: Record<string, unknown>) => {
        recordAt(value, 'stopFence').globalControlId = 'bad'
      },
    ],
    [
      'global fence generation',
      (value: Record<string, unknown>) => {
        recordAt(value, 'stopFence').globalGeneration = 0
      },
    ],
    [
      'provider fence ID',
      (value: Record<string, unknown>) => {
        recordAt(value, 'stopFence').providerControlId = 'bad'
      },
    ],
    [
      'provider fence generation',
      (value: Record<string, unknown>) => {
        recordAt(value, 'stopFence').providerGeneration = 0
      },
    ],
    [
      'capability fence ID',
      (value: Record<string, unknown>) => {
        recordAt(value, 'stopFence').capabilityControlId = 'bad'
      },
    ],
    [
      'capability fence generation',
      (value: Record<string, unknown>) => {
        recordAt(value, 'stopFence').capabilityGeneration = 0
      },
    ],
  ])('rejects an invalid common %s', (_label, mutate) => {
    const value = makeReplyBinding()
    mutate(value)
    expect(parseAiExecutionBinding(value).isErr()).toBe(true)
  })

  it('rejects unknown, missing, and malformed capability fences', () => {
    expect(parseAiExecutionBinding(null).isErr()).toBe(true)
    expect(
      parseAiExecutionBinding({ ...makeAnalysisBinding(), extra: true }).isErr(),
    ).toBe(true)
    const missing = makeAnalysisBinding()
    delete missing.noticeVersion
    expect(parseAiExecutionBinding(missing).isErr()).toBe(true)
    expect(
      parseAiExecutionBinding({
        ...makeAnalysisBinding(),
        capabilityFence: null,
      }).isErr(),
    ).toBe(true)
    expect(parseAiExecutionBinding({ ...makeAnalysisBinding() }).isOk()).toBe(true)
    const unknown = parseAiExecutionBinding({
      ...makeAnalysisBinding(),
      capabilityFence: { capability: 'unknown' },
    })
    expect(unknown.isErr() && unknown.error.message).toMatch(/unknown capability fence/i)
    const reply = parseAiExecutionBinding({
      ...makeReplyBinding(),
      replyLanguageVerifierDigest: null,
    })
    expect(reply.isErr() && reply.error.message).toMatch(/reply binding/i)
    const trend = parseAiExecutionBinding({
      ...makeTrendBinding(),
      evaluatedLanguage: 'en',
    })
    expect(trend.isErr() && trend.error.message).toMatch(/trend binding/i)
  })

  it.each([
    [
      'analysis fence shape',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'capabilityFence').extra = true
      },
    ],
    [
      'analysis epoch',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'capabilityFence').reviewAnalysisEpoch = 0
      },
    ],
    [
      'analysis language',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        value.evaluatedLanguage = ''
      },
    ],
    [
      'analysis source revision',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        value.sourceRevision = 0
      },
    ],
    [
      'analysis review time',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        value.reviewedAtEpochMillis = -1
      },
    ],
    [
      'analysis subject key',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        value.aiSubjectHmacKeyVersion = ''
      },
    ],
    [
      'analysis profile',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        value.operationProfileVersion = 'reply-suggestion-v1'
      },
    ],
    [
      'analysis runtime',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        value.capabilityRuntimeProfileVersion = 'wrong'
      },
    ],
    [
      'analysis cross-wiring',
      makeAnalysisBinding,
      (value: Record<string, unknown>) => {
        value.concreteReplyLanguage = { tag: 'en', templateGroup: 'latin' }
      },
    ],
    [
      'reply fence shape',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        delete recordAt(value, 'capabilityFence').baseReplyStateRevision
      },
    ],
    [
      'reply epoch',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'capabilityFence').replyDraftingEpoch = 0
      },
    ],
    [
      'reply base state',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'capabilityFence').baseReplyStateRevision = -1
      },
    ],
    [
      'reply language',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        value.evaluatedLanguage = ''
      },
    ],
    [
      'reply concrete language',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        value.concreteReplyLanguage = null
      },
    ],
    [
      'reply concrete language shape',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'concreteReplyLanguage').extra = true
      },
    ],
    [
      'reply language tag',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'concreteReplyLanguage').tag = ''
      },
    ],
    [
      'reply template group',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'concreteReplyLanguage').templateGroup = ''
      },
    ],
    [
      'reply subject-key cross-wiring',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        value.aiSubjectHmacKeyVersion = 'key'
      },
    ],
    [
      'reply leakage profile',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        value.outputLeakageProfileVersion = ''
      },
    ],
    [
      'reply template catalogue',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        value.replyTemplateCatalogueVersion = ''
      },
    ],
    [
      'reply profile',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        value.operationProfileVersion = 'wrong'
      },
    ],
    [
      'reply runtime',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        value.capabilityRuntimeProfileVersion = 'wrong'
      },
    ],
    [
      'reply digest',
      makeReplyBinding,
      (value: Record<string, unknown>) => {
        value.replyLanguageVerifierDigest = 'bad'
      },
    ],
    [
      'trend fence shape',
      makeTrendBinding,
      (value: Record<string, unknown>) => {
        delete recordAt(value, 'capabilityFence').reviewAnalysisEpoch
      },
    ],
    [
      'trend analysis epoch',
      makeTrendBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'capabilityFence').reviewAnalysisEpoch = 0
      },
    ],
    [
      'trend epoch',
      makeTrendBinding,
      (value: Record<string, unknown>) => {
        recordAt(value, 'capabilityFence').propertyTrendsEpoch = 0
      },
    ],
    [
      'trend profile',
      makeTrendBinding,
      (value: Record<string, unknown>) => {
        value.operationProfileVersion = 'wrong'
      },
    ],
    [
      'trend runtime',
      makeTrendBinding,
      (value: Record<string, unknown>) => {
        value.capabilityRuntimeProfileVersion = 'wrong'
      },
    ],
    [
      'trend cross-wiring',
      makeTrendBinding,
      (value: Record<string, unknown>) => {
        value.sourceRevision = 1
      },
    ],
  ])('rejects an invalid %s binding', (_label, createBinding, mutate) => {
    const value = createBinding()
    mutate(value)
    expect(parseAiExecutionBinding(value).isErr()).toBe(true)
  })
})

describe('AI operation identity fail-closed validation', () => {
  const makeAnalysisIdentity = (): Record<string, unknown> => ({
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

  const makeReplyIdentity = (): Record<string, unknown> => ({
    command: 'reply',
    organizationId: 'org-1',
    propertyId: UUID_A,
    actorId: 'user-1',
    systemPrincipal: null,
    reviewId: UUID_B,
    sourceEpoch: 1,
    sourceRevision: 2,
    reviewedAtEpochMillis: 1_786_867_200_000,
    tone: 'professional',
    baseReplyStateRevision: 0,
  })

  const makeTrendIdentity = (): Record<string, unknown> => ({
    command: 'trend',
    organizationId: 'org-1',
    propertyId: UUID_A,
    actorId: null,
    systemPrincipal: 'property_trend_coordinator',
    sourceEpoch: 1,
    dueLocalDate: '2026-08-16',
    terminalAnalysisSequence: 0,
    aggregateRevision: 0,
  })

  it.each([
    ['analysis', makeAnalysisIdentity, 'review_analysis'],
    ['reply', makeReplyIdentity, 'reply_drafting'],
    ['trend', makeTrendIdentity, 'property_trends'],
  ])('creates the exact %s operation identity', (_label, createIdentity, capability) => {
    const result = createAiOperationIdentity(createIdentity())
    expect(result.isOk()).toBe(true)
    if (result.isErr()) return
    expect(result.value.capability).toBe(capability)
  })

  // `properties.source_epoch` is 0-based (drizzle/0060): a property that has
  // never been edited sits at 0. Every fixture above uses a non-zero epoch, which
  // is exactly why `isPositiveSafeInteger(value.sourceEpoch)` survived here and
  // rejected the first reply suggestion on a freshly imported property as
  // `reply identity is invalid`.
  it.each([
    ['analysis', makeAnalysisIdentity],
    ['reply', makeReplyIdentity],
    ['trend', makeTrendIdentity],
  ])('accepts the domain default source epoch of 0 for %s', (_label, createIdentity) => {
    const value = createIdentity()
    value.sourceEpoch = 0
    const result = createAiOperationIdentity(value)
    expect(result.isOk()).toBe(true)
  })

  it.each([
    ['analysis', makeAnalysisIdentity],
    ['reply', makeReplyIdentity],
    ['trend', makeTrendIdentity],
  ])('still rejects a negative source epoch for %s', (_label, createIdentity) => {
    const value = createIdentity()
    value.sourceEpoch = -1
    expect(createAiOperationIdentity(value).isErr()).toBe(true)
  })

  // Loosening the source epoch must not have loosened the genuinely 1-based
  // counters that sit beside it in the same predicate.
  it.each([
    ['analysis sourceRevision', makeAnalysisIdentity, 'sourceRevision'],
    ['analysis analysisSequence', makeAnalysisIdentity, 'analysisSequence'],
    ['reply sourceRevision', makeReplyIdentity, 'sourceRevision'],
  ])('still requires %s to be positive', (_label, createIdentity, field) => {
    const value = createIdentity()
    value[field] = 0
    expect(createAiOperationIdentity(value).isErr()).toBe(true)
  })

  it.each([
    ['non-object', null],
    ['missing command', {}],
    ['non-string command', { command: 1 }],
    ['unsupported command', { command: 'publish' }],
    ['extra cross-branch field', { ...makeReplyIdentity(), originEventId: UUID_C }],
  ])('rejects an identity with %s', (_label, value) => {
    expect(createAiOperationIdentity(value).isErr()).toBe(true)
  })

  it.each([
    [
      'analysis organization',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.organizationId = ''
      },
    ],
    [
      'analysis property',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.propertyId = 'bad'
      },
    ],
    [
      'analysis actor',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.actorId = 'user-1'
      },
    ],
    [
      'analysis principal',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.systemPrincipal = null
      },
    ],
    [
      'analysis review',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.reviewId = 'bad'
      },
    ],
    [
      'analysis origin event',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.originEventId = 'bad'
      },
    ],
    [
      'analysis subject HMAC type',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.subjectHmac = 1
      },
    ],
    [
      'analysis subject HMAC format',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.subjectHmac = 'bad'
      },
    ],
    [
      'analysis subject key',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.subjectHmacKeyVersion = ''
      },
    ],
    [
      'analysis source epoch',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.sourceEpoch = -1
      },
    ],
    [
      'analysis source revision',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.sourceRevision = 0
      },
    ],
    [
      'analysis review time',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.reviewedAtEpochMillis = -1
      },
    ],
    [
      'analysis sequence',
      makeAnalysisIdentity,
      (value: Record<string, unknown>) => {
        value.analysisSequence = 0
      },
    ],
    [
      'reply organization',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.organizationId = ''
      },
    ],
    [
      'reply property',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.propertyId = 'bad'
      },
    ],
    [
      'reply actor',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.actorId = ''
      },
    ],
    [
      'reply principal',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.systemPrincipal = 'user'
      },
    ],
    [
      'reply review',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.reviewId = 'bad'
      },
    ],
    [
      'reply source epoch',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.sourceEpoch = -1
      },
    ],
    [
      'reply source revision',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.sourceRevision = 0
      },
    ],
    [
      'reply review time',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.reviewedAtEpochMillis = -1
      },
    ],
    [
      'reply tone',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.tone = 'angry'
      },
    ],
    [
      'reply base state',
      makeReplyIdentity,
      (value: Record<string, unknown>) => {
        value.baseReplyStateRevision = -1
      },
    ],
    [
      'trend organization',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.organizationId = ''
      },
    ],
    [
      'trend property',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.propertyId = 'bad'
      },
    ],
    [
      'trend actor',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.actorId = 'user-1'
      },
    ],
    [
      'trend principal',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.systemPrincipal = null
      },
    ],
    [
      'trend source epoch',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.sourceEpoch = -1
      },
    ],
    [
      'trend date type',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.dueLocalDate = 1
      },
    ],
    [
      'trend date format',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.dueLocalDate = '2026-13-01'
      },
    ],
    [
      'trend terminal sequence',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.terminalAnalysisSequence = -1
      },
    ],
    [
      'trend aggregate revision',
      makeTrendIdentity,
      (value: Record<string, unknown>) => {
        value.aggregateRevision = -1
      },
    ],
  ])('rejects an invalid %s identity', (_label, createIdentity, mutate) => {
    const value = createIdentity()
    mutate(value)
    expect(createAiOperationIdentity(value).isErr()).toBe(true)
  })
})
