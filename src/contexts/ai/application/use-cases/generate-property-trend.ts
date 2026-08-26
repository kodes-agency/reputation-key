import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import {
  computeDeterministicTrendCandidates,
  renderPropertyTrendReport,
  type DeterministicAggregateWindow,
  type DeterministicTrendCandidate,
} from '#/shared/ai-property-trend-contract'
import { addDays } from '../local-date'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type {
  AiPropertyAggregateStorePort,
  AiPropertyDailyAggregate,
} from '../ports/ai-property-aggregate-store.port'
import type { AiPropertyTrendScheduleStorePort } from '../ports/ai-property-trend-schedule-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'

const PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === 'property-trend-v1',
)!

export type GeneratePropertyTrendInput = Readonly<{
  scheduleId: string
}>

export type GeneratePropertyTrendResult =
  | Readonly<{ status: 'completed' | 'replayed' | 'no_data' | 'stale' }>
  | Readonly<{ status: 'retry'; retryAtEpochMillis: number; code: string }>

export type GeneratePropertyTrendDependencies = Readonly<{
  authorization: AiAuthorizationPort
  aggregates: AiPropertyAggregateStorePort
  schedules: AiPropertyTrendScheduleStorePort
  processingProfiles: PropertyProcessingProfilePort
}>

function addCounts<T extends Readonly<Record<string, number>>>(
  target: Record<string, number>,
  source: T,
): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value
  }
}

function aggregateWindow(
  days: readonly AiPropertyDailyAggregate[],
): DeterministicAggregateWindow | null {
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  const attentionCounts = { urgent: 0, high: 0, medium: 0, low: 0 }
  const categoryCounts = {
    service: 0,
    staff: 0,
    quality: 0,
    value: 0,
    cleanliness: 0,
    waitTime: 0,
    atmosphere: 0,
    location: 0,
    accessibility: 0,
    other: 0,
  }
  let reviewCount = 0
  for (const day of days) {
    reviewCount += day.reviewCount
    addCounts(sentimentCounts, day.sentimentCounts)
    addCounts(attentionCounts, day.attentionCounts)
    categoryCounts.service += day.categoryCounts.service
    categoryCounts.staff += day.categoryCounts.staff
    categoryCounts.quality += day.categoryCounts.quality
    categoryCounts.value += day.categoryCounts.value
    categoryCounts.cleanliness += day.categoryCounts.cleanliness
    categoryCounts.waitTime += day.categoryCounts.wait_time
    categoryCounts.atmosphere += day.categoryCounts.atmosphere
    categoryCounts.location += day.categoryCounts.location
    categoryCounts.accessibility += day.categoryCounts.accessibility
    categoryCounts.other += day.categoryCounts.other
  }
  if (reviewCount < 20) return null
  return {
    reviewCount,
    sentimentCounts,
    attentionCounts,
    categoryCounts,
  }
}

/**
 * Magnitude of the report's leading signal: the absolute difference between its
 * current and baseline share, in basis points, saturating at 10000 (= 100
 * percentage points). This is a CHANGE SIZE, not a confidence or probability;
 * the persisted column keeps its historical `confidence_basis_points` name.
 */
function leadingSignalDeltaBasisPoints(candidate: DeterministicTrendCandidate): number {
  const left = BigInt(candidate.currentNumerator) * BigInt(candidate.baselineDenominator)
  const right = BigInt(candidate.baselineNumerator) * BigInt(candidate.currentDenominator)
  const delta = left >= right ? left - right : right - left
  const denominator =
    BigInt(candidate.currentDenominator) * BigInt(candidate.baselineDenominator)
  if (denominator === 0n) return 0
  const basisPoints = Number((delta * 10_000n) / denominator)
  return Math.min(10_000, basisPoints)
}

