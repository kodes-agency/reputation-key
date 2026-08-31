import { AI_OPERATION_PROFILES } from '#/shared/ai-operation-profiles'
import {
  AI_PROPERTY_TREND_DEFINITION_DIGEST,
  AI_PROPERTY_TREND_DEFINITION_VERSION,
  AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW,
  AI_PROPERTY_TREND_MINIMUM_COVERAGE_BASIS_POINTS,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
  computeDeterministicTrendCandidates,
  renderPropertyTrendReport,
  type DeterministicAggregateWindow,
  type DeterministicTrendCandidate,
} from '#/shared/ai-property-trend-contract'
import { addDays } from '../local-date'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type {
  AiPropertyAnalyzedReview,
  AiPropertyAggregateStorePort,
  AiPropertyDailyAggregate,
} from '../ports/ai-property-aggregate-store.port'
import type { AiPropertyTrendScheduleStorePort } from '../ports/ai-property-trend-schedule-store.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type {
  AiTrendEvidence,
  AiTrendModelLineage,
  AiTrendSelectedSignalEvidence,
  AiTrendSupportingReview,
  AiTrendWindowEvidence,
} from '../ports/ai-output-store.port'

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
  reviewSources: AiReviewSourcePort
  nowEpochMillis: () => number
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
): DeterministicAggregateWindow {
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
  return {
    reviewCount,
    sentimentCounts,
    attentionCounts,
    categoryCounts,
  }
}

type TrendPeriod = Readonly<{ startLocalDate: string; endLocalDate: string }>

function inPeriod(localDate: string, period: TrendPeriod): boolean {
  return localDate >= period.startLocalDate && localDate <= period.endLocalDate
}

function reviewVersionKey(
  input: Readonly<{
    reviewId: string
    sourceRevision: number
    analysisSequence: number
  }>,
): string {
  return `${input.reviewId}:${input.sourceRevision}:${input.analysisSequence}`
}

function coverageBasisPoints(analyzedCount: number, candidateCount: number): number {
  if (candidateCount === 0) return 0
  return Number((BigInt(analyzedCount) * 10_000n) / BigInt(candidateCount))
}

function buildWindowEvidence(
  period: TrendPeriod,
  population: readonly Readonly<{
    reviewId: string
    sourceRevision: number
    analysisSequence: number
    localDate: string
    hasText: boolean
  }>[],
  analyzedByVersion: ReadonlyMap<string, AiPropertyAnalyzedReview>,
): Readonly<{
  evidence: AiTrendWindowEvidence
  analyzed: readonly AiPropertyAnalyzedReview[]
}> {
  const reviews = population.filter((review) => inPeriod(review.localDate, period))
  const textCandidates = reviews.filter((review) => review.hasText)
  const analyzed = textCandidates.flatMap((candidate) => {
    const current = analyzedByVersion.get(reviewVersionKey(candidate))
    return current === undefined || !inPeriod(current.localDate, period) ? [] : [current]
  })
  return Object.freeze({
    evidence: Object.freeze({
      period,
      textCandidateCount: textCandidates.length,
      analyzedCount: analyzed.length,
      excludedCount: textCandidates.length - analyzed.length,
      starOnlyCount: reviews.length - textCandidates.length,
      coverageBasisPoints: coverageBasisPoints(analyzed.length, textCandidates.length),
    }),
    analyzed: Object.freeze(analyzed),
  })
}

function modelLineage(
  reviews: readonly AiPropertyAnalyzedReview[],
): readonly AiTrendModelLineage[] {
  const lineage = new Map<string, AiTrendModelLineage>()
  for (const review of reviews) {
    const value = Object.freeze({
      analysisProfileVersion: review.analysisProfileVersion,
      providerDeploymentProfileVersion: review.providerDeploymentProfileVersion,
      modelSnapshot: review.modelSnapshot,
    })
    lineage.set(
      `${value.analysisProfileVersion}:${value.providerDeploymentProfileVersion}:${value.modelSnapshot}`,
      value,
    )
  }
  return Object.freeze(
    [...lineage.values()].sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    ),
  )
}

function selectedSignalEvidence(
  candidates: readonly DeterministicTrendCandidate[],
): readonly AiTrendSelectedSignalEvidence[] {
  return Object.freeze(
    candidates.map((candidate) =>
      Object.freeze({
        signalId: candidate.id,
        baseline: Object.freeze({
          count: candidate.baselineNumerator,
          total: candidate.baselineDenominator,
        }),
        current: Object.freeze({
          count: candidate.currentNumerator,
          total: candidate.currentDenominator,
        }),
        changeMagnitudeBasisPoints: leadingSignalDeltaBasisPoints(candidate),
      }),
    ),
  )
}

