import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { MERCHANT_AI_NOTICE_VERSION } from '#/shared/merchant-ai-notice-contract'
import type { AiPropertyDailyAggregate } from '../ports/ai-property-aggregate-store.port'
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

function createHarness(days: readonly AiPropertyDailyAggregate[]) {
  const recordProviderFreeOutcome = vi.fn(async () => 'recorded' as const)
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
    },
    aggregates: { readWindow },
    inference: { generateTrend },
    nowEpochMillis: () => NOW,
  } as unknown as GeneratePropertyTrendDependencies

  return {
    generate: createGeneratePropertyTrend(dependencies),
    generateTrend,
    readWindow,
    recordProviderFreeOutcome,
  }
}

describe('generate property trend', () => {
  it('records insufficient data without inference and uses pure Gregorian range bounds', async () => {
    const harness = createHarness([
      aggregateDay('2024-02-01', 9),
      aggregateDay('2024-03-01', 10),
    ])

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
    })
    expect(harness.generateTrend).not.toHaveBeenCalled()
  })

  it('records no material change without claiming quota or calling inference', async () => {
    const harness = createHarness([
      aggregateDay('2024-02-01', 10),
      aggregateDay('2024-03-01', 10),
    ])

    await expect(harness.generate({ scheduleId: SCHEDULE_ID })).resolves.toEqual({
      status: 'no_data',
    })
    expect(harness.recordProviderFreeOutcome).toHaveBeenCalledWith({
      scheduleId: SCHEDULE_ID,
      disposition: 'no_material_change',
    })
    expect(harness.generateTrend).not.toHaveBeenCalled()
  })
})
