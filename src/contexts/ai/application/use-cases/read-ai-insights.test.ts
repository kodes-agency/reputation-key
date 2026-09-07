import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import {
  AI_PROPERTY_TREND_DEFINITION_DIGEST,
  AI_PROPERTY_TREND_DEFINITION_VERSION,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
} from '#/shared/ai-property-trend-contract'
import type { AiMerchantAuthorizationSnapshot } from '../ports/ai-authorization.port'
import type { AiOutputStorePort, AiTrendReportRead } from '../ports/ai-output-store.port'
import type { AiPropertyProfileResult, ReviewAnalysisReadV1 } from '../../domain/types'
import type { ReadAiInsightsDependencies } from './read-ai-insights'
import { createReadPropertyTrend, createReadReviewAnalysis } from './read-ai-insights'

/**
 * Both reads are admission gates in front of the output store: they decide
 * whether the caller may read at all, and with which pins. Every literal that
 * the production code pins comes from the compiled catalogue here — pasting
 * `'review-analysis-v1'` would keep passing after a catalogue repin, which is
 * exactly the mismatch these reads exist to prevent.
 */
const REVIEW_ANALYSIS_PROFILE = AI_OPERATION_PROFILES.find(
  (profile) => profile.capability === 'review_analysis',
)!
const PROPERTY_TREND_PROFILE = AI_OPERATION_PROFILES.find(
  (profile) => profile.capability === 'property_trends',
)!

const NOW = Date.parse('2026-08-16T12:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-insight-read-test')
const PROPERTY_ID = propertyId('71000000-0000-4000-8000-000000000301')
const REVIEW_ID = reviewId('71000000-0000-4000-8000-000000000302')
const ACTOR_USER_ID = userId('71000000-0000-4000-8000-000000000303')
const LINEAGE_ID = '71000000-0000-4000-8000-000000000304'
const SHA = 'a'.repeat(64)

/**
 * Deliberately distinct so a swapped pin cannot pass: the source epoch the
 * merchant authorized, the three per-capability epochs, and the property
 * profile version all live in different tables and are never interchangeable.
 */
const AUTHORIZED_SOURCE_EPOCH = 11
const REVIEW_ANALYSIS_EPOCH = 4
const REPLY_DRAFTING_EPOCH = 7
const PROPERTY_TRENDS_EPOCH = 9
const PROPERTY_PROFILE_VERSION = 3

const ENABLED_AUTHORIZATION: AiMerchantAuthorizationSnapshot = Object.freeze({
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  state: 'enabled',
  stateVersion: 1,
  authorizationLineageId: LINEAGE_ID,
  authorizedSourceEpoch: AUTHORIZED_SOURCE_EPOCH,
  capabilities: ['review_analysis', 'property_trends'],
  capabilityRuntimeProfileVersions: {
    review_analysis: REVIEW_ANALYSIS_PROFILE.capabilityRuntimeProfileVersion ?? '',
    property_trends: PROPERTY_TREND_PROFILE.capabilityRuntimeProfileVersion ?? '',
  },
  // A capability enabled once and never touched again has a null change stamp.
  capabilityEpochs: {
    review_analysis: { epoch: REVIEW_ANALYSIS_EPOCH, changedAtEpochMillis: null },
    reply_drafting: { epoch: REPLY_DRAFTING_EPOCH, changedAtEpochMillis: null },
    property_trends: { epoch: PROPERTY_TRENDS_EPOCH, changedAtEpochMillis: null },
  },
  reviewAnalysisStartSequence: 1,
  noticeVersion: MERCHANT_AI_NOTICE_VERSION,
  noticeDigest: SHA,
  sourcePolicyId: 'google-business-profile-source-policy-v1',
  sourceCanonicalizerDigest: SHA,
  redactionProfileFamily: 'gbp-review-global-v1',
  providerDeploymentProfileVersion:
    PROPERTY_TREND_PROFILE.providerDeploymentProfileVersion,
} as const)

/**
 * The profile's own `sourceEpoch` is intentionally not the authorized one: the
 * two pins are refreshed independently and disagree inside the refresh window,
 * so a read that sourced its epoch from the profile row would be caught here.
 */
const AVAILABLE_RUNTIME: AiPropertyProfileResult = Object.freeze({
  status: 'available',
  profile: {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    countryCode: 'US',
    timezone: 'America/New_York',
    processingRegion: 'global',
    routingPolicyVersion: 1,
    sourceEpoch: AUTHORIZED_SOURCE_EPOCH + 1,
    profileVersion: PROPERTY_PROFILE_VERSION,
    lifecycleState: 'active',
  },
} as const)

/** A review that has never been edited: epoch 0, first revision, first analysis. */
const ANALYSIS_INPUT = Object.freeze({
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  reviewId: REVIEW_ID,
  actorUserId: ACTOR_USER_ID,
  sourceEpoch: 0,
  sourceRevision: 1,
  analysisSequence: 1,
})

