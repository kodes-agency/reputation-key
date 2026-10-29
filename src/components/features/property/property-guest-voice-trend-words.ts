// What the headline of Guest voice says in each state of the monthly comparison.
//
// The comparison of the last 30 days with the 30 before has six states, and the
// page used to draw one of them and nothing for the other five, so a property
// still being analysed, one with too few reviews and one where nothing changed
// all looked like a page without a headline. Each now says where it stands, with
// the numbers it stands on.
import type { AiTrendReportView } from '#/contexts/ai/application/public-api'
import { formatNumber } from '#/lib/format'
import {
  AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW,
  trendWindowIsIncomplete,
} from '#/shared/ai-property-trend-minimums'

type TrendWindow = Readonly<{
  period: Readonly<{ startLocalDate: string; endLocalDate: string }>
  textCandidateCount: number
  analyzedCount: number
  coverageBasisPoints: number
}>

type TrendWindows = Readonly<{ baseline: TrendWindow; current: TrendWindow }>

export type TrendWords = Readonly<{
  /** `report` is the finding itself, in the larger type; `state` says where the comparison stands. */
  kind: 'report' | 'state'
  text: string
  /** The reviews it rests on, worded; null where there are none to count yet. */
  sample: string | null
}>

const MILLIS_PER_DAY = 24 * 60 * 60 * 1_000
const FALLBACK_WINDOW_DAYS = 30

/** Days a window covers, from its own period, so the words follow the definition. */
function windowDays(window: TrendWindow): number {
  const start = Date.parse(`${window.period.startLocalDate}T00:00:00Z`)
  const end = Date.parse(`${window.period.endLocalDate}T00:00:00Z`)
  const days = Math.round((end - start) / MILLIS_PER_DAY) + 1
  return Number.isFinite(days) && days > 0 ? days : FALLBACK_WINDOW_DAYS
}

function reviews(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? 'review' : 'reviews'}`
}

function periodWords(windows: TrendWindows) {
  const days = windowDays(windows.current)
  return {
    current: `the last ${days} days`,
    baseline: `the ${windowDays(windows.baseline)} days before`,
  }
}

/** The reviews each side of the comparison rests on: "20 reviews from the last 30 days". */
function samples(windows: TrendWindows) {
  const period = periodWords(windows)
  return {
    current: `${reviews(windows.current.analyzedCount)} from ${period.current}`,
    baseline: `${formatNumber(windows.baseline.analyzedCount)} from ${period.baseline}`,
  }
}

function basedOn(windows: TrendWindows): string {
  const sample = samples(windows)
  return `Based on ${sample.current} and ${sample.baseline}.`
}

function compared(windows: TrendWindows): string {
  const sample = samples(windows)
  return `Compared ${sample.current} with ${sample.baseline}.`
}

function notEnough(windows: TrendWindows): TrendWords {
  const needed = AI_PROPERTY_TREND_MINIMUM_ANALYZED_PER_WINDOW
  const period = periodWords(windows)
  // The window that holds back the comparison is the one with fewer reviews.
  const holdsBack =
    windows.baseline.analyzedCount < windows.current.analyzedCount
      ? { window: windows.baseline, words: period.baseline }
      : { window: windows.current, words: period.current }
  return {
    kind: 'state',
    text: `Not enough reviews yet to compare months: ${formatNumber(holdsBack.window.analyzedCount)} of the ${needed} needed in ${holdsBack.words}.`,
    sample: `Reviews analysed: ${formatNumber(windows.current.analyzedCount)} in ${period.current}, ${formatNumber(windows.baseline.analyzedCount)} in ${period.baseline}.`,
  }
}

function stillAnalysing(windows: TrendWindows): TrendWords {
  const total = windows.baseline.textCandidateCount + windows.current.textCandidateCount
  const done = windows.baseline.analyzedCount + windows.current.analyzedCount
  return {
    kind: 'state',
    text: `Still analysing: ${formatNumber(done)} of ${formatNumber(total)} reviews done.`,
    sample: null,
  }
}

/**
 * The words for the comparison, or null where there is nothing to say (the
 * capability is off, or the read is not here yet).
 *
 * An Updating report whose windows are all complete is not waiting for any
 * analysis: it was recorded for a window with no text review, which the trend
 * used to call Updating and now calls insufficient data. A report stored before
 * that is read the same way, so the page is right without waiting for it to be
 * made again.
 */
export function describeTrend(trend: AiTrendReportView): TrendWords | null {
  switch (trend.status) {
    case 'disabled':
      return null
    case 'preparing':
      return {
        kind: 'state',
        text: 'The comparison with the month before is being prepared.',
        sample: null,
      }
    case 'updating': {
      const windows = trend.evidence
      if (windows === undefined) {
        return {
          kind: 'state',
          text: 'Still analysing your reviews. The comparison with the month before appears when most are done.',
          sample: null,
        }
      }
      return trendWindowIsIncomplete(windows.baseline) ||
        trendWindowIsIncomplete(windows.current)
        ? stillAnalysing(windows)
        : notEnough(windows)
    }
    case 'insufficient_data':
      return notEnough(trend.evidence)
    case 'no_material_change':
      return {
        kind: 'state',
        text: `No clear change in ${periodWords(trend.evidence).current}.`,
        sample: compared(trend.evidence),
      }
    case 'ready': {
      const sentence =
        trend.report.sentences?.[0] ?? trend.report.summary ?? trend.report.headline
      if (!sentence) return null
      return {
        kind: 'report',
        text: /[.!?]$/.test(sentence) ? sentence : `${sentence}.`,
        sample: basedOn(trend.evidence),
      }
    }
  }
}
