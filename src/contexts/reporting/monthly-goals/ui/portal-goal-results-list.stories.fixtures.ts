// The Portal goal results list's story fixtures (2026-11-01, ADR 0068): the results
// matrix as the read hands it in, for a Property in New York (summer time, so a month
// starts at 04:00 UTC). July 2026 with a goal in each state its months can be in; the
// numbers that read differently (one, thousands, a number set in an earlier year, one
// a manager changed, a month that was corrected); and a goal with four months, which
// is when its bars are drawn. The `.stories.` segment keeps this module out of
// production-shaped source inventories and bundles. Every shape is the read's own
// type; nothing here is worked out, only stated.
import type {
  GoalResultsMatrix,
  GoalResultsMatrixRow,
} from '#/contexts/reporting/application/public-api'

/** Aug 5, 2026: the day the list is opened, so July's days print without a year. */
export const LIST_NOW = new Date('2026-08-05T12:00:00.000Z')

const ZONE = 'America/New_York'
const SET_ON_JUN_18 = new Date('2026-06-18T15:00:00.000Z')
const SCANS_DEFINITION = '11111111-1111-4111-8111-111111111301'
const RATINGS_DEFINITION = '11111111-1111-4111-8111-111111111302'

/** The people the fixtures name; anyone else is not in the directory. */
export const listPersonName = (userId: string): string | null =>
  userId === 'marco' ? 'Marco Rossi' : null

type Month = GoalResultsMatrix['months'][number]
type Provenance = GoalResultsMatrixRow['targetProvenance']

/** A month of the Property's calendar, May to September (summer time). */
export function monthOf(yearMonth: string, rows: readonly GoalResultsMatrixRow[]): Month {
  const [year = 0, month = 0] = yearMonth.split('-').map(Number)
  return {
    periodStart: new Date(Date.UTC(year, month - 1, 1, 4)),
    periodEnd: new Date(Date.UTC(year, month, 1, 4)),
    propertyTimezone: ZONE,
    rows,
  }
}

/** The number a result is judged against, as its goal's version set it on Jun 18. */
export function provenanceOf(
  programName: string,
  targetValue: number,
  patch: Partial<Provenance> = {},
): Provenance {
  return {
    programName,
    programVersion: 1,
    metricDefinitionVersionId: SCANS_DEFINITION,
    targetValue,
    effectiveFrom: monthOf('2026-07', []).periodStart,
    setAt: SET_ON_JUN_18,
    ...patch,
  }
}

/** A closed July result of the Property's scans goal, missed with nothing counted. */
export function resultRow(
  id: string,
  overrides: Partial<GoalResultsMatrixRow> = {},
): GoalResultsMatrixRow {
  return {
    resultId: id,
    programId: `program-${id}`,
    assignmentId: `assignment-${id}`,
    scope: 'property',
    subject: { kind: 'property', propertyId: 'property-1' },
    subjectName: 'Riverside Hotel',
    metric: 'qualified_scans',
    availability: 'ready',
    outcome: 'not_met',
    evidence: { kind: 'count', value: 0, sampleCount: 0 },
    explanation: 'Not met: 0 scans, the goal was 100.',
    dataThrough: monthOf('2026-07', []).periodEnd,
    resultStatus: 'closed',
    correction: null,
    targetProvenance: provenanceOf('Monthly scans', 100),
    monthTarget: null,
    ...overrides,
  }
}

/** A Portal's row of the same month, for the goals that count one Portal. */
const portalRow = (id: string, name: string, overrides: Partial<GoalResultsMatrixRow>) =>
  resultRow(id, {
    scope: 'portal',
    subject: { kind: 'portal', portalId: `portal-${id}` },
    subjectName: name,
    ...overrides,
  })

const matrixOf = (...months: readonly Month[]): GoalResultsMatrix => ({ months })

/**
 * July, a goal in every state a month can be in: missed with nothing counted,
 * still being counted (7 so far), an average that needs more ratings (6 of 10), a
 * count that could not be read, and an average that was met.
 */
