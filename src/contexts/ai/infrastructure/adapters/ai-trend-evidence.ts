// Trend evidence read back from storage. A trend report's evidence is written as
// JSON by the schedule store and read here before it is delivered; this decides
// whether a stored value is still the evidence format the reader understands
// (windows, model lineage, selected signals, supporting reviews), and answers
// null for anything it is not. Moved out of the output store without changing,
// so that file can hold the v3 analysis beside the v2 one.

import {
  AI_PROPERTY_TREND_DEFINITION_DIGEST,
  AI_PROPERTY_TREND_DEFINITION_VERSION,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
  CLOSED_TREND_SIGNAL_IDS,
} from '#/shared/ai-property-trend-contract'
import type { AiTrendEvidence } from '../../application/ports/ai-output-store.port'
import { addDays } from '../../application/local-date'

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const REVIEW_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLOSED_SIGNAL_ID_SET = new Set<string>(CLOSED_TREND_SIGNAL_IDS)

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function boundedCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10_000
}

function validWindowEvidence(
  value: unknown,
  startLocalDate: string,
  endLocalDate: string,
): boolean {
  const window = objectValue(value)
  const period = objectValue(window?.period)
  if (
    window === null ||
    period?.startLocalDate !== startLocalDate ||
    period.endLocalDate !== endLocalDate ||
    !boundedCount(window.textCandidateCount) ||
    !boundedCount(window.analyzedCount) ||
    !boundedCount(window.excludedCount) ||
    !boundedCount(window.starOnlyCount) ||
    !boundedCount(window.coverageBasisPoints) ||
    window.coverageBasisPoints > 10_000 ||
    window.analyzedCount > window.textCandidateCount ||
    window.excludedCount !== window.textCandidateCount - window.analyzedCount
  ) {
    return false
  }
  const expectedCoverage =
    window.textCandidateCount === 0
      ? 0
      : Number(
          (BigInt(window.analyzedCount) * 10_000n) / BigInt(window.textCandidateCount),
        )
  return window.coverageBasisPoints === expectedCoverage
}

/** The definition, render profile, and timezone the evidence was pinned to. */
function validTrendProfile(candidate: Partial<AiTrendEvidence>): boolean {
  return (
    candidate.definitionVersion === AI_PROPERTY_TREND_DEFINITION_VERSION &&
    candidate.definitionDigest === AI_PROPERTY_TREND_DEFINITION_DIGEST &&
    candidate.renderProfileVersion === AI_TREND_RENDER_PROFILE_VERSION &&
    candidate.renderProfileDigest === AI_TREND_RENDER_PROFILE_DIGEST &&
    typeof candidate.timezone === 'string' &&
    candidate.timezone.length >= 1 &&
    candidate.timezone.length <= 100
  )
}

function validModelLineage(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 10_000 &&
    value.every((lineage) => {
      const row = objectValue(lineage)
      return (
        row !== null &&
        typeof row.analysisProfileVersion === 'string' &&
        row.analysisProfileVersion.length > 0 &&
        typeof row.providerDeploymentProfileVersion === 'string' &&
        row.providerDeploymentProfileVersion.length > 0 &&
        typeof row.modelSnapshot === 'string' &&
        row.modelSnapshot.length > 0
      )
    })
  )
}

/**
 * Every selected signal must be a closed signal id whose counts sit inside the
 * two analyzed windows and whose stored magnitude reproduces exactly from those
 * counts — the number the merchant sees is never trusted from the row.
 */