export function createGeneratePropertyTrend(
  dependencies: GeneratePropertyTrendDependencies,
): (input: GeneratePropertyTrendInput) => Promise<GeneratePropertyTrendResult> {
  return async (input) => {
    const schedule = await dependencies.schedules.read(input.scheduleId)
    if (schedule === null) return { status: 'stale' }
    if (schedule.outcomeDisposition !== null) {
      return {
        status: schedule.outcomeDisposition === 'ready' ? 'replayed' : 'no_data',
      }
    }

    const scope = {
      organizationId: schedule.organizationId,
      propertyId: schedule.propertyId,
    }
    const [authorization, runtime] = await Promise.all([
      dependencies.authorization.readMerchantAuthorization(scope),
      dependencies.processingProfiles.readForAi(scope),
    ])
    if (
      authorization === null ||
      authorization.state !== 'enabled' ||
      authorization.authorizationLineageId === null ||
      !authorization.capabilities.includes('property_trends') ||
      authorization.capabilityRuntimeProfileVersions.property_trends !==
        PROFILE.capabilityRuntimeProfileVersion ||
      authorization.authorizedSourceEpoch !== schedule.sourceEpoch ||
      authorization.capabilityEpochs.review_analysis.epoch !==
        schedule.reviewAnalysisEpoch ||
      authorization.capabilityEpochs.property_trends.epoch !==
        schedule.propertyTrendsEpoch ||
      runtime.status !== 'available' ||
      runtime.profile.profileVersion !== schedule.propertyProfileVersion ||
      runtime.profile.sourceEpoch !== schedule.sourceEpoch ||
      runtime.profile.timezone !== schedule.timezone ||
      schedule.calendarProfileVersion !== 'property-calendar-v1' ||
      schedule.reportProfileVersion !== PROFILE.profileVersion
    ) {
      return { status: 'stale' }
    }

    const dueLocalDate = schedule.dueLocalDate
    const startLocalDate = addDays(dueLocalDate, -60)
    const endLocalDate = addDays(dueLocalDate, -1)
    const aggregate = await dependencies.aggregates.readWindow({
      ...scope,
      sourceEpoch: schedule.sourceEpoch,
      reviewAnalysisEpoch: schedule.reviewAnalysisEpoch,
      propertyProfileVersion: schedule.propertyProfileVersion,
      startLocalDate,
      endLocalDate,
    })
    if (
      aggregate === null ||
      aggregate.head.terminalAnalysisSequence !== schedule.terminalAnalysisSequence ||
      aggregate.head.aggregateRevision !== schedule.aggregateRevision
    ) {
      return { status: 'stale' }
    }

    const recordProviderFreeOutcome = async (
      disposition: 'insufficient_data' | 'no_material_change',
    ): Promise<GeneratePropertyTrendResult> => {
      const recorded = await dependencies.schedules.recordProviderFreeOutcome({
        scheduleId: schedule.id,
        disposition,
      })
      return { status: recorded === 'stale' ? 'stale' : 'no_data' }
    }

    const currentStart = addDays(dueLocalDate, -30)
    const baselineDays = aggregate.days.filter((day) => day.localDate < currentStart)
    const currentDays = aggregate.days.filter((day) => day.localDate >= currentStart)
    const baselineWindow = aggregateWindow(baselineDays)
    const currentWindow = aggregateWindow(currentDays)
    if (baselineWindow === null || currentWindow === null) {
      return recordProviderFreeOutcome('insufficient_data')
    }
    const candidates = computeDeterministicTrendCandidates({
      currentWindow,
      baselineWindow,
    })
    if (candidates.length === 0) {
      return recordProviderFreeOutcome('no_material_change')
    }
    const selectedSignalIds = Object.freeze(
      candidates.slice(0, 4).map((candidate) => candidate.id),
    )
    const rendered = renderPropertyTrendReport({ selectedSignalIds, candidates })
    const first = candidates[0]!
    const recorded = await dependencies.schedules.recordDeterministicReport({
      scheduleId: schedule.id,
      selectedSignalIds,
      report: {
        signalKey: first.id,
        direction: rendered.direction,
        confidenceBasisPoints: leadingSignalDeltaBasisPoints(first),
        supportingReviewCount: first.currentDenominator,
        headline: rendered.headline,
        sentences: rendered.sentences,
        summary: rendered.summary,
      },
    })
    if (recorded === 'stale') return { status: 'stale' }
    return { status: recorded === 'replayed' ? 'replayed' : 'completed' }
  }
}
