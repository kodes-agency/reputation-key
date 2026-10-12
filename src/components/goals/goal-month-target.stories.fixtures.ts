// Goal Programs for the stories and view tests of a month's own target; the
// `.stories.` segment keeps this module out of production-shaped source
// inventories and bundles.
//
// A goal is built around one running month on a UTC calendar. A view test
// names October 2026; a story of the dialog passes the month the clock is in,
// because the dialog reads the clock when it opens.
import type { GoalMetric } from '#/contexts/reporting/application/public-api'
import type {
  GoalMonthlyResult,
  GoalMonthTargetChange,
  GoalProgramBundle,
  GoalProgramVersion,
} from '#/contexts/reporting/application/ports/goal-program.repository'

export const FIXTURE_ZONE = 'UTC'
export const PROPERTY_ID = '10000000-0000-4000-8000-000000000001'
export const PROGRAM_ID = '20000000-0000-4000-8000-000000000001'

export type FixtureMonth = Readonly<{ start: Date; end: Date }>

/** The UTC calendar month `at` falls in. */
export function monthOf(at: Date): FixtureMonth {
  const year = at.getUTCFullYear()
  const month = at.getUTCMonth()
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  }
}

/** The month `count` months after `month` (before it when negative). */
export function monthAfter(month: FixtureMonth, count = 1): FixtureMonth {
  const year = month.start.getUTCFullYear()
  const index = month.start.getUTCMonth() + count
  return {
    start: new Date(Date.UTC(year, index, 1)),
    end: new Date(Date.UTC(year, index + 1, 1)),
  }
}

export const OCTOBER = monthOf(new Date('2026-10-15T00:00:00.000Z'))
export const NOVEMBER = monthAfter(OCTOBER)
export const DECEMBER = monthAfter(NOVEMBER)
export const SEPTEMBER = monthAfter(OCTOBER, -1)

export const version = (
  id: string,
  number: number,
  patch: Partial<GoalProgramVersion> = {},
): GoalProgramVersion => ({
  id,
  programId: PROGRAM_ID,
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  version: number,
  metricDefinitionId: 'definition-1',
  metricDefinitionVersionId: 'definition-version-1',
  metric: 'qualified_scans' satisfies GoalMetric,
  metricMinimumSample: 0,
  targetValue: 400,
  propertyTimezone: FIXTURE_ZONE,
  effectiveFrom: OCTOBER.start,
  effectiveTo: null,
  changeReason: 'created',
  createdBy: 'elena',
  createdAt: new Date('2026-09-20T08:00:00.000Z'),
  ...patch,
})

export const monthRow = (
  id: string,
  versionId: string,
  period: FixtureMonth = OCTOBER,
  patch: Partial<GoalMonthlyResult> = {},
): GoalMonthlyResult => ({
  id,
  assignmentId: `assignment-${id}`,
  programId: PROGRAM_ID,
  programVersionId: versionId,
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  periodStart: period.start,
  periodEnd: period.end,
  propertyTimezone: FIXTURE_ZONE,
  status: 'open',
  targetValue: null,
  evaluation: {
    state: 'updating',
    value: null,
    sampleCount: 0,
    achieved: null,
    reason: 'period_open',
  },
  sourceCompleteThrough: null,
  evaluationWatermark: null,
  closedAt: null,
  createdAt: period.start,
  updatedAt: period.start,
  ...patch,
})

export const targetChange = (
  monthlyResultId: string,
  previousTargetValue: number,
  newTargetValue: number,
  createdAt: Date,
  patch: Partial<GoalMonthTargetChange> = {},
): GoalMonthTargetChange => ({
  id: `change-${monthlyResultId}-${createdAt.getTime()}`,
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  programId: PROGRAM_ID,
  monthlyResultId,
  changeId: `command-${createdAt.getTime()}`,
  previousTargetValue,
  newTargetValue,
  followingOutcome: 'not_requested',
  followingReason: null,
  followingVersionId: null,
  note: null,
  createdBy: 'marco',
  createdAt,
  ...patch,
})

/** A goal whose head is the last version given. */
export function goalBundle(
  input: Readonly<{
    status?: GoalProgramBundle['program']['status']
    versions: readonly GoalProgramVersion[]
    results?: readonly GoalMonthlyResult[]
    targetChanges?: readonly GoalMonthTargetChange[]
  }>,
): GoalProgramBundle {
  const head = input.versions.at(-1)
  if (!head) throw new Error('a goal has at least one version')
  return {
    program: {
      id: PROGRAM_ID,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      name: 'Lobby scans',
      description: null,
      status: input.status ?? 'active',
      statusReason: null,
      currentVersion: head.version,
      createdBy: head.createdBy,
      createdAt: head.createdAt,
      updatedAt: head.createdAt,
    },
    version: head,
    versions: input.versions,
    assignments: [],
    results: input.results ?? [],
    targetChanges: input.targetChanges ?? [],
  }
}

/** Who the fixtures' people are; anyone else is not in the directory. */
const PEOPLE: Readonly<Record<string, string>> = {
  elena: 'Elena Petrova',
  marco: 'Marco Rossi',
}

export const personName = (userId: string): string | null => PEOPLE[userId] ?? null