function validSelectedSignal(
  signal: unknown,
  baselineAnalyzedCount: unknown,
  currentAnalyzedCount: unknown,
): boolean {
  const row = objectValue(signal)
  const baseline = objectValue(row?.baseline)
  const current = objectValue(row?.current)
  if (
    row === null ||
    typeof row.signalId !== 'string' ||
    !CLOSED_SIGNAL_ID_SET.has(row.signalId) ||
    baseline === null ||
    current === null ||
    !boundedCount(baseline.count) ||
    !boundedCount(baseline.total) ||
    !boundedCount(current.count) ||
    !boundedCount(current.total) ||
    baseline.count > baseline.total ||
    current.count > current.total ||
    !boundedCount(row.changeMagnitudeBasisPoints) ||
    row.changeMagnitudeBasisPoints > 10_000 ||
    baseline.total !== baselineAnalyzedCount ||
    current.total !== currentAnalyzedCount
  ) {
    return false
  }
  const denominator = BigInt(baseline.total) * BigInt(current.total)
  if (denominator === 0n) return false
  const delta =
    BigInt(current.count) * BigInt(baseline.total) -
    BigInt(baseline.count) * BigInt(current.total)
  const magnitude = delta < 0n ? -delta : delta
  return row.changeMagnitudeBasisPoints === Number((magnitude * 10_000n) / denominator)
}

function validSelectedSignals(candidate: Partial<AiTrendEvidence>): boolean {
  const signals = candidate.selectedSignals
  return (
    Array.isArray(signals) &&
    signals.length <= 4 &&
    signals.every((signal) =>
      validSelectedSignal(
        signal,
        candidate.baseline?.analyzedCount,
        candidate.current?.analyzedCount,
      ),
    ) &&
    new Set(signals.map((signal) => signal.signalId)).size === signals.length
  )
}

/** Local-date bounds of the two windows the evidence covers. */
type TrendWindowBounds = Readonly<{
  baselineStart: string
  baselineEnd: string
  currentStart: string
  currentEnd: string
}>

function validSupportingReview(supporting: unknown, bounds: TrendWindowBounds): boolean {
  const row = objectValue(supporting)
  if (
    row === null ||
    typeof row.reviewId !== 'string' ||
    !REVIEW_ID_PATTERN.test(row.reviewId) ||
    (row.window !== 'baseline' && row.window !== 'current') ||
    typeof row.localDate !== 'string' ||
    !LOCAL_DATE_PATTERN.test(row.localDate) ||
    typeof row.href !== 'string' ||
    !row.href.endsWith(`/reviews?reviewId=${row.reviewId}`)
  ) {
    return false
  }
  return row.window === 'baseline'
    ? row.localDate >= bounds.baselineStart && row.localDate <= bounds.baselineEnd
    : row.localDate >= bounds.currentStart && row.localDate <= bounds.currentEnd
}

function validSupportingReviews(
  candidate: Partial<AiTrendEvidence>,
  bounds: TrendWindowBounds,
): boolean {
  const supportingReviews = candidate.supportingReviews
  return (
    Array.isArray(supportingReviews) &&
    supportingReviews.length <= 20 &&
    supportingReviews.every((supporting) => validSupportingReview(supporting, bounds)) &&
    new Set(supportingReviews.map((supporting) => supporting.reviewId)).size ===
      supportingReviews.length
  )
}

export function trendEvidence(value: unknown): AiTrendEvidence | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<AiTrendEvidence>
  if (
    typeof candidate.dataThroughLocalDate !== 'string' ||
    !LOCAL_DATE_PATTERN.test(candidate.dataThroughLocalDate)
  ) {
    return null
  }
  let bounds: TrendWindowBounds
  try {
    const currentStart = addDays(candidate.dataThroughLocalDate, -29)
    bounds = {
      baselineStart: addDays(currentStart, -30),
      baselineEnd: addDays(currentStart, -1),
      currentStart,
      currentEnd: candidate.dataThroughLocalDate,
    }
  } catch {
    return null
  }
  if (!validTrendProfile(candidate)) return null
  if (
    !validWindowEvidence(candidate.baseline, bounds.baselineStart, bounds.baselineEnd)
  ) {
    return null
  }
  if (!validWindowEvidence(candidate.current, bounds.currentStart, bounds.currentEnd)) {
    return null
  }
  if (!validModelLineage(candidate.modelLineage)) return null
  if (!validSelectedSignals(candidate)) return null
  if (!validSupportingReviews(candidate, bounds)) return null
  return candidate as AiTrendEvidence
}