const TREND_INPUT = Object.freeze({
  organizationId: ORGANIZATION_ID,
  propertyId: PROPERTY_ID,
  actorUserId: ACTOR_USER_ID,
})

const CURRENTNESS = Object.freeze({
  sourceEpoch: 0,
  sourceRevision: 1,
  analysisSequence: 1,
  reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
  propertyProfileVersion: PROPERTY_PROFILE_VERSION,
  analysisProfileVersion: REVIEW_ANALYSIS_PROFILE.profileVersion,
})

const ANALYSIS_NONE: ReviewAnalysisReadV1 = Object.freeze({
  ...CURRENTNESS,
  status: 'none',
})
const ANALYSIS_UNAVAILABLE: ReviewAnalysisReadV1 = Object.freeze({
  ...CURRENTNESS,
  status: 'unavailable',
  reason: 'language_not_supported',
})
const ANALYSIS_READY: ReviewAnalysisReadV1 = Object.freeze({
  ...CURRENTNESS,
  status: 'ready',
  sentiment: 'negative',
  primaryCategory: 'service',
  attention: 'urgent',
  generatedAtEpochMillis: NOW - 60_000,
})

const TREND_PINS = Object.freeze({
  sourceEpoch: AUTHORIZED_SOURCE_EPOCH,
  reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
  propertyTrendsEpoch: PROPERTY_TRENDS_EPOCH,
  propertyProfileVersion: PROPERTY_PROFILE_VERSION,
})

const TREND_PREPARING: AiTrendReportRead = Object.freeze({
  ...TREND_PINS,
  status: 'preparing',
})
const TREND_EVIDENCE = Object.freeze({
  definitionVersion: AI_PROPERTY_TREND_DEFINITION_VERSION,
  definitionDigest: AI_PROPERTY_TREND_DEFINITION_DIGEST,
  renderProfileVersion: AI_TREND_RENDER_PROFILE_VERSION,
  renderProfileDigest: AI_TREND_RENDER_PROFILE_DIGEST,
  timezone: 'Europe/Sofia',
  dataThroughLocalDate: '2026-08-14',
  baseline: {
    period: { startLocalDate: '2026-06-16', endLocalDate: '2026-07-15' },
    textCandidateCount: 20,
    analyzedCount: 20,
    excludedCount: 0,
    starOnlyCount: 2,
    coverageBasisPoints: 10_000,
  },
  current: {
    period: { startLocalDate: '2026-07-16', endLocalDate: '2026-08-14' },
    textCandidateCount: 20,
    analyzedCount: 20,
    excludedCount: 0,
    starOnlyCount: 1,
    coverageBasisPoints: 10_000,
  },
  modelLineage: [],
  selectedSignals: [],
  supportingReviews: [],
})
const TREND_UPDATING: AiTrendReportRead = Object.freeze({
  ...TREND_PINS,
  status: 'updating',
  evidence: TREND_EVIDENCE,
})
const TREND_INSUFFICIENT: AiTrendReportRead = Object.freeze({
  ...TREND_PINS,
  status: 'insufficient_data',
  dueLocalDate: '2026-08-15',
  terminalAnalysisSequence: 0,
  aggregateRevision: 0,
  evidence: TREND_EVIDENCE,
  updating: false,
})
const TREND_READY: AiTrendReportRead = Object.freeze({
  ...TREND_PINS,
  status: 'ready',
  dueLocalDate: '2026-08-15',
  terminalAnalysisSequence: 12,
  aggregateRevision: 5,
  reportProfileVersion: PROPERTY_TREND_PROFILE.profileVersion,
  report: {
    signalKey: 'sentiment.negative.up',
    direction: 'declining',
    changeMagnitudeBasisPoints: 1_200,
    supportingReviewCount: 18,
  },
  evidence: TREND_EVIDENCE,
  updating: false,
  generatedAtEpochMillis: NOW - 3_600_000,
} as const)

type AnalysisReadRequest = Parameters<AiOutputStorePort['readAnalysisForDelivery']>[0]
type TrendReadRequest = Parameters<AiOutputStorePort['readTrendReportForDelivery']>[0]
type AnalysisDeliver = (result: ReviewAnalysisReadV1) => Promise<ReviewAnalysisReadV1>
type TrendDeliver = (result: AiTrendReportRead) => Promise<AiTrendReportRead>

