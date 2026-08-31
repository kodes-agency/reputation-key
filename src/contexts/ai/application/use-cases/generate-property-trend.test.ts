import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import type {
  AiPropertyAnalyzedReview,
  AiPropertyDailyAggregate,
} from '../ports/ai-property-aggregate-store.port'
import type { GeneratePropertyTrendDependencies } from './generate-property-trend'
import { createGeneratePropertyTrend } from './generate-property-trend'

const NOW = Date.parse('2026-08-16T12:00:00.000Z')
const ORGANIZATION_ID = organizationId('ai-trend-workflow-test')
const PROPERTY_ID = propertyId('71000000-0000-4000-8000-000000000201')
const SCHEDULE_ID = '71000000-0000-4000-8000-000000000202'
const SHA = 'a'.repeat(64)

function aggregateDay(localDate: string, reviewCount: number): AiPropertyDailyAggregate {
  return {
    localDate,
    reviewCount,
    ratingSum: reviewCount * 4,
    sentimentCounts: {
      positive: reviewCount,
      neutral: 0,
      negative: 0,
      mixed: 0,
    },
    categoryCounts: {
      service: reviewCount,
      staff: 0,
      quality: 0,
      value: 0,
      cleanliness: 0,
      wait_time: 0,
      atmosphere: 0,
      location: 0,
      accessibility: 0,
      other: 0,
    },
    attentionCounts: { urgent: 0, high: 0, medium: 0, low: reviewCount },
  }
}

function trendDay(localDate: string, positiveCount: number): AiPropertyDailyAggregate {
  return {
    localDate,
    reviewCount: 20,
    ratingSum: 80,
    sentimentCounts: {
      positive: positiveCount,
      neutral: 20 - positiveCount,
      negative: 0,
      mixed: 0,
    },
    categoryCounts: {
      service: 2,
      staff: 18,
      quality: 0,
      value: 0,
      cleanliness: 0,
      wait_time: 0,
      atmosphere: 0,
      location: 0,
      accessibility: 0,
      other: 0,
    },
    attentionCounts: { urgent: 0, high: 0, medium: 0, low: 20 },
  }
}

