// Dashboard context — shared utilities for server and repository layers
import type { TimeRangePreset } from './dto/dashboard.dto'
import {
  propertyWallClockAt,
  propertyWallClockToInstant,
  shiftPropertyLocalDays,
} from '#/shared/domain/property-calendar'
import { isComparisonShowable } from '../domain/portal-results-thresholds'
export const MS_PER_DAY = 86_400_000

/** Convert a time-range preset to concrete start/end dates relative to `now`.
 *  `now` is injected so callers can fast-forward time (ADR 0017). */
function presetDays(preset: Exclude<TimeRangePreset, 'all'>): number {
  switch (preset) {
    case '7d':
      return 7
    case '60d':
      return 60
    case '90d':
      return 90
    case '180d':
      return 180
    default:
      return 30
  }
}

export function timeRangeDays(preset: TimeRangePreset): number | null {
  return preset === 'all' ? null : presetDays(preset)
}

export function timeRangeToDates(preset: TimeRangePreset, now: Date, timezone = 'UTC') {
  if (preset === 'all') {
    // No start bound — epoch captures all data
    return { startDate: new Date(0), endDate: now }
  }
  const days = presetDays(preset)
  return {
    startDate: shiftPropertyLocalDays(now, -days, timezone),
    endDate: now,
  }
}

/**
 * The window a Portal's Results view reads: a bounded preset is that many whole
 * Property-local calendar days ending with today (still in progress), opening
 * at local midnight. "Last 30 days" on 30 Sep is 1-30 Sep, and its prior window
 * (`priorPeriodDates`) is the 30 local days before that, 2-31 Aug, cut at the same
 * time of day so both windows are equally long. All Time has
 * no lower bound. The same window is used wherever Results are read, so a
 * Portal's row in the overview and its own Results tab say the same thing.
 */
export function localDaysWindow(preset: TimeRangePreset, now: Date, timezone = 'UTC') {
  if (preset === 'all') return { startDate: new Date(0), endDate: now }
  const today = propertyWallClockAt(now, timezone)
  // Date.UTC normalises a day before the 1st into the previous month.
  const first = new Date(
    Date.UTC(today.year, today.month - 1, today.day - (presetDays(preset) - 1)),
  )
  return {
    startDate: propertyWallClockToInstant(
      {
        year: first.getUTCFullYear(),
        month: first.getUTCMonth() + 1,
        day: first.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
        millisecond: 0,
      },
      timezone,
    ),
    endDate: now,
  }
}

/** Compute trend percentage. Returns null when prior is 0 or result is not finite. */
export function computeTrend(current: number, prior: number): number | null {
  if (prior === 0) return null
  const result = ((current - prior) / prior) * 100
  return Number.isFinite(result) ? Math.round(result) : null
}

export const RATING_DROP_THRESHOLD = 0.3

/** Absolute star delta, available only for statistically usable periods. */
export function ratingComparison(
  currentAverage: number | null,
  currentCount: number,
  priorAverage: number | null,
  priorCount: number,
): number | null {
  if (
    currentAverage === null ||
    priorAverage === null ||
    !isComparisonShowable(currentCount, priorCount)
  ) {
    return null
  }
  return Math.round((currentAverage - priorAverage) * 10) / 10
}

// ── BQC-5.5: consolidated read-policy helpers (were inline copies ×5/×2) ──

/** Default bound for the recent-reviews list read — the dashboard's one
 *  bounded list. Named here so the use case and the repo share it. */
export const DEFAULT_RECENT_REVIEWS_LIMIT = 5

/** Prior period: the same number of local calendar days before the current period,
 *  cut to the same length. It opens `N` local days before the current start and
 *  closes `N` local days before the current end, so a window that is today-so-far
 *  (`localDaysWindow`) is compared with the same elapsed time of the days before,
 *  not with a full day it has not had yet. For a rolling window (`timeRangeToDates`)
 *  that end is the current start, so the two windows stay contiguous.
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
  timezone = 'UTC',
): { priorStartDate: Date; priorEndDate: Date } | null {
  if (preset === 'all') return null
  return {
    priorStartDate: shiftPropertyLocalDays(startDate, -presetDays(preset), timezone),
    priorEndDate: shiftPropertyLocalDays(endDate, -presetDays(preset), timezone),
  }
}