function createHarness(
  options: Readonly<{
    authorization?: AiMerchantAuthorizationSnapshot | null
    runtime?: AiPropertyProfileResult
    analysisRead?: ReviewAnalysisReadV1
    trendRead?: AiTrendReportRead
    storeFailure?: Error
    clock?: () => number
  }> = {},
) {
  const authorization =
    options.authorization === undefined ? ENABLED_AUTHORIZATION : options.authorization
  const readMerchantAuthorization = vi.fn(async () => authorization)
  const readForAi = vi.fn(async () => options.runtime ?? AVAILABLE_RUNTIME)
  let deliveries = 0

  const readAnalysisForDelivery = vi.fn(
    async (_request: AnalysisReadRequest, deliver: AnalysisDeliver) => {
      if (options.storeFailure) throw options.storeFailure
      deliveries += 1
      return deliver(options.analysisRead ?? ANALYSIS_READY)
    },
  )
  const readTrendReportForDelivery = vi.fn(
    async (_request: TrendReadRequest, deliver: TrendDeliver) => {
      if (options.storeFailure) throw options.storeFailure
      deliveries += 1
      return deliver(options.trendRead ?? TREND_READY)
    },
  )

  const dependencies = {
    authorization: { readMerchantAuthorization },
    outputs: {
      storeAnalysis: vi.fn(),
      settleEphemeralReply: vi.fn(),
      findCurrentReviewIdsByAttention: vi.fn(),
      storeTrendReport: vi.fn(),
      readAnalysisForDelivery,
      readTrendReportForDelivery,
    },
    processingProfiles: { readForAi, refreshForAi: vi.fn() },
    nowEpochMillis: options.clock ?? (() => NOW),
  } as unknown as ReadAiInsightsDependencies

  return {
    readReviewAnalysis: createReadReviewAnalysis(dependencies),
    readPropertyTrend: createReadPropertyTrend(dependencies),
    deliveryCount: () => deliveries,
    mocks: {
      readAnalysisForDelivery,
      readTrendReportForDelivery,
      readMerchantAuthorization,
      readForAi,
    },
  }
}

function authorizationWith(
  overrides: Partial<AiMerchantAuthorizationSnapshot>,
): AiMerchantAuthorizationSnapshot {
  return { ...ENABLED_AUTHORIZATION, ...overrides }
}

const UNAVAILABLE_RUNTIMES = [
  'not_found',
  'deleting',
  'source_epoch_changed',
  'property_profile_changed',
  'routing_policy_changed',
  'policy_unavailable',
] as const

describe('read review analysis', () => {
  it('reads through the store with the authorization epoch and catalogued profile version', async () => {
    const harness = createHarness()

    await expect(harness.readReviewAnalysis(ANALYSIS_INPUT)).resolves.toBe(ANALYSIS_READY)
    expect(harness.mocks.readAnalysisForDelivery).toHaveBeenCalledOnce()
    // Exact equality, not objectContaining: an extra or missing pin is a bug.
    expect(harness.mocks.readAnalysisForDelivery.mock.calls[0]?.[0]).toEqual({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      actorUserId: ACTOR_USER_ID,
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      authorizationLineageId: LINEAGE_ID,
      reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
      propertyProfileVersion: PROPERTY_PROFILE_VERSION,
      analysisProfileVersion: REVIEW_ANALYSIS_PROFILE.profileVersion,
      nowEpochMillis: NOW,
    })
    expect(harness.deliveryCount()).toBe(1)
  })

  it('returns the store view model unchanged when the review has no analysis row', async () => {
    const harness = createHarness({ analysisRead: ANALYSIS_NONE })

    await expect(harness.readReviewAnalysis(ANALYSIS_INPUT)).resolves.toEqual({
      status: 'none',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
      propertyProfileVersion: PROPERTY_PROFILE_VERSION,
      analysisProfileVersion: REVIEW_ANALYSIS_PROFILE.profileVersion,
    })
  })

  it('keeps an unavailable analysis distinguishable from a disabled capability', async () => {
    const harness = createHarness({ analysisRead: ANALYSIS_UNAVAILABLE })

    await expect(harness.readReviewAnalysis(ANALYSIS_INPUT)).resolves.toEqual(
      ANALYSIS_UNAVAILABLE,
    )
  })

  it('reads the clock once per invocation instead of pinning it at construction', async () => {
    let tick = 0
    const harness = createHarness({ clock: () => NOW + tick++ })

    await harness.readReviewAnalysis(ANALYSIS_INPUT)
    await harness.readReviewAnalysis(ANALYSIS_INPUT)

    expect(
      harness.mocks.readAnalysisForDelivery.mock.calls.map(
        ([request]) => request.nowEpochMillis,
      ),
    ).toEqual([NOW, NOW + 1])
  })

  it('propagates store read failures instead of reporting the capability disabled', async () => {
    const harness = createHarness({ storeFailure: new Error('read lease lost') })

    await expect(harness.readReviewAnalysis(ANALYSIS_INPUT)).rejects.toThrow(
      'read lease lost',
    )
  })

  describe('fails closed without touching the output store', () => {
    const cases: ReadonlyArray<
      readonly [
        string,
        Readonly<{
          authorization?: AiMerchantAuthorizationSnapshot | null
          runtime?: AiPropertyProfileResult
        }>,
      ]
    > = [
      ['no authorization row exists', { authorization: null }],
      [
        'authorization was never enabled',
        { authorization: authorizationWith({ state: 'disabled' }) },
      ],
      [
        'authorization was revoked',
        { authorization: authorizationWith({ state: 'revoked' }) },
      ],
      [
        'the lineage id the read would pin is missing',
        { authorization: authorizationWith({ authorizationLineageId: null }) },
      ],
      [
        'review analysis is not among the granted capabilities',
        { authorization: authorizationWith({ capabilities: ['property_trends'] }) },
      ],
      [
        'no capability is granted at all',
        { authorization: authorizationWith({ capabilities: [] }) },
      ],
      ...UNAVAILABLE_RUNTIMES.map(
        (status) =>
          [`the processing profile is ${status}`, { runtime: { status } }] as const,
      ),
    ]

    it.each(cases)('when %s', async (_label, options) => {
      const harness = createHarness(options)

      await expect(harness.readReviewAnalysis(ANALYSIS_INPUT)).resolves.toEqual({
        status: 'disabled',
      })
      expect(harness.mocks.readAnalysisForDelivery).not.toHaveBeenCalled()
    })
  })
})