export const ALL_EVIDENCE_STATES = matrixOf(
  monthOf('2026-07', [
    resultRow('ready'),
    resultRow('updating', {
      scope: 'portal_group',
      subject: { kind: 'portal_group', portalGroupId: 'group-1' },
      subjectName: 'Front desk',
      metric: 'portal_rating_count',
      availability: 'updating',
      outcome: 'pending',
      evidence: { kind: 'count', value: 7, sampleCount: 7 },
      explanation: 'Updating: the final figure is on its way.',
      dataThrough: new Date('2026-07-20T04:00:00.000Z'),
      targetProvenance: provenanceOf('Front desk ratings', 100, {
        metricDefinitionVersionId: RATINGS_DEFINITION,
      }),
    }),
    portalRow('insufficient-data', 'Breakfast cards', {
      metric: 'portal_rating_average',
      availability: 'insufficient_data',
      outcome: 'pending',
      evidence: { kind: 'average', value: null, sampleCount: 6, minimumSample: 10 },
      explanation: 'More ratings needed: 6 of 10.',
      targetProvenance: provenanceOf('Breakfast average', 4.5),
    }),
    portalRow('temporarily-unavailable', 'Lobby NFC', {
      metric: 'portal_rating_count',
      availability: 'temporarily_unavailable',
      outcome: 'pending',
      evidence: { kind: 'count', value: null, sampleCount: 0 },
      explanation: 'Unavailable: this result cannot be decided from current evidence.',
      dataThrough: null,
      targetProvenance: provenanceOf('Lobby ratings', 100),
    }),
    portalRow('met-average', 'Spa', {
      metric: 'portal_rating_average',
      outcome: 'met',
      evidence: { kind: 'average', value: 4.6, sampleCount: 31, minimumSample: 10 },
      explanation: 'Met: 4.6 from 31 ratings, the goal was 4.5.',
      targetProvenance: provenanceOf('Spa average', 4.5),
    }),
  ]),
)

/** One is singular and a large count is grouped, in the figure and in the number. */
export const ONE_AND_THOUSANDS = matrixOf(
  monthOf('2026-07', [
    resultRow('one-rating', {
      metric: 'portal_rating_count',
      outcome: 'met',
      evidence: { kind: 'count', value: 1, sampleCount: 1 },
      explanation: 'Met: 1 private rating, the goal was 1.',
      targetProvenance: provenanceOf('Monthly ratings', 1),
    }),
    portalRow('thousands', 'Front desk QR', {
      outcome: 'met',
      evidence: { kind: 'count', value: 1234, sampleCount: 1234 },
      explanation: 'Met: 1,234 scans, the goal was 1,200.',
      targetProvenance: provenanceOf('Front desk scans', 1200),
    }),
  ]),
)

/** A number set last year, read in this one: the day prints its year. */
export const SET_IN_AN_EARLIER_YEAR = matrixOf(
  monthOf('2026-07', [
    resultRow('carried-over', {
      targetProvenance: provenanceOf('Monthly scans', 100, {
        effectiveFrom: new Date('2026-01-01T05:00:00.000Z'),
        setAt: new Date('2025-12-18T15:00:00.000Z'),
      }),
    }),
  ]),
)

/**
 * July was set at 150 in June. On Jul 20 Marco changed its number to 100, the number
 * the row is judged against and prints. A Portal's month nobody changed is beside it.
 */
export const CHANGED_IN_JULY = matrixOf(
  monthOf('2026-07', [
    resultRow('changed', {
      monthTarget: {
        changedAt: new Date('2026-07-20T15:00:00.000Z'),
        changedBy: 'marco',
        startTarget: 150,
        changeCount: 2,
      },
    }),
    portalRow('unchanged', 'Breakfast cards', {
      targetProvenance: provenanceOf('Breakfast scans', 100),
    }),
  ]),
)

/** July's figure was corrected on Aug 3, after the month closed. */
export const CORRECTED_MONTH = matrixOf(
  monthOf('2026-07', [
    resultRow('corrected', {
      outcome: 'met',
      evidence: { kind: 'count', value: 104, sampleCount: 104 },
      explanation: 'Met: 104 scans, the goal was 100.',
      correction: { revision: 2, correctedAt: new Date('2026-08-03T15:00:00.000Z') },
    }),
  ]),
)

/** One scans result of a month of the Property's calendar, closed unless said. */
function scansMonth(
  yearMonth: string,
  value: number,
  patch: Partial<GoalResultsMatrixRow>,
): Month {
  return monthOf(yearMonth, [
    resultRow(`scans-${yearMonth}`, {
      outcome: value >= 100 ? 'met' : 'not_met',
      evidence: { kind: 'count', value, sampleCount: value },
      dataThrough: monthOf(yearMonth, []).periodEnd,
      ...patch,
    }),
  ])
}

/**
 * One goal with four months, newest first: August still being counted, July 90 and
 * May 80 short of 100, June 120 over it. It has the bars.
 */
export const FOUR_MONTHS = matrixOf(
  scansMonth('2026-08', 7, {
    availability: 'updating',
    outcome: 'pending',
    dataThrough: null,
    resultStatus: 'open',
  }),
  scansMonth('2026-07', 90, {}),
  scansMonth('2026-06', 120, {}),
  scansMonth('2026-05', 80, {}),
)
