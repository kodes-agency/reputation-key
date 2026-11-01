// A goal's measure is named in one place and copied nowhere.
//
// `goalMetricLabel` (Reporting's) is what every goal surface calls a measure:
// the Goals page, the Portal goals' results, a group's goal card, a goal's own page,
// its forms and the name a goal is given. The Goals list, the results page under it
// and the metric select each carried a hand copy once, and a goal's page had a second
// spelling ("Private rating count" under a list that said "Private ratings").
import { describe, expect, it } from 'vitest'
import type {
  GoalMetric,
  GoalResultsMatrix as GoalResultsMatrixModel,
} from '#/contexts/reporting/application/public-api'
import { readUiSources } from '#/shared/testing/source-tree'
import { goalMetricLabel } from './goal-metric-label'
import { resultGoals } from './portal-goal-results-list-view'

const GOAL_SOURCES = [
  'src/components/goals/',
  'src/routes/_authenticated/properties/$propertyId/goals/',
] as const

/** A measure's name written out as a string of its own. */
const SPELLED_LABEL =
  /(['"`])(?:Scans|Qualified scans|Private ratings|Private rating count|Average private rating|Private rating average)\1/u

/** The files under the goal sources that own a spelling: none, Reporting owns it. */
const OWNERS: Readonly<Record<string, string>> = {}

/** The first of a month, in UTC. */
const monthStart = (month: number) => new Date(Date.UTC(2026, month - 1, 1))

/** One goal's months, newest first, each counting the measure it is given. */
function matrixOf(...metrics: readonly GoalMetric[]): GoalResultsMatrixModel {
  return {
    months: metrics.map((metric, index) => {
      const start = monthStart(9 - index)
      return {
        periodStart: start,
        periodEnd: monthStart(10 - index),
        propertyTimezone: 'UTC',
        rows: [
          {
            resultId: `result-${index}`,
            programId: 'program-1',
            assignmentId: 'assignment-1',
            scope: 'property',
            subject: { kind: 'property', propertyId: 'property-1' },
            subjectName: 'Riverside Hotel',
            metric,
            availability: 'ready',
            outcome: 'met',
            evidence: { kind: 'count', value: 40, sampleCount: 40 },
            explanation: 'Met.',
            dataThrough: start,
            resultStatus: 'closed',
            correction: null,
            targetProvenance: {
              programName: 'Monthly goal',
              programVersion: 1,
              metricDefinitionVersionId: '11111111-1111-4111-8111-111111111301',
              targetValue: 30,
              effectiveFrom: start,
              setAt: start,
            },
            monthTarget: null,
          },
        ],
      }
    }),
  }
}

const frame = { now: monthStart(10), personName: () => null }

describe("a goal's measure", () => {
  it("spells a measure only in Reporting's goal-metric-label", () => {
    const spelling = readUiSources({ includeTs: true })
      .filter((file) => GOAL_SOURCES.some((source) => file.path.startsWith(source)))
      .filter((file) => SPELLED_LABEL.test(file.text))
      .map((file) => file.path)

    expect(spelling).toEqual(Object.keys(OWNERS))
  })

  it.each(['qualified_scans', 'portal_rating_count', 'portal_rating_average'] as const)(
    'names %s in the results of a goal that counted more than one thing as the Goals list above it does',
    (metric) => {
      const other =
        metric === 'qualified_scans' ? 'portal_rating_count' : 'qualified_scans'
      const [goal] = resultGoals(matrixOf(other, metric), frame)

      const measure = goal?.measures.find((one) => one.metric === metric)
      expect(measure?.title).toBe(`Counted ${goalMetricLabel(metric).toLowerCase()}`)
    },
  )

  it.each(['qualified_scans', 'portal_rating_count'] as const)(
    'names %s on the bars of its months as the Goals list above it does',
    (metric) => {
      const [goal] = resultGoals(matrixOf(metric, metric), frame)

      expect(
        goal?.bars?.caption.startsWith(`${goalMetricLabel(metric)} each month`),
      ).toBe(true)
    },
  )

  it.each([
    ['qualified_scans', 'Scans'],
    ['portal_rating_count', 'Private ratings'],
    ['portal_rating_average', 'Average private rating'],
  ] as const)('names %s "%s" everywhere', (metric, label) => {
    expect(goalMetricLabel(metric)).toBe(label)
  })
})
