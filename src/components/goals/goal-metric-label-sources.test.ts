// A goal's measure is named in two places and copied nowhere.
//
// `goalMetricLabel` (Reporting's) is what the Goals page, a group's goal card
// and a goal's own name call a measure; `goalPageMetricLabel` is what a goal's
// own page and its forms call it. The Goals list, the results matrix under it
// and the metric select each carried a hand copy, and the matrix's copy said
// "Private rating count" under a list that said "Private ratings".
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
  /(['"`])(?:Qualified scans|Private ratings|Private rating count|Private rating average)\1/u

/** The one file under the goal sources that owns a spelling. */
const OWNERS: Readonly<Record<string, string>> = {
  'src/components/goals/goal-detail-view.ts':
    "`goalPageMetricLabel`: a goal's own page and its forms",
}

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
            ungroupedPortal: false,
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
    unassignedPortals: [],
  }
}

describe("a goal's measure", () => {
  it('is spelled by its two owners and by no other goal file', () => {
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
      // The measure is the first line of the row's second cell.
      const [, measure] = [...markup.matchAll(/<td[^>]*><span[^>]*>([^<]*)<\/span>/gu)]

      expect(measure?.[1]).toBe(goalMetricLabel(metric))
    },
  )

  it('is "Private ratings" on the Goals page, never "Private rating count"', () => {
    expect(goalMetricLabel('portal_rating_count')).toBe('Private ratings')
  })
})
