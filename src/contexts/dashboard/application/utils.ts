// Dashboard context — shared utilities for server and repository layers
import type { TimeRangePreset } from './dto/dashboard.dto'
export const MS_PER_DAY = 86_400_000
const MS_PER_HOUR = 3_600_000

/** SLA cutoff: reviews received before this instant are past SLA.
 *  Pure function of `now` so the SLA window is fast-forward testable (ADR 0017). */
export const slaCutoff = (now: Date, slaHours: number): Date =>
  new Date(now.getTime() - slaHours * MS_PER_HOUR)

/** Convert a time-range preset to concrete start/end dates relative to `now`.
 *  `now` is injected so callers can fast-forward time (ADR 0017). */
export function timeRangeToDates(preset: TimeRangePreset, now: Date) {
  if (preset === 'all') {
    // No start bound — epoch captures all data
    return { startDate: new Date(0), endDate: now }
  }
  const days = preset === '7d' ? 7 : preset === '60d' ? 60 : preset === '90d' ? 90 : 30
  return {
    startDate: new Date(now.getTime() - days * MS_PER_DAY),
    endDate: now,
  }
}

/** Compute trend percentage. Returns null when prior is 0 or result is not finite. */
export function computeTrend(current: number, prior: number): number | null {
  if (prior === 0) return null
  const result = ((current - prior) / prior) * 100
  return Number.isFinite(result) ? Math.round(result) : null
}

// ── BQC-5.5: consolidated read-policy helpers (were inline copies ×5/×2) ──

/** Default bound for the recent-reviews list read — the dashboard's one
 *  bounded list. Named here so the use case and the repo share it. */
export const DEFAULT_RECENT_REVIEWS_LIMIT = 5

/** Prior period: the same duration immediately before the current period.
 *  Returns null for 'all' — an unbounded window has no prior window, and the
 *  previous behaviour (returning the CURRENT window) made callers compare the
 *  period against itself: computeTrend(x, x) is 0, not null, because the
 *  `prior === 0` guard never binds. Every user saw a fabricated 0% on first
 *  load ('all' is the default preset). Pure function of its inputs (ADR 0017).
 *  Dated presets keep contiguous, non-overlapping half-open windows: the
 *  prior period ends exactly where the current period starts. */
export function priorPeriodDates(
  preset: TimeRangePreset,
  startDate: Date,
  endDate: Date,
): { priorStartDate: Date; priorEndDate: Date } | null {
  if (preset === 'all') return null
  return {
    priorStartDate: new Date(
      startDate.getTime() - (endDate.getTime() - startDate.getTime()),
    ),
    priorEndDate: new Date(startDate),
  }
}

/** A rating drop is flagged when avg rating falls ≥ this vs the prior period.
 *  Module-private: the servable contract is isRatingDrop (BQC-5.5). */
const RATING_DROP_THRESHOLD = 0.3

/** Rating-drop flag. Guards the no-prior-data false positive (priorValue 0). */
export function isRatingDrop(currentAvg: number, priorAvg: number): boolean {
  return priorAvg > 0 && priorAvg - currentAvg >= RATING_DROP_THRESHOLD
}
