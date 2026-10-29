// What Guest voice says about the window it is showing.
//
// The window used to be whatever the URL named, 90 days unless changed, and the
// page never said how many reviews were in it. A small property holds three
// reviews with text a month, so 90 days is nine of them and every figure under
// it is an anecdote; a large one holds hundreds in 30 days. The page now picks
// the shortest window that holds enough reviews with text (the AI context does,
// `chooseEvidenceWindow`) and says so, with the count, so the figures below it can
// be weighed.
import type { AiPropertyInsightsRead } from '#/contexts/ai/application/public-api'
import { formatLocalDate, formatNumber } from '#/lib/format'
import { RANGE_PRESET_LABELS } from '#/shared/dashboard-range'

export type ReadyInsights = Extract<AiPropertyInsightsRead, { status: 'ready' }>

const PRESET_WORDS = {
  30: RANGE_PRESET_LABELS['30d'],
  90: RANGE_PRESET_LABELS['90d'],
  180: RANGE_PRESET_LABELS['180d'],
  365: RANGE_PRESET_LABELS['365d'],
} as const

/** "128 reviews with text", "1 review with text", "no reviews with text". */
function reviewsWithText(count: number): string {
  if (count === 0) return 'no reviews with text'
  return `${formatNumber(count)} ${count === 1 ? 'review' : 'reviews'} with text`
}

/**
 * One sentence naming the window and why it is that one:
 * "Last 90 days, chosen because it holds 128 reviews with text."
 */
export function windowStatement(result: ReadyInsights): string {
  const { window } = result
  const holds = reviewsWithText(window.textReviewCount)
  if (result.range === 'all') {
    const since = formatLocalDate(result.startLocalDate)
    return `${RANGE_PRESET_LABELS.all}${since === null ? '' : `, since ${since}`}. It holds ${holds}.`
  }
  const period = `Last ${PRESET_WORDS[result.range].toLowerCase()}`
  if (window.selection === 'chosen') return `${period}. It holds ${holds}.`
  if (!window.enoughForPatterns) {
    return `${period}. It holds ${holds}, too few to spot patterns.`
  }
  // 12 months is where the choice stops: shorter periods did not hold enough.
  if (result.range === 365) {
    return `${period}, chosen because no shorter period holds enough reviews with text. It holds ${formatNumber(window.textReviewCount)}.`
  }
  return `${period}, chosen because it holds ${holds}.`
}

/** "Jun 13, 2026 to Sep 10, 2026": the days the window covers, the days a drill-down opens. */
export function windowDates(result: ReadyInsights): string | null {
  const start = formatLocalDate(result.startLocalDate)
  const end = formatLocalDate(result.endLocalDate)
  return start === null || end === null ? null : `${start} to ${end}`
}