describe('read property trend', () => {
  it('reads through the store with the authorized source epoch and both capability epochs', async () => {
    const harness = createHarness()

    await expect(harness.readPropertyTrend(TREND_INPUT)).resolves.toBe(TREND_READY)
    expect(harness.mocks.readTrendReportForDelivery).toHaveBeenCalledOnce()
    expect(harness.mocks.readTrendReportForDelivery.mock.calls[0]?.[0]).toEqual({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      actorUserId: ACTOR_USER_ID,
      sourceEpoch: AUTHORIZED_SOURCE_EPOCH,
      reviewAnalysisEpoch: REVIEW_ANALYSIS_EPOCH,
      propertyTrendsEpoch: PROPERTY_TRENDS_EPOCH,
      propertyProfileVersion: PROPERTY_PROFILE_VERSION,
      reportProfileVersion: PROPERTY_TREND_PROFILE.profileVersion,
      nowEpochMillis: NOW,
    })
  })

  /**
   * A trend report is property-scoped and pins no lineage argument, so a null
   * lineage id must not disable it — only the review-analysis read, which does
   * pin one, may refuse.
   */
  it('still reads when the authorization carries no lineage id', async () => {
    const harness = createHarness({
      authorization: authorizationWith({ authorizationLineageId: null }),
    })

    await expect(harness.readPropertyTrend(TREND_INPUT)).resolves.toBe(TREND_READY)
    expect(harness.mocks.readTrendReportForDelivery).toHaveBeenCalledOnce()
  })

  it.each([
    ['preparing', TREND_PREPARING],
    ['updating', TREND_UPDATING],
    ['insufficient_data', TREND_INSUFFICIENT],
    ['ready', TREND_READY],
  ])('forwards the %s outcome without rewriting it', async (_status, trendRead) => {
    const harness = createHarness({ trendRead })

    await expect(harness.readPropertyTrend(TREND_INPUT)).resolves.toBe(trendRead)
  })

  it('propagates store read failures instead of reporting the capability disabled', async () => {
    const harness = createHarness({ storeFailure: new Error('trend read lease lost') })

    await expect(harness.readPropertyTrend(TREND_INPUT)).rejects.toThrow(
      'trend read lease lost',
    )
  })

  describe('fails closed without touching the output store', () => {
    const cases: ReadonlyArray<
      readonly [
        string,
        Readonly<{
          authorization?: AiMerchantAuthorizationSnapshot | null
          runtime?: AiPropertyProfileResult
        }>,
      ]
    > = [
      ['no authorization row exists', { authorization: null }],
      [
        'authorization was never enabled',
        { authorization: authorizationWith({ state: 'disabled' }) },
      ],
      [
        'authorization was revoked',
        { authorization: authorizationWith({ state: 'revoked' }) },
      ],
      [
        'property trends is not among the granted capabilities',
        { authorization: authorizationWith({ capabilities: ['review_analysis'] }) },
      ],
      [
        'no capability is granted at all',
        { authorization: authorizationWith({ capabilities: [] }) },
      ],
      ...UNAVAILABLE_RUNTIMES.map(
        (status) =>
          [`the processing profile is ${status}`, { runtime: { status } }] as const,
      ),
    ]

    it.each(cases)('when %s', async (_label, options) => {
      const harness = createHarness(options)

      await expect(harness.readPropertyTrend(TREND_INPUT)).resolves.toEqual({
        status: 'disabled',
      })
      expect(harness.mocks.readTrendReportForDelivery).not.toHaveBeenCalled()
    })
  })
})
