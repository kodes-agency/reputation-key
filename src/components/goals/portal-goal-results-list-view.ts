// The Portal goal results page's months, in a manager's words (pure; 2026-11-01, ADR
// 0068): each goal with its months newest first, "41 of 40" and whether it was met.
// The matrix's own read stays what decides every figure (`buildGoalResultsMatrix`);
// when a figure was final and who set the number are one tap away on its row.
import type {
  GoalMetric,
  GoalResultsMatrix,
  GoalResultsMatrixRow,
} from '#/contexts/reporting/application/public-api'
import { formatDate, formatMonthYear, formatNumber, formatShortDate } from '#/lib/format'
import type { GoalColumn } from './goal-columns-view'
import { goalMetricLabel } from './goal-metric-label'
import { goalTargetMarkerLine } from './goal-target-marker'

export type ResultVerdict = Readonly<{
  kind: 'met' | 'missed' | 'open'
  text: string
}>

export type ResultRow = Readonly<{
  key: string
  month: string
  /** "41 of 40", "4.6 · goal 4.5"; "–" with no figure. */
  result: string
  verdict: ResultVerdict
  /** Behind the row: when it was final, who set the number, and any correction. */
  details: readonly string[]
}>

export type ResultMeasure = Readonly<{
  metric: GoalMetric
  /** "Counted private ratings", said only where a goal's months counted more than one thing. */
  title: string | null
  rows: readonly ResultRow[]
}>

export type ResultGoal = Readonly<{
  key: string
  title: string
  /** Whom it counted, for a goal of one Portal or group. */
  subject: string | null
  measures: readonly ResultMeasure[]
  bars: Readonly<{ caption: string; columns: readonly GoalColumn[] }> | null
}>

type Frame = Readonly<{
  now: Date
  personName: (userId: string) => string | null
}>

type Dated = Readonly<{
  row: GoalResultsMatrixRow
  start: Date
  end: Date
  timezone: string
}>

const isAverage = (metric: GoalMetric): boolean => metric === 'portal_rating_average'

const figureOf = (metric: GoalMetric, value: number): string =>
  isAverage(metric) ? value.toFixed(1) : formatNumber(value)

function resultWords({
  evidence,
  metric,
  targetProvenance,
}: GoalResultsMatrixRow): string {
  const { value } = evidence
  const target = figureOf(metric, targetProvenance.targetValue)
  if (value === null) return '–'
  return isAverage(metric)
    ? `${figureOf(metric, value)} · goal ${target}`
    : `${figureOf(metric, value)} of ${target}`
}

function verdictOf(row: GoalResultsMatrixRow): ResultVerdict {
  const { evidence, availability, outcome, targetProvenance } = row
  if (availability === 'updating') {
    return { kind: 'open', text: 'The final figure is on its way' }
  }
  if (availability === 'insufficient_data' && evidence.kind === 'average') {
    return {
      kind: 'open',
      text: `More ratings needed: ${formatNumber(evidence.sampleCount)} of ${formatNumber(evidence.minimumSample)}`,
    }
  }
  if (availability !== 'ready' || evidence.value === null) {
    return { kind: 'open', text: 'No result for this month' }
  }
  if (outcome === 'met') return { kind: 'met', text: 'Met' }
  if (outcome === 'pending') return { kind: 'open', text: 'Still counting' }
  return {
    kind: 'missed',
    text:
      evidence.kind === 'average'
        ? 'Not met'
        : `Missed by ${formatNumber(targetProvenance.targetValue - evidence.value)}`,
  }
}