function populationReview(localDate: string, sequence: number, hasText = true) {
  return {
    reviewId: `71000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate,
    hasText,
  }
}

function analyzedReview(
  localDate: string,
  sequence: number,
  positive: boolean,
): AiPropertyAnalyzedReview {
  return {
    reviewId: populationReview(localDate, sequence).reviewId as never,
    sourceRevision: 1,
    analysisSequence: sequence,
    localDate,
    sentiment: positive ? 'positive' : 'neutral',
    primaryCategory: sequence % 10 === 0 ? 'service' : 'staff',
    attention: 'low',
    analysisProfileVersion: 'review-analysis-v1',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
    modelSnapshot: 'gpt-5.4-mini-2026-03-17',
  }
}

function defaultEvidence() {
  const baselineDate = '2024-02-01'
  const currentDate = '2024-03-01'
  return {
    population: [
      ...Array.from({ length: 20 }, (_, index) =>
        populationReview(baselineDate, index + 1),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        populationReview(currentDate, index + 101),
      ),
      populationReview(baselineDate, 201, false),
      populationReview(currentDate, 202, false),
    ],
    analyzed: [
      ...Array.from({ length: 20 }, (_, index) =>
        analyzedReview(baselineDate, index + 1, index < 2),
      ),
      ...Array.from({ length: 20 }, (_, index) =>
        analyzedReview(currentDate, index + 101, index < 8),
      ),
    ],
  }
}

function createHarness(
  days: readonly AiPropertyDailyAggregate[],
  evidence = defaultEvidence(),
) {
  const recordProviderFreeOutcome = vi.fn(async () => 'recorded' as const)
  const recordDeterministicReport = vi.fn(async () => 'recorded' as const)
  const readWindow = vi.fn(async () => ({
    head: {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      sourceEpoch: 2,
      reviewAnalysisEpoch: 3,
      propertyProfileVersion: 4,
      aggregateRevision: 6,
      terminalAnalysisSequence: 5,
    },
    days,
    analyzedReviews: evidence.analyzed,
  }))
  const readTrendPopulation = vi.fn(async () => ({
    status: 'complete' as const,
    reviews: evidence.population,
  }))
  const generateTrend = vi.fn()
  const schedule = {
    id: SCHEDULE_ID,
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    dueLocalDate: '2024-03-31',
    sourceEpoch: 2,
    reviewAnalysisEpoch: 3,
    propertyTrendsEpoch: 7,
    propertyProfileVersion: 4,
    terminalAnalysisSequence: 5,
    aggregateRevision: 6,
    timezone: 'America/New_York',
    calendarProfileVersion: 'property-calendar-v1' as const,
    reportProfileVersion: 'property-trend-v1' as const,
    schedulerGeneration: 1,
    scheduledAtEpochMillis: NOW,
    outcomeDisposition: null,
  }
  const dependencies = {
    authorization: {
      readMerchantAuthorization: vi.fn(async () => ({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        state: 'enabled' as const,
        stateVersion: 1,
        authorizationLineageId: '71000000-0000-4000-8000-000000000203',
        authorizedSourceEpoch: 2,
        capabilities: ['review_analysis', 'property_trends'] as const,
        capabilityRuntimeProfileVersions: {
          review_analysis: 'review-analysis-runtime-v1',
          property_trends: 'property-trends-runtime-v1',
        },
        capabilityEpochs: {
          review_analysis: { epoch: 3, changedAtEpochMillis: NOW },
          reply_drafting: { epoch: 1, changedAtEpochMillis: NOW },
          property_trends: { epoch: 7, changedAtEpochMillis: NOW },
        },
        reviewAnalysisStartSequence: 1,
        noticeVersion: MERCHANT_AI_NOTICE_VERSION,
        noticeDigest: SHA,
        sourcePolicyId: 'google-business-profile-source-policy-v1',
        sourceCanonicalizerDigest: SHA,
        redactionProfileFamily: 'gbp-review-global-v1',
        providerDeploymentProfileVersion: 'private-beta-global-v1',
      })),
    },
    processingProfiles: {
      readForAi: vi.fn(async () => ({
        status: 'available' as const,
        profile: {
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          countryCode: 'US',
          timezone: 'America/New_York',
          processingRegion: 'global' as const,
          routingPolicyVersion: 1,
          sourceEpoch: 2,
          profileVersion: 4,
          lifecycleState: 'active' as const,
        },
      })),
    },
    schedules: {
      read: vi.fn(async () => schedule),
      recordProviderFreeOutcome,
      recordDeterministicReport,
    },
    aggregates: { readWindow },
    reviewSources: { readTrendPopulation },
    inference: { generateTrend },
    nowEpochMillis: () => NOW,
  } as unknown as GeneratePropertyTrendDependencies

  return {
    generate: createGeneratePropertyTrend(dependencies),
    generateTrend,
    readWindow,
    readTrendPopulation,
    recordProviderFreeOutcome,
    recordDeterministicReport,
  }
}

describe('generate property trend', () => {
  it('records insufficient data without inference and uses pure Gregorian range bounds', async () => {
    const evidence = defaultEvidence()
    evidence.population.splice(19, 1)
    evidence.analyzed.splice(19, 1)
    const harness = createHarness(
      [aggregateDay('2024-02-01', 19), aggregateDay('2024-03-01', 20)],
      evidence,
    )

    await expect(harness.generate({ scheduleId: SCHEDULE_ID })).resolves.toEqual({
      status: 'no_data',
    })
    expect(harness.readWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        startLocalDate: '2024-01-31',
        endLocalDate: '2024-03-30',
      }),
    )
    expect(harness.recordProviderFreeOutcome).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      disposition: 'insufficient_data',
      evidence: expect.objectContaining({
        timezone: 'America/New_York',
        dataThroughLocalDate: '2024-03-30',
        baseline: expect.objectContaining({
          period: { startLocalDate: '2024-01-31', endLocalDate: '2024-02-29' },
          analyzedCount: 19,
          starOnlyCount: 1,
        }),
        current: expect.objectContaining({
          period: { startLocalDate: '2024-03-01', endLocalDate: '2024-03-30' },
          analyzedCount: 20,
          starOnlyCount: 1,
        }),
      }),
    })
    expect(harness.generateTrend).not.toHaveBeenCalled()
  })

  it('records no material change without claiming quota or calling inference', async () => {
    const harness = createHarness([
      aggregateDay('2024-02-01', 20),
      aggregateDay('2024-03-01', 20),
    ])

    await expect(harness.generate({ scheduleId: SCHEDULE_ID })).resolves.toEqual({
      status: 'no_data',
    })
    expect(harness.recordProviderFreeOutcome).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      disposition: 'no_material_change',
      evidence: expect.objectContaining({
        baseline: expect.objectContaining({ coverageBasisPoints: 10_000 }),
        current: expect.objectContaining({ coverageBasisPoints: 10_000 }),
      }),
    })
    expect(harness.generateTrend).not.toHaveBeenCalled()
  })

  it('commits the deterministically ranked report without calling inference', async () => {
    const harness = createHarness([trendDay('2024-02-01', 2), trendDay('2024-03-01', 8)])

    await expect(harness.generate({ scheduleId: SCHEDULE_ID })).resolves.toEqual({
      status: 'completed',
    })
    expect(harness.recordDeterministicReport).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: SCHEDULE_ID,
        selectedSignalIds: expect.arrayContaining(['sentiment.positive.up']),
        report: expect.objectContaining({
          signalKey: 'sentiment.neutral.down',
          direction: 'improving',
          changeMagnitudeBasisPoints: 3000,
        }),
        evidence: expect.objectContaining({
          definitionVersion: 'property-trend-definition-v1',
          baseline: expect.objectContaining({
            textCandidateCount: 20,
            analyzedCount: 20,
            excludedCount: 0,
            starOnlyCount: 1,
            coverageBasisPoints: 10_000,
          }),
          current: expect.objectContaining({
            textCandidateCount: 20,
            analyzedCount: 20,
            excludedCount: 0,
            starOnlyCount: 1,
            coverageBasisPoints: 10_000,
          }),
          modelLineage: [
            {
              analysisProfileVersion: 'review-analysis-v1',
              providerDeploymentProfileVersion: 'private-beta-global-v1',
              modelSnapshot: 'gpt-5.4-mini-2026-03-17',
            },
          ],
          selectedSignals: expect.arrayContaining([
            expect.objectContaining({
              signalId: 'sentiment.neutral.down',
              baseline: { count: 18, total: 20 },
              current: { count: 12, total: 20 },
              changeMagnitudeBasisPoints: 3000,
            }),
          ]),
          supportingReviews: expect.arrayContaining([
            expect.objectContaining({
              window: 'current',
              localDate: '2024-03-01',
            }),
          ]),
        }),
      }),
    )
    expect(harness.generateTrend).not.toHaveBeenCalled()
  })

  it('records Updating instead of a complete result below ninety-percent coverage', async () => {
    const evidence = defaultEvidence()
    evidence.population.splice(
      20,
      0,
      populationReview('2024-02-01', 301),
      populationReview('2024-02-01', 302),
      populationReview('2024-02-01', 303),
    )
    const harness = createHarness(
      [aggregateDay('2024-02-01', 20), aggregateDay('2024-03-01', 20)],
      evidence,
    )

    await expect(harness.generate({ scheduleId: SCHEDULE_ID })).resolves.toEqual({
      status: 'no_data',
    })
    expect(harness.recordProviderFreeOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: 'updating',
        evidence: expect.objectContaining({
          baseline: expect.objectContaining({
            textCandidateCount: 23,
            analyzedCount: 20,
            excludedCount: 3,
            coverageBasisPoints: 8695,
          }),
        }),
      }),
    )
    expect(harness.recordDeterministicReport).not.toHaveBeenCalled()
  })

  it('excludes the current partial local day from every count and supporting link', async () => {
    const evidence = defaultEvidence()
    evidence.population.push(populationReview('2024-03-31', 401))
    evidence.analyzed.push(analyzedReview('2024-03-31', 401, true))
    const harness = createHarness(
      [trendDay('2024-02-01', 2), trendDay('2024-03-01', 8), trendDay('2024-03-31', 20)],
      evidence,
    )

    await harness.generate({ scheduleId: SCHEDULE_ID })

    expect(harness.recordDeterministicReport).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          current: expect.objectContaining({ analyzedCount: 20 }),
          supportingReviews: expect.not.arrayContaining([
            expect.objectContaining({ localDate: '2024-03-31' }),
          ]),
        }),
      }),
    )
  })
})
