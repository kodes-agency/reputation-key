import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_SOURCE_CANONICALIZER_PROFILE_V1,
} from '#/shared/ai-operation-profiles'
import {
  computeDeterministicTrendCandidates,
  encodeCanonicalAiPropertyTrendSource,
  renderPropertyTrendReport,
  validateTrendSelection,
  type AiPropertyTrendSource,
  type DeterministicAggregateWindow,
  type ClosedTrendSignalId,
  type DeterministicTrendCandidate,
} from '#/shared/ai-property-trend-contract'
import type { AiAuthorizationPort } from '../ports/ai-authorization.port'
import type { AiControlPort } from '../ports/ai-control.port'
import type { AiInferencePort } from '../ports/ai-inference.port'
import type { AiOperationStorePort } from '../ports/ai-operation-store.port'
import type { AiOutputStorePort } from '../ports/ai-output-store.port'
import type {
  AiPropertyAggregateStorePort,
  AiPropertyDailyAggregate,
} from '../ports/ai-property-aggregate-store.port'
import type { AiPropertyTrendScheduleStorePort } from '../ports/ai-property-trend-schedule-store.port'
import type { AiQuotaPort } from '../ports/ai-quota.port'
import type { PropertyProcessingProfilePort } from '../ports/property-processing-profile.port'
import type { AiExecutionBinding, AiOperationIdentity } from '../../domain/types'
import {
  aiRequestFingerprint,
  aiRetryAt,
  aiReviewSourceProvenance,
  resolveAiExecutionStopFence,
} from '../ai-workflow-support'

const PROFILE = AI_OPERATION_PROFILES.find(
  (candidate) => candidate.profileVersion === 'property-trend-v1',
)!
const REPORT_RETENTION_MILLIS = 730 * 24 * 60 * 60 * 1_000

export type GeneratePropertyTrendInput = Readonly<{
  scheduleId: string
}>

export type GeneratePropertyTrendResult =
  | Readonly<{ status: 'completed' | 'replayed' | 'no_data' | 'stale' }>
  | Readonly<{ status: 'retry'; retryAtEpochMillis: number; code: string }>

