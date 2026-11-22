import { describe, expect, it } from 'vitest'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import {
  createAiOperationIdentity,
  parseAiExecutionBinding,
  resolveAiProcessingCell,
} from './rules'

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
  providerDeploymentProfileVersion: 'private-beta-global-v2',
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

const REMOVE = Symbol('remove')

type Patch = Record<string, unknown>

// Returns a copy of `base` with each dotted path set (or deleted for REMOVE).
const patched = (
  base: Record<string, unknown>,
  patch: Patch,
): Record<string, unknown> => {
  const copy = structuredClone(base)
  for (const [path, replacement] of Object.entries(patch)) {
    const keys = path.split('.')
    const last = keys.pop() as string
    const holder = keys.reduce<Record<string, unknown>>(
      (node, key) => node[key] as Record<string, unknown>,
      copy,
    )
    if (replacement === REMOVE) delete holder[last]
    else holder[last] = replacement
  }
  return copy
}

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
        providerDeploymentProfileVersion: 'private-beta-global-v2',
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

  it.each([
    ['review-analysis-v1', 'review-analysis-runtime-v1', true],
    ['review-analysis-v2', 'review-analysis-runtime-v1', true],
    ['review-analysis-v3', 'review-analysis-runtime-v2', true],
    ['review-analysis-v3', 'review-analysis-runtime-v1', false],
    ['review-analysis-v2', 'review-analysis-runtime-v2', false],
    ['review-analysis-v4', 'review-analysis-runtime-v2', false],
  ])(
    'pairs the analysis operation profile %s with the runtime profile %s: %s',
    (operationProfileVersion, capabilityRuntimeProfileVersion, accepted) => {
      const parsed = parseAiExecutionBinding({
        ...makeAnalysisBinding(),
        operationProfileVersion,
        capabilityRuntimeProfileVersion,
      })

      expect(parsed.isOk()).toBe(accepted)
    },
  )

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
    expect(crossWired.isErr() && crossWired.error.message).toMatch(/not supported/i)
  })
})