function reviewMatchesSignal(
  review: AiPropertyAnalyzedReview,
  signalId: string,
): boolean {
  const [family, name] = signalId.split('.')
  if (family === 'sentiment') return review.sentiment === name
  if (family === 'attention') return review.attention === name
  if (family === 'category') {
    return review.primaryCategory === (name === 'wait_time' ? 'wait_time' : name)
  }
  return false
}

function supportingReviews(
  propertyId: string,
  selected: readonly DeterministicTrendCandidate[],
  baseline: readonly AiPropertyAnalyzedReview[],
  current: readonly AiPropertyAnalyzedReview[],
): readonly AiTrendSupportingReview[] {
  const result = new Map<string, AiTrendSupportingReview>()
  for (const candidate of selected) {
    const window = candidate.id.endsWith('.up') ? 'current' : 'baseline'
    const source = window === 'current' ? current : baseline
    for (const review of source) {
      if (!reviewMatchesSignal(review, candidate.id) || result.has(review.reviewId)) {
        continue
      }
      result.set(
        review.reviewId,
        Object.freeze({
          reviewId: review.reviewId,
          window,
          localDate: review.localDate,
          href: `/properties/${propertyId}/reviews?reviewId=${review.reviewId}`,
        }),
      )
      if (result.size === 20) return Object.freeze([...result.values()])
    }
  }
  return Object.freeze([...result.values()])
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

type TrendSchedule = NonNullable<
  Awaited<ReturnType<AiPropertyTrendScheduleStorePort['read']>>
>
type MerchantAuthorization = Awaited<
  ReturnType<AiAuthorizationPort['readMerchantAuthorization']>
>
type PropertyProcessingProfileRead = Awaited<
  ReturnType<PropertyProcessingProfilePort['readForAi']>
>

/**
 * A schedule may only be generated while the authorization, its capability
 * runtime profile, and the property processing profile all still match the
 * exact epochs and versions the schedule was created against. Anything else is
 * a stale schedule, not a failure.
 */
function scheduleInputsAreCurrent(
  schedule: TrendSchedule,
  authorization: MerchantAuthorization,
  runtime: PropertyProcessingProfileRead,
): boolean {
  return (
    authorization !== null &&
    authorization.state === 'enabled' &&
    authorization.authorizationLineageId !== null &&
    authorization.capabilities.includes('property_trends') &&
    authorization.capabilityRuntimeProfileVersions.property_trends ===
      PROFILE.capabilityRuntimeProfileVersion &&
    authorization.authorizedSourceEpoch === schedule.sourceEpoch &&
    authorization.capabilityEpochs.review_analysis.epoch ===
      schedule.reviewAnalysisEpoch &&
    authorization.capabilityEpochs.property_trends.epoch ===
      schedule.propertyTrendsEpoch &&
    runtime.status === 'available' &&
    runtime.profile.profileVersion === schedule.propertyProfileVersion &&
    runtime.profile.sourceEpoch === schedule.sourceEpoch &&
    runtime.profile.timezone === schedule.timezone &&
    schedule.calendarProfileVersion === 'property-calendar-v1' &&
    schedule.reportProfileVersion === PROFILE.profileVersion
  )
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
    if (!scheduleInputsAreCurrent(schedule, authorization, runtime)) {
      return { status: 'stale' }
    }

    const dueLocalDate = schedule.dueLocalDate
    const startLocalDate = addDays(dueLocalDate, -60)
    const endLocalDate = addDays(dueLocalDate, -1)
    const [aggregate, population] = await Promise.all([
      dependencies.aggregates.readWindow({
        ...scope,
        sourceEpoch: schedule.sourceEpoch,
        reviewAnalysisEpoch: schedule.reviewAnalysisEpoch,
        propertyProfileVersion: schedule.propertyProfileVersion,
        startLocalDate,
        endLocalDate,
      }),
      dependencies.reviewSources.readTrendPopulation({
        ...scope,
        sourceEpoch: schedule.sourceEpoch,
        timezone: schedule.timezone,
        calendarProfileVersion: schedule.calendarProfileVersion,
        startLocalDate,
        endLocalDate,
        limit: 10_001,
      }),
    ])
    if (
      aggregate === null ||
      aggregate.head.terminalAnalysisSequence !== schedule.terminalAnalysisSequence ||
      aggregate.head.aggregateRevision !== schedule.aggregateRevision
    ) {
      return {
        status: 'retry',
        retryAtEpochMillis: dependencies.nowEpochMillis() + 60_000,
        code: 'trend_sequence_or_aggregate_gap',
      }
    }
    if (population.status !== 'complete') {
      return {
        status: 'retry',
        retryAtEpochMillis: dependencies.nowEpochMillis() + 60_000,
        code: `trend_population_${population.status}`,
      }
    }

    const recordProviderFreeOutcome = async (
      disposition: 'updating' | 'insufficient_data' | 'no_material_change',
      evidence: AiTrendEvidence,
    ): Promise<GeneratePropertyTrendResult> => {
      const recorded = await dependencies.schedules.recordProviderFreeOutcome({
        scheduleId: schedule.id,
        disposition,
        evidence,
      })
      return { status: recorded === 'stale' ? 'stale' : 'no_data' }
    }

    const currentStart = addDays(dueLocalDate, -30)
    const baselinePeriod = Object.freeze({
      startLocalDate,
      endLocalDate: addDays(currentStart, -1),
    })
    const currentPeriod = Object.freeze({
      startLocalDate: currentStart,
      endLocalDate,
    })
    const baselineDays = aggregate.days.filter((day) =>
      inPeriod(day.localDate, baselinePeriod),
    )
    const currentDays = aggregate.days.filter((day) =>
      inPeriod(day.localDate, currentPeriod),
    )
    const baselineWindow = aggregateWindow(baselineDays)
    const currentWindow = aggregateWindow(currentDays)
    const analyzedByVersion = new Map(
      aggregate.analyzedReviews.map((review) => [reviewVersionKey(review), review]),
    )
    const baseline = buildWindowEvidence(
      baselinePeriod,
      population.reviews,
      analyzedByVersion,
    )
    const current = buildWindowEvidence(
      currentPeriod,
      population.reviews,
      analyzedByVersion,
    )
    if (
      baselineWindow.reviewCount !== baseline.evidence.analyzedCount ||
      currentWindow.reviewCount !== current.evidence.analyzedCount
    ) {
      return {
        status: 'retry',
        retryAtEpochMillis: dependencies.nowEpochMillis() + 60_000,
        code: 'trend_evidence_reconciling',
      }
    }
    const baseEvidence = Object.freeze({
      definitionVersion: AI_PROPERTY_TREND_DEFINITION_VERSION,
      definitionDigest: AI_PROPERTY_TREND_DEFINITION_DIGEST,
      renderProfileVersion: AI_TREND_RENDER_PROFILE_VERSION,
      renderProfileDigest: AI_TREND_RENDER_PROFILE_DIGEST,
      timezone: schedule.timezone,
      dataThroughLocalDate: endLocalDate,
      baseline: baseline.evidence,
      current: current.evidence,
      modelLineage: modelLineage([...baseline.analyzed, ...current.analyzed]),
    })
    const evidenceWithoutSignals = (): AiTrendEvidence =>
      Object.freeze({
        ...baseEvidence,
        selectedSignals: Object.freeze([]),
        supportingReviews: Object.freeze([]),
      })
    if (
      baseline.evidence.coverageBasisPoints <
        AI_PROPERTY_TREND_MINIMUM_COVERAGE_BASIS_POINTS ||
      current.evidence.coverageBasisPoints <
        AI_PROPERTY_TREND_MINIMUM_COVERAGE_BASIS_POINTS
    ) {
      return recordProviderFreeOutcome('updating', evidenceWithoutSignals())
    }
    if (
      baseline.evidence.analyzedCount < AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW ||
      current.evidence.analyzedCount < AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW
    ) {
      return recordProviderFreeOutcome('insufficient_data', evidenceWithoutSignals())
    }
    const candidates = computeDeterministicTrendCandidates({
      currentWindow,
      baselineWindow,
    })
    if (candidates.length === 0) {
      return recordProviderFreeOutcome('no_material_change', evidenceWithoutSignals())
    }
    const selectedSignalIds = Object.freeze(
      candidates.slice(0, 4).map((candidate) => candidate.id),
    )
    const rendered = renderPropertyTrendReport({ selectedSignalIds, candidates })
    const first = candidates[0]!
    const selectedCandidates = candidates.slice(0, 4)
    const evidence: AiTrendEvidence = Object.freeze({
      ...baseEvidence,
      selectedSignals: selectedSignalEvidence(selectedCandidates),
      supportingReviews: supportingReviews(
        schedule.propertyId,
        selectedCandidates,
        baseline.analyzed,
        current.analyzed,
      ),
    })
    const recorded = await dependencies.schedules.recordDeterministicReport({
      scheduleId: schedule.id,
      selectedSignalIds,
      evidence,
      report: {
        signalKey: first.id,
        direction: rendered.direction,
        changeMagnitudeBasisPoints: leadingSignalDeltaBasisPoints(first),
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
