// Portal goals for the results page's stories and its view test (PLAN PG-18);
// the `.stories.` segment keeps this module out of production-shaped source
// inventories and bundles.
//
// Seaview Hotel on Dec 3, 2026, on a UTC calendar: the Monthly portal goal,
// 40 private ratings since October (October met with 41, November not met with
// 36, December running), and the scans goal it took over from, stopped on
// Sep 12 by Elena (August met, September not met). The Reception goal ended
// in 2025, and an old Spa goal ended before its day was kept.
import {
  buildGoalResultsMatrix,
  type GoalMetric,
  type GoalSubject,
} from '#/contexts/reporting/application/public-api'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
} from '#/contexts/reporting/application/ports/goal-program.repository'
import { goalAssignmentSubjectLabel } from './goal-assignment-subject-label'
import { endedPortalGoals } from './portal-goal-results-view'

export const SEAVIEW = { propertyId: 'property-seaview', name: 'Seaview Hotel' } as const
export const RESULTS_NOW = new Date('2026-12-03T10:00:00.000Z')
const ZONE = 'UTC'

const PORTALS = [
  { id: 'portal-reception', name: 'Reception' },
  { id: 'portal-spa', name: 'Spa' },
] as const
const GROUPS: readonly Readonly<{ id: string; name: string }>[] = []

const PROPERTY: GoalSubject = { kind: 'property', propertyId: SEAVIEW.propertyId }
const portalSubject = (portalId: string): GoalSubject => ({ kind: 'portal', portalId })

