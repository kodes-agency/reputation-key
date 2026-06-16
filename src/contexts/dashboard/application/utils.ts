// Dashboard context — shared utilities for server and repository layers
import type { TimeRangePreset } from './dto/dashboard.dto'

export const MS_PER_DAY = 86_400_000

/** Convert a time-range preset to concrete start/end dates. */
export function timeRangeToDates(preset: TimeRangePreset) {
  const now = new Date()
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