export type GeneratePropertyTrendDependencies = Readonly<{
  authorization: AiAuthorizationPort
  control: AiControlPort
  inference: AiInferencePort
  operations: AiOperationStorePort
  outputs: AiOutputStorePort
  aggregates: AiPropertyAggregateStorePort
  schedules: AiPropertyTrendScheduleStorePort
  quota: AiQuotaPort
  processingProfiles: PropertyProcessingProfilePort
  nowEpochMillis: () => number
}>

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function addDays(localDate: string, delta: number): string {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(localDate)
  if (match === null || !Number.isSafeInteger(delta)) {
    throw new TypeError('invalid property-local date arithmetic input')
  }
  let year = Number(match[1])
  let month = Number(match[2])
  let day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError('invalid property-local date')
  }
  let remaining = delta
  while (remaining < 0) {
    if (day > 1) day -= 1
    else {
      month -= 1
      if (month === 0) {
        year -= 1
        month = 12
      }
      day = daysInMonth(year, month)
    }
    remaining += 1
  }
  while (remaining > 0) {
    if (day < daysInMonth(year, month)) day += 1
    else {
      day = 1
      month += 1
      if (month === 13) {
        year += 1
        month = 1
      }
    }
    remaining -= 1
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

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
  if (reviewCount < 10) return null
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

    const nowEpochMillis = dependencies.nowEpochMillis()
    const profile = runtime.profile
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
    const source = Object.freeze({
      languageCode: 'en',
      currentWindow,
      baselineWindow,
      candidates,
    }) satisfies AiPropertyTrendSource
    const canonicalSource = encodeCanonicalAiPropertyTrendSource(source)
    const sourceProvenance = aiReviewSourceProvenance(canonicalSource)
    canonicalSource.fill(0)
    const stopFence = await resolveAiExecutionStopFence(dependencies.control, {
      providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
      capability: 'property_trends',
    })
    if (stopFence === null) return { status: 'stale' }
    const propertyTrendsEpoch = schedule.propertyTrendsEpoch
    const reviewAnalysisEpoch = schedule.reviewAnalysisEpoch
    const identity: AiOperationIdentity = {
      subjectKind: 'property',
      command: 'trend',
      capability: 'property_trends',
      organizationId: schedule.organizationId,
      propertyId: schedule.propertyId,
      actorId: null,
      systemPrincipal: 'property_trend_coordinator',
      sourceEpoch: schedule.sourceEpoch,
      dueLocalDate,
      terminalAnalysisSequence: schedule.terminalAnalysisSequence,
      aggregateRevision: schedule.aggregateRevision,
    }
    const binding: AiExecutionBinding = {
      authorizationLineageId: authorization.authorizationLineageId,
      noticeVersion: authorization.noticeVersion,
      noticeDigest: authorization.noticeDigest,
      capabilityFence: {
        capability: 'property_trends',
        reviewAnalysisEpoch,
        propertyTrendsEpoch,
      },
      sourceEpoch: schedule.sourceEpoch,
      evaluatedLanguage: null,
      concreteReplyLanguage: null,
      languageCatalogueDigest: null,
      replyLanguageVerifierDigest: null,
      languageScriptConsistencyDigest: null,
      zhOrthographyVerifierDigest: null,
      sourceRevision: null,
      reviewedAtEpochMillis: null,
      propertyProfileVersion: schedule.propertyProfileVersion,
      routingPolicyVersion: profile.routingPolicyVersion,
      sourcePolicyId: AI_SOURCE_CANONICALIZER_PROFILE_V1.sourcePolicyId,
      sourceCanonicalizerDigest:
        AI_SOURCE_CANONICALIZER_PROFILE_V1.sourceCanonicalizerDigest,
      redactionProfileVersion: authorization.redactionProfileFamily,
      outputLeakageProfileVersion: null,
      outputLeakageProfileDigest: null,
      replyTemplateCatalogueVersion: null,
      replyTemplateCatalogueDigest: null,
      providerDeploymentProfileVersion: authorization.providerDeploymentProfileVersion,
      operationProfileVersion: PROFILE.profileVersion,
      capabilityRuntimeProfileVersion: PROFILE.capabilityRuntimeProfileVersion!,
      aiSubjectHmacKeyVersion: null,
      stopFence,
    }
    const requestFingerprint = aiRequestFingerprint({
      scheduleId: schedule.id,
      identity,
      binding,
      currentWindow,
      baselineWindow,
      candidates,
    })
    const claimed = await dependencies.operations.claim({
      identity,
      binding,
      idempotencyKey: `trend:${schedule.id}`,
      requestFingerprint,
      sourceProvenance,
      nowEpochMillis,
      expiresAtEpochMillis: nowEpochMillis + 24 * 60 * 60 * 1_000,
    })
    if (claimed.status === 'conflict') return { status: 'stale' }
    if (
      claimed.operation.state === 'succeeded' ||
      claimed.operation.state === 'succeeded_pending_delivery'
    ) {
      return { status: 'replayed' }
    }
    const expectedAttempt = claimed.operation.executionAttempt + 1
    if (expectedAttempt > 4) return { status: 'stale' }
    const quota = await dependencies.quota.acquire({
      propertyId: schedule.propertyId,
      capability: 'property_trends',
      nowEpochMillis,
    })
    if (!quota.ok) {
      return {
        status: 'retry',
        retryAtEpochMillis: nowEpochMillis + 5_000,
        code: quota.code,
      }
    }
    try {
      const execution = await dependencies.operations.claimExecution({
        operationId: claimed.operation.id,
        expectedAttempt,
        nowEpochMillis,
      })
      if (execution === null || execution.executionPermitId === null) {
        return {
          status: 'retry',
          retryAtEpochMillis: nowEpochMillis + 1_000,
          code: 'operation_in_progress',
        }
      }
      const response = await dependencies.inference.generateTrend(
        {
          route: 'property-trend',
          operationId: execution.id,
          permitId: execution.executionPermitId,
          attemptNumber: expectedAttempt,
          organizationId: schedule.organizationId,
          propertyId: schedule.propertyId,
          internalSubjectId: schedule.propertyId,
          actorId: null,
          binding,
          deadlineEpochMillis: nowEpochMillis + PROFILE.requestDeadlineMs,
          source,
        },
        AbortSignal.timeout(PROFILE.requestDeadlineMs),
      )
      if (response.status === 'error') {
        // ONE clock read for both instants. Anchoring the backoff to the pre-call
        // `nowEpochMillis` while stamping the failure with a fresh read puts the
        // retry BEFORE the write whenever the provider call outlasts the backoff,
        // and ai_operations_attempt_valid enforces `next_attempt_at >= updated_at`,
        // so the retry write itself threw and the whole request 500'd. aiRetryAt
        // adds at least 1s, so any call slower than that inverted them.
        const failedAtEpochMillis = dependencies.nowEpochMillis()
        const retryAtEpochMillis = aiRetryAt(
          expectedAttempt,
          failedAtEpochMillis,
          response.retryAfterEpochMillis,
        )
        await dependencies.operations.recordFailure({
          operationId: execution.id,
          expectedAttempt,
          failureCode: response.code,
          retryAtEpochMillis,
          failedAtEpochMillis,
        })
        return retryAtEpochMillis === null
          ? { status: 'stale' }
          : { status: 'retry', retryAtEpochMillis, code: response.code }
      }
      if (
        response.result.selectedSignalIds.some(
          (id) => !candidates.some((candidate) => candidate.id === id),
        )
      ) {
        throw new TypeError('AI trend response selected an unknown signal')
      }
      const selectedSignalIds = validateTrendSelection({
        selectedSignalIds: response.result
          .selectedSignalIds as readonly ClosedTrendSignalId[],
        candidates,
      })
      const rendered = renderPropertyTrendReport({
        selectedSignalIds,
        candidates,
      })
      const first = candidates.find((candidate) => candidate.id === selectedSignalIds[0])!
      const completedAtEpochMillis = response.settlementReceipt.settledAtEpochMillis
      const stored = await dependencies.outputs.storeTrendReport({
        scheduleId: schedule.id,
        operationId: execution.id,
        providerCompletion: {
          expectedAttempt,
          modelSnapshot: AI_PROVIDER_DEPLOYMENT_PROFILE.modelSnapshot,
          inputTokens: response.settlementReceipt.inputTokens,
          outputTokens: response.settlementReceipt.outputTokens,
          completedAtEpochMillis,
        },
        organizationId: schedule.organizationId,
        propertyId: schedule.propertyId,
        sourceEpoch: schedule.sourceEpoch,
        reviewAnalysisEpoch,
        propertyTrendsEpoch,
        propertyProfileVersion: schedule.propertyProfileVersion,
        dueLocalDate,
        terminalAnalysisSequence: schedule.terminalAnalysisSequence,
        aggregateRevision: schedule.aggregateRevision,
        reportProfileVersion: schedule.reportProfileVersion,
        selectedSignalIds,
        report: {
          signalKey: first.id,
          // Dominant polarity from the render profile — a material mixed report
          // is never reported as 'stable'.
          direction: rendered.direction,
          // Change magnitude, not a confidence (column name is historical).
          confidenceBasisPoints: leadingSignalDeltaBasisPoints(first),
          supportingReviewCount: first.currentDenominator,
          headline: rendered.headline,
          sentences: rendered.sentences,
          summary: rendered.summary,
        },
        generatedAtEpochMillis: completedAtEpochMillis,
        expiresAtEpochMillis: completedAtEpochMillis + REPORT_RETENTION_MILLIS,
      })
      if (!stored) return { status: 'stale' }
      await dependencies.operations.markDelivered({
        operationId: execution.id,
        expectedAttempt,
        deliveredAtEpochMillis: dependencies.nowEpochMillis(),
      })
      return { status: 'completed' }
    } finally {
      await dependencies.quota.release({ quotaId: quota.quotaId })
    }
  }
}