/** The UTC calendar month that starts on the 1st of `yearMonth` ("2026-10"). */
const month = (yearMonth: string) => {
  const start = new Date(`${yearMonth}-01T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return { start, end }
}

type MonthFact =
  | Readonly<{ yearMonth: string; open: true }>
  | Readonly<{ yearMonth: string; value: number; achieved: boolean }>

type GoalShape = Readonly<{
  id: string
  name: string
  metric: GoalMetric
  target: number
  subject: GoalSubject
  from: string
  months?: readonly MonthFact[]
  ended?: Readonly<{ at: Date | null; by?: string }>
}>

function resultOf(
  shape: GoalShape,
  versionId: string,
  fact: MonthFact,
): GoalMonthlyResult {
  const { start, end } = month(fact.yearMonth)
  const closed = !('open' in fact)
  return {
    id: `result-${shape.id}-${fact.yearMonth}`,
    assignmentId: `assignment-${shape.id}`,
    programId: shape.id,
    programVersionId: versionId,
    organizationId: 'org-1',
    propertyId: SEAVIEW.propertyId,
    periodStart: start,
    periodEnd: end,
    propertyTimezone: ZONE,
    status: closed ? 'closed' : 'open',
    targetValue: null,
    evaluation: closed
      ? {
          state: 'eligible',
          value: fact.value,
          sampleCount: fact.value,
          achieved: fact.achieved,
          reason: null,
        }
      : {
          state: 'updating',
          value: null,
          sampleCount: 0,
          achieved: null,
          reason: 'period_open',
        },
    sourceCompleteThrough: closed ? end : null,
    evaluationWatermark: closed ? end : null,
    closedAt: closed ? new Date(end.getTime() + 26 * 3_600_000) : null,
    createdAt: start,
    updatedAt: start,
  }
}

/** One Portal goal, one version and one subject, with the months it has a result for. */
export function portalGoalBundle(shape: GoalShape): GoalProgramBundle {
  const from = month(shape.from).start
  const createdAt = new Date(from.getTime() - 10 * 86_400_000)
  const version: GoalProgramVersion = {
    id: `version-${shape.id}`,
    programId: shape.id,
    organizationId: 'org-1',
    propertyId: SEAVIEW.propertyId,
    version: 1,
    metricDefinitionId: `definition-${shape.metric}`,
    metricDefinitionVersionId: `definition-version-${shape.metric}`,
    metric: shape.metric,
    metricMinimumSample: shape.metric === 'portal_rating_average' ? 10 : 0,
    targetValue: shape.target,
    propertyTimezone: ZONE,
    effectiveFrom: from,
    effectiveTo: null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt,
  }
  const endedAt = shape.ended?.at ?? null
  return {
    program: {
      id: shape.id,
      organizationId: 'org-1',
      propertyId: SEAVIEW.propertyId,
      name: shape.name,
      description: null,
      status: shape.ended === undefined ? 'active' : 'ended',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt,
      updatedAt: endedAt ?? createdAt,
      ...(endedAt === null ? {} : { endedAt, endedBy: shape.ended?.by ?? 'elena' }),
    },
    version,
    versions: [version],
    assignments: [
      {
        id: `assignment-${shape.id}`,
        programId: shape.id,
        programVersionId: version.id,
        organizationId: 'org-1',
        propertyId: SEAVIEW.propertyId,
        metric: shape.metric,
        subject: shape.subject,
        effectiveFrom: from,
        effectiveTo: null,
        createdBy: 'elena',
        createdAt,
      },
    ],
    results: (shape.months ?? []).map((fact) => resultOf(shape, version.id, fact)),
    targetChanges: [],
  }
}

/** The Monthly portal goal: October met, November not met, December running. */
export const MONTHLY_GOAL = portalGoalBundle({
  id: 'goal-monthly',
  name: 'Monthly portal goal',
  metric: 'portal_rating_count',
  target: 40,
  subject: PROPERTY,
  from: '2026-10',
  months: [
    { yearMonth: '2026-10', value: 41, achieved: true },
    { yearMonth: '2026-11', value: 36, achieved: false },
    { yearMonth: '2026-12', open: true },
  ],
})

/** The scans goal it took over from, stopped on Sep 12 by Elena. */
export const STOPPED_GOAL = portalGoalBundle({
  id: 'goal-stopped',
  name: 'Monthly portal goal',
  metric: 'qualified_scans',
  target: 120,
  subject: PROPERTY,
  from: '2026-08',
  months: [
    { yearMonth: '2026-08', value: 130, achieved: true },
    { yearMonth: '2026-09', value: 90, achieved: false },
  ],
  ended: { at: new Date('2026-09-12T15:00:00.000Z') },
})

/** Reception's own goal, ended last year. */
export const RECEPTION_GOAL = portalGoalBundle({
  id: 'goal-reception',
  name: 'Reception ratings',
  metric: 'portal_rating_count',
  target: 20,
  subject: portalSubject('portal-reception'),
  from: '2025-09',
  ended: { at: new Date('2025-11-12T15:00:00.000Z') },
})

/** A Spa goal ended before the day a goal ends on was kept (migration 0062). */
export const OLD_SPA_GOAL = portalGoalBundle({
  id: 'goal-old-spa',
  name: 'Spa scans',
  metric: 'qualified_scans',
  target: 60,
  subject: portalSubject('portal-spa'),
  from: '2025-03',
  ended: { at: null },
})

export const SEAVIEW_GOALS = [MONTHLY_GOAL, STOPPED_GOAL, RECEPTION_GOAL, OLD_SPA_GOAL]

/** Whom a goal counts, by name, as the route names them. */
export const subjectName = (subject: GoalSubject): string =>
  goalAssignmentSubjectLabel(subject, SEAVIEW.name, GROUPS, PORTALS)

/** The page's two parts for `programs`, worked out as the route works them out. */
export function resultsOf(programs: readonly GoalProgramBundle[]) {
  return {
    matrix: buildGoalResultsMatrix({
      programs,
      property: { id: SEAVIEW.propertyId, name: SEAVIEW.name },
      portalGroups: GROUPS,
      portals: PORTALS,
    }),
    ended: endedPortalGoals(programs, { now: RESULTS_NOW, subjectName }),
  }
}

/** Who the fixtures' people are; anyone else is not in the directory. */
const PEOPLE: Readonly<Record<string, string>> = { elena: 'Elena Petrova' }

export const personName = (userId: string): string | null => PEOPLE[userId] ?? null