function detailsOf(
  { row, end, timezone }: Dated,
  { now, personName }: Frame,
): readonly string[] {
  const { dataThrough, targetProvenance, correction, metric, monthTarget } = row
  // A closed month's data runs up to the next month's first instant: its last day is the day before.
  const lastCounted =
    dataThrough === null
      ? null
      : new Date(Math.min(dataThrough.getTime(), end.getTime()) - 1)
  const through = lastCounted === null ? null : formatDate(lastCounted, timezone)
  // A month whose number was changed says who and when on its own line.
  const setOn =
    monthTarget === null ? formatShortDate(targetProvenance.setAt, timezone, now) : null
  const corrected =
    correction === null ? null : formatShortDate(correction.correctedAt, timezone, now)
  return [
    through === null ? null : `Counted through ${through}.`,
    `The number was ${figureOf(metric, targetProvenance.targetValue)}${setOn === null ? '' : `, set on ${setOn}`}.`,
    monthTarget === null
      ? null
      : goalTargetMarkerLine(metric, monthTarget, { timezone, now, personName }),
    corrected === null ? null : `Corrected on ${corrected}.`,
  ].filter((line): line is string => line !== null)
}

const rowOf = (dated: Dated, frame: Frame): ResultRow => ({
  key: dated.row.resultId,
  month: formatMonthYear(dated.start, dated.timezone) ?? '',
  result: resultWords(dated.row),
  verdict: verdictOf(dated.row),
  details: detailsOf(dated, frame),
})

/** The fewest months a chart is worth: one bar compares nothing. */
const MIN_BARS = 2
/** Past this many the bars start to crowd a phone. */
const MAX_BARS = 12

/** The counts of what the goal counts most lately, oldest first; none for an average. */
function barsOf(latest: readonly Dated[], metric: GoalMetric): ResultGoal['bars'] {
  if (isAverage(metric)) return null
  const counted = latest.filter(({ row }) => row.evidence.value !== null)
  if (counted.length < MIN_BARS) return null
  const label = goalMetricLabel(metric)
  return {
    caption: `${label} each month. The short line is that month’s number.`,
    columns: [...counted]
      .reverse()
      .slice(-MAX_BARS)
      .map(({ row, start, timezone }): GoalColumn => {
        const month = formatMonthYear(start, timezone) ?? ''
        const verdict = verdictOf(row)
        return {
          key: row.resultId,
          label: month.slice(0, 3),
          value: row.evidence.value,
          figure: figureOf(metric, row.evidence.value ?? 0),
          tone: verdict.kind === 'open' ? 'open' : 'since',
          mark: row.targetProvenance.targetValue,
          met: verdict.kind === 'met',
          line: `${month}: ${resultWords(row)}. ${verdict.text}.`,
        }
      }),
  }
}

const countedTitle = (metric: GoalMetric): string =>
  `Counted ${goalMetricLabel(metric).toLowerCase()}`

/**
 * Each goal with its months, newest first, in the order the matrix first names it
 * (Property, then groups, then Portals). A goal whose months counted different things
 * says what each block counted.
 */
export function resultGoals(
  matrix: GoalResultsMatrix,
  frame: Frame,
): readonly ResultGoal[] {
  const goals = new Map<string, Dated[]>()
  for (const month of matrix.months) {
    for (const row of month.rows) {
      // By name and subject: a goal stopped and set again reads as the one goal.
      const key = `${row.targetProvenance.programName}|${row.scope}|${row.subjectName}`
      const dated = {
        row,
        start: month.periodStart,
        end: month.periodEnd,
        timezone: month.propertyTimezone,
      }
      goals.set(key, [...(goals.get(key) ?? []), dated])
    }
  }
  return [...goals.entries()].flatMap(([key, months]) => {
    const [first] = months
    if (first === undefined) return []
    const metrics = [...new Set(months.map(({ row }) => row.metric))]
    const [latestMetric = first.row.metric] = metrics
    return [
      {
        key,
        title: first.row.targetProvenance.programName,
        subject: first.row.scope === 'property' ? null : first.row.subjectName,
        measures: metrics.map((metric) => ({
          metric,
          title: metrics.length > 1 ? countedTitle(metric) : null,
          rows: months
            .filter(({ row }) => row.metric === metric)
            .map((dated) => rowOf(dated, frame)),
        })),
        bars: barsOf(
          months.filter(({ row }) => row.metric === latestMetric),
          latestMetric,
        ),
      },
    ]
  })
}
