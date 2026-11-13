import { describe, expect, it, vi } from 'vitest'
import {
  organizationId,
  propertyId,
  reviewId,
  userId,
  type PropertyId,
} from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createScopedAuthContext } from '#/shared/testing/scoped-auth-context'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import type { AiMerchantAuthorizationSnapshot } from '../ports/ai-authorization.port'
import type { AiOutputStorePort } from '../ports/ai-output-store.port'
import type { AiPropertyProfileResult, ReviewAnalysisReadV1 } from '../../domain/types'
import type { ReadReviewAnalysisDependencies } from './read-review-analysis'
import { createReadReviewAnalysis } from './read-review-analysis'

/**
 * Both reads are admission gates in front of the output store: they decide
 * whether the caller may read at all, and with which pins. Every literal that
 * the production code pins comes from the compiled catalogue here — pasting
 * a concrete analysis profile version would keep passing after a catalogue
 * repin, which is exactly the mismatch these reads exist to prevent.
 */
const REVIEW_ANALYSIS_PROFILE = AI_OPERATION_PROFILES.find(
  (profile) => profile.capability === 'review_analysis',
)!

const NOW = Date.parse('2026-08-16T12:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-insight-read-test')
const PROPERTY_ID = propertyId('71000000-0000-4000-8000-000000000301')
const REVIEW_ID = reviewId('71000000-0000-4000-8000-000000000302')
const ACTOR_USER_ID = userId('71000000-0000-4000-8000-000000000303')
/** An Organization-wide reader: what the reads return is tested as this one. */
const ADMIN = buildTestAuthContext({
  organizationId: ORGANIZATION_ID,
  userId: ACTOR_USER_ID,
  role: 'AccountAdmin',
})
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
    property_trends: 'property-trends-runtime-v1',
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
  providerDeploymentProfileVersion: 'private-beta-global-v2',
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
  actor: ADMIN,
  sourceEpoch: 0,
  sourceRevision: 1,
  analysisSequence: 1,
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
  aspects: [{ aspect: 'service', polarity: 'negative', intensity: -80 }] as const,
  issueLabel: 'service recovery',
  generatedAtEpochMillis: NOW - 60_000,
})

type AnalysisReadRequest = Parameters<AiOutputStorePort['readAnalysisForDelivery']>[0]
type AnalysisDeliver = (result: ReviewAnalysisReadV1) => Promise<ReviewAnalysisReadV1>

function createHarness(
  options: Readonly<{
    authorization?: AiMerchantAuthorizationSnapshot | null
    runtime?: AiPropertyProfileResult
    analysisRead?: ReviewAnalysisReadV1
    storeFailure?: Error
    clock?: () => number
    /** The Properties a PropertyManager reader is granted. */
    grants?: readonly PropertyId[]
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

  const dependencies = {
    propertyAccess: async () => options.grants ?? [],
    authorization: { readMerchantAuthorization },
    outputs: {
      storeAnalysisV3: vi.fn(),
      settleEphemeralReply: vi.fn(),
      findCurrentReviewIdsByAttention: vi.fn(),
      readAnalysisForDelivery,
    },
    processingProfiles: { readForAi, refreshForAi: vi.fn() },
    nowEpochMillis: options.clock ?? (() => NOW),
    reviewAnalysisProfileVersion: REVIEW_ANALYSIS_PROFILE.profileVersion,
  } as unknown as ReadReviewAnalysisDependencies

  return {
    readReviewAnalysis: createReadReviewAnalysis(dependencies),
    deliveryCount: () => deliveries,
    mocks: {
      readAnalysisForDelivery,
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

const OTHER_PROPERTY_ID = propertyId('71000000-0000-4000-8000-000000000305')
const MANAGER = buildTestAuthContext({
  organizationId: ORGANIZATION_ID,
  role: 'PropertyManager',
})
const FOREIGN_ADMIN = buildTestAuthContext({
  organizationId: organizationId('ai-insight-read-other-organization'),
  role: 'AccountAdmin',
})
const FORBIDDEN = { _tag: 'AiError', code: 'forbidden' }

describe('who may read a review analysis', () => {
  it('refuses a manager with no grant on the Property before any AI state is read', async () => {
    const harness = createHarness({ grants: [OTHER_PROPERTY_ID] })

    await expect(
      harness.readReviewAnalysis({ ...ANALYSIS_INPUT, actor: MANAGER }),
    ).rejects.toMatchObject(FORBIDDEN)
    expect(harness.mocks.readMerchantAuthorization).not.toHaveBeenCalled()
    expect(harness.mocks.readForAi).not.toHaveBeenCalled()
    expect(harness.mocks.readAnalysisForDelivery).not.toHaveBeenCalled()
  })

  it('refuses a reader who belongs to another Organization', async () => {
    const harness = createHarness()

    await expect(
      harness.readReviewAnalysis({ ...ANALYSIS_INPUT, actor: FOREIGN_ADMIN }),
    ).rejects.toMatchObject(FORBIDDEN)
    expect(harness.mocks.readAnalysisForDelivery).not.toHaveBeenCalled()
  })

  it('refuses a reader who may read the dashboard but not the Inbox', async () => {
    const harness = createHarness()
    const dashboardOnly = createScopedAuthContext({
      organizationId: ORGANIZATION_ID,
      userId: ACTOR_USER_ID,
      permissions: [['dashboard.read', 'organization']],
    })

    await expect(
      harness.readReviewAnalysis({ ...ANALYSIS_INPUT, actor: dashboardOnly }),
    ).rejects.toMatchObject(FORBIDDEN)
    expect(harness.mocks.readAnalysisForDelivery).not.toHaveBeenCalled()
  })

  it('serves a manager granted the Property, naming that manager to the store', async () => {
    const harness = createHarness({ grants: [PROPERTY_ID] })

    await expect(
      harness.readReviewAnalysis({ ...ANALYSIS_INPUT, actor: MANAGER }),
    ).resolves.toBe(ANALYSIS_READY)
    expect(harness.mocks.readAnalysisForDelivery.mock.calls[0]?.[0]).toMatchObject({
      actorUserId: MANAGER.userId,
    })
  })
})

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