describe('AI execution binding fail-closed validation', () => {
  it.each([
    ['analysis', makeAnalysisBinding],
    ['reply', makeReplyBinding],
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
    ['authorization lineage', { authorizationLineageId: 'not-a-uuid' }],
    ['notice version', { noticeVersion: '' }],
    ['notice digest', { noticeDigest: 'bad' }],
    ['source epoch', { sourceEpoch: -1 }],
    ['property profile version', { propertyProfileVersion: Number.MAX_SAFE_INTEGER + 1 }],
    ['routing policy version', { routingPolicyVersion: -1 }],
    ['source policy ID', { sourcePolicyId: '\n' }],
    ['source canonicalizer digest', { sourceCanonicalizerDigest: 'bad' }],
    ['redaction profile', { redactionProfileVersion: '' }],
    ['provider profile', { providerDeploymentProfileVersion: '' }],
    ['operation profile', { operationProfileVersion: '' }],
    ['runtime profile', { capabilityRuntimeProfileVersion: '' }],
    ['language digest', { languageCatalogueDigest: 1 }],
    ['reply verifier digest', { replyLanguageVerifierDigest: 'bad' }],
    ['script digest', { languageScriptConsistencyDigest: 'bad' }],
    ['orthography digest', { zhOrthographyVerifierDigest: 'bad' }],
    ['leakage digest', { outputLeakageProfileDigest: 'bad' }],
    ['template digest', { replyTemplateCatalogueDigest: 'bad' }],
    ['stop fence shape', { stopFence: null }],
    ['global fence ID', { 'stopFence.globalControlId': 'bad' }],
    ['global fence generation', { 'stopFence.globalGeneration': 0 }],
    ['provider fence ID', { 'stopFence.providerControlId': 'bad' }],
    ['provider fence generation', { 'stopFence.providerGeneration': 0 }],
    ['capability fence ID', { 'stopFence.capabilityControlId': 'bad' }],
    ['capability fence generation', { 'stopFence.capabilityGeneration': 0 }],
  ])('rejects an invalid common %s', (_label, patch) => {
    expect(parseAiExecutionBinding(patched(makeReplyBinding(), patch)).isErr()).toBe(true)
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
    const retired = parseAiExecutionBinding({
      ...makeAnalysisBinding(),
      capabilityFence: { capability: 'property_trends', reviewAnalysisEpoch: 4 },
    })
    expect(retired.isErr() && retired.error.message).toMatch(/unknown capability fence/i)
  })

  it.each([
    ['analysis fence shape', makeAnalysisBinding, { 'capabilityFence.extra': true }],
    ['analysis epoch', makeAnalysisBinding, { 'capabilityFence.reviewAnalysisEpoch': 0 }],
    ['analysis language', makeAnalysisBinding, { evaluatedLanguage: '' }],
    ['analysis source revision', makeAnalysisBinding, { sourceRevision: 0 }],
    ['analysis review time', makeAnalysisBinding, { reviewedAtEpochMillis: -1 }],
    ['analysis subject key', makeAnalysisBinding, { aiSubjectHmacKeyVersion: '' }],
    [
      'analysis profile',
      makeAnalysisBinding,
      { operationProfileVersion: 'reply-suggestion-v1' },
    ],
    [
      'analysis runtime',
      makeAnalysisBinding,
      { capabilityRuntimeProfileVersion: 'wrong' },
    ],
    [
      'analysis cross-wiring',
      makeAnalysisBinding,
      { concreteReplyLanguage: { tag: 'en', templateGroup: 'latin' } },
    ],
    [
      'reply fence shape',
      makeReplyBinding,
      { 'capabilityFence.baseReplyStateRevision': REMOVE },
    ],
    ['reply epoch', makeReplyBinding, { 'capabilityFence.replyDraftingEpoch': 0 }],
    [
      'reply base state',
      makeReplyBinding,
      { 'capabilityFence.baseReplyStateRevision': -1 },
    ],
    ['reply language', makeReplyBinding, { evaluatedLanguage: '' }],
    ['reply concrete language', makeReplyBinding, { concreteReplyLanguage: null }],
    [
      'reply concrete language shape',
      makeReplyBinding,
      { 'concreteReplyLanguage.extra': true },
    ],
    ['reply language tag', makeReplyBinding, { 'concreteReplyLanguage.tag': '' }],
    [
      'reply template group',
      makeReplyBinding,
      { 'concreteReplyLanguage.templateGroup': '' },
    ],
    [
      'reply subject-key cross-wiring',
      makeReplyBinding,
      { aiSubjectHmacKeyVersion: 'key' },
    ],
    ['reply leakage profile', makeReplyBinding, { outputLeakageProfileVersion: '' }],
    ['reply template catalogue', makeReplyBinding, { replyTemplateCatalogueVersion: '' }],
    ['reply profile', makeReplyBinding, { operationProfileVersion: 'wrong' }],
    ['reply runtime', makeReplyBinding, { capabilityRuntimeProfileVersion: 'wrong' }],
    ['reply digest', makeReplyBinding, { replyLanguageVerifierDigest: 'bad' }],
  ])('rejects an invalid %s binding', (_label, createBinding, patch) => {
    expect(parseAiExecutionBinding(patched(createBinding(), patch)).isErr()).toBe(true)
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

  it.each([
    ['analysis', makeAnalysisIdentity, 'review_analysis'],
    ['reply', makeReplyIdentity, 'reply_drafting'],
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
  ])('accepts the domain default source epoch of 0 for %s', (_label, createIdentity) => {
    const value = createIdentity()
    value.sourceEpoch = 0
    const result = createAiOperationIdentity(value)
    expect(result.isOk()).toBe(true)
  })

  it.each([
    ['analysis', makeAnalysisIdentity],
    ['reply', makeReplyIdentity],
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
    ['analysis organization', makeAnalysisIdentity, { organizationId: '' }],
    ['analysis property', makeAnalysisIdentity, { propertyId: 'bad' }],
    ['analysis actor', makeAnalysisIdentity, { actorId: 'user-1' }],
    ['analysis principal', makeAnalysisIdentity, { systemPrincipal: null }],
    ['analysis review', makeAnalysisIdentity, { reviewId: 'bad' }],
    ['analysis origin event', makeAnalysisIdentity, { originEventId: 'bad' }],
    ['analysis subject HMAC type', makeAnalysisIdentity, { subjectHmac: 1 }],
    ['analysis subject HMAC format', makeAnalysisIdentity, { subjectHmac: 'bad' }],
    ['analysis subject key', makeAnalysisIdentity, { subjectHmacKeyVersion: '' }],
    ['analysis source epoch', makeAnalysisIdentity, { sourceEpoch: -1 }],
    ['analysis source revision', makeAnalysisIdentity, { sourceRevision: 0 }],
    ['analysis review time', makeAnalysisIdentity, { reviewedAtEpochMillis: -1 }],
    ['analysis sequence', makeAnalysisIdentity, { analysisSequence: 0 }],
    ['reply organization', makeReplyIdentity, { organizationId: '' }],
    ['reply property', makeReplyIdentity, { propertyId: 'bad' }],
    ['reply actor', makeReplyIdentity, { actorId: '' }],
    ['reply principal', makeReplyIdentity, { systemPrincipal: 'user' }],
    ['reply review', makeReplyIdentity, { reviewId: 'bad' }],
    ['reply source epoch', makeReplyIdentity, { sourceEpoch: -1 }],
    ['reply source revision', makeReplyIdentity, { sourceRevision: 0 }],
    ['reply review time', makeReplyIdentity, { reviewedAtEpochMillis: -1 }],
    ['reply tone', makeReplyIdentity, { tone: 'angry' }],
    ['reply base state', makeReplyIdentity, { baseReplyStateRevision: -1 }],
  ])('rejects an invalid %s identity', (_label, createIdentity, patch) => {
    expect(createAiOperationIdentity(patched(createIdentity(), patch)).isErr()).toBe(true)
  })
})
