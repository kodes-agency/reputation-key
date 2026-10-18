// A goal's measure is named in one place and copied nowhere.
//
// `goalMetricLabel` (Reporting's) is what every goal surface calls a measure:
// the Goals page, its results matrix, a group's goal card, a goal's own page,
// its forms and the name a goal is given. The Goals list, the results matrix
// under it and the metric select each carried a hand copy once, and a goal's
// page had a second spelling ("Private rating count" under a list that said
// "Private ratings").
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  GoalMetric,
  GoalResultsMatrix as GoalResultsMatrixModel,
} from '#/contexts/reporting/application/public-api'
import { readUiSources } from '#/shared/testing/source-tree'
import { goalMetricLabel } from './goal-metric-label'
import { GoalResultsMatrix } from './goal-results-matrix'

const GOAL_SOURCES = [
  'src/components/goals/',
  'src/routes/_authenticated/properties/$propertyId/goals/',
] as const

/** A measure's name written out as a string of its own. */
const SPELLED_LABEL =
  /(['"`])(?:Scans|Qualified scans|Private ratings|Private rating count|Average private rating|Private rating average)\1/u

/** The files under the goal sources that own a spelling: none, Reporting owns it. */
const OWNERS: Readonly<Record<string, string>> = {}

const MONTH_START = new Date('2026-09-01T00:00:00.000Z')

function matrixOf(metric: GoalMetric): GoalResultsMatrixModel {
  return {
    months: [
      {
        periodStart: MONTH_START,
        periodEnd: new Date('2026-10-01T00:00:00.000Z'),
        propertyTimezone: 'UTC',
        rows: [
          {
            resultId: 'result-1',
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
            dataThrough: MONTH_START,
            resultStatus: 'closed',
            correction: null,
            targetProvenance: {
              programName: 'Monthly goal',
              programVersion: 1,
              metricDefinitionVersionId: '11111111-1111-4111-8111-111111111301',
              targetValue: 30,
              effectiveFrom: MONTH_START,
              setAt: MONTH_START,
            },
            monthTarget: null,
          },
        ],
      },
    ],
  }
}

describe("a goal's measure", () => {
  it("spells a measure only in Reporting's goal-metric-label", () => {
    const spelling = readUiSources({ includeTs: true })
      .filter((file) => GOAL_SOURCES.some((source) => file.path.startsWith(source)))
      .filter((file) => SPELLED_LABEL.test(file.text))
      .map((file) => file.path)

    expect(spelling).toEqual(Object.keys(OWNERS))
  })

  it.each(['qualified_scans', 'portal_rating_count', 'portal_rating_average'] as const)(
    'reads in the results matrix as the Goals list above it names it: %s',
    (metric) => {
      const markup = renderToStaticMarkup(
        createElement(GoalResultsMatrix, {
          matrix: matrixOf(metric),
          now: MONTH_START,
          personName: () => null,
        }),
      )
      // The measure is the first line of the row's second cell, under the
      // column's name that the cell shows only where the table reflows.
      const [, measure] = [
        ...markup.matchAll(
          /<td[^>]*>(?:<span[^>]*@4xl:hidden[^>]*>[^<]*<\/span>)?<span[^>]*>([^<]*)<\/span>/gu,
        ),
      ]

      expect(measure?.[1]).toBe(goalMetricLabel(metric))
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
