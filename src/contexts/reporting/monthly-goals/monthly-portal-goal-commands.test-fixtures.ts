// In-memory doubles for the Monthly portal goal's commands: an in-memory
// Property on Sofia time with Reception and Restaurant live since Oct 9, the
// goals it already has, and the engine's own commands faked.
import { vi } from 'vitest'
import type { GoalMetric, GoalSubject } from '../domain/goal-program'
import type { SetMonthlyPortalGoalRequest } from './contracts'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import type { GoalRecommendationFactsPort } from './goal-recommendation-facts.port.server'
import type {
  MonthlyPortalGoalChangeDeps,
  MonthlyPortalGoalSetDeps,
} from './monthly-portal-goal.server'
import {
  NOV_1,
  OCT_23,
  PROPERTY_ID,
  days,
  portal,
  propertyGoal,
  readings,
} from './monthly-portal-goal.test-fixtures'

/** An existing goal of the Property: its status, measure and subjects. */
export function existing(
  id: string,
  shape: Readonly<{
    status?: GoalProgramBundle['program']['status']
    metric?: GoalMetric
    subject?: GoalProgramBundle['assignments'][number]['subject']
    /** When its first month begins: Nov 1 unless said. */
    from?: Date
    createdAt?: Date
  }> = {},
): GoalProgramBundle {
  return propertyGoal(id, shape.metric ?? 'portal_rating_count', {
    ...shape,
    name: 'A goal',
  })
}

/** The command over an in-memory Property, recording what it was asked in order. */
export function fakeWorld(programs: readonly GoalProgramBundle[] = []) {
  const calls: string[] = []
  const facts = {
    listPortalReadiness: vi.fn(async () => ({
      portals: [portal('Reception', '2026-10-09'), portal('Restaurant', '2026-10-09')],
      truncated: false,
    })),
    readDailyCounts: vi.fn(async () => ({
      days: [
        ...readings('portal-reception', 'portal_rating_count', days('2026-10-09', 11)),
        ...readings('portal-restaurant', 'portal_rating_count', days('2026-10-12', 5)),
      ],
      unreadable: [],
      lastScanAt: new Map(),
      groupDays: [],
      groupUnreadable: [],
    })),
  } satisfies GoalRecommendationFactsPort
  const deps = {
    policy: {
      authorize: vi.fn(async () => {
        calls.push('authorize')
      }),
    },
    repository: {
      list: vi.fn(async () => {
        calls.push('programs')
        return programs
      }),
    },
    programs: {
      create: vi.fn(async () => {
        calls.push('create')
        return existing('created')
      }),
    },
    recommendation: {
      subjects: { getTimezone: vi.fn(async () => 'Europe/Sofia') },
      facts,
    },
    now: () => OCT_23,
  } satisfies MonthlyPortalGoalSetDeps
  return { deps, calls }
}

export const NOVEMBER_40: SetMonthlyPortalGoalRequest = {
  propertyId: PROPERTY_ID,
  metric: 'portal_rating_count',
  targetValue: 40,
  startMonth: '2026-11',
  targetSource: 'recommended',
}

export const created = (deps: MonthlyPortalGoalSetDeps) =>
  vi.mocked(deps.programs.create).mock.calls[0]?.[0]

/** October on Sofia time: the month that runs on Oct 23. */
export const OCT_1 = new Date('2026-09-30T21:00:00.000Z')

export const receptionSubject = { kind: 'portal', portalId: 'portal-reception' } as const

/** The monthly goal (or a goal for one subject), running in October at 40, set on Oct 2. */
export const runningOctober = (id = 'monthly', subject?: GoalSubject) =>
  propertyGoal(id, 'portal_rating_count', {
    status: 'active',
    from: OCT_1,
    createdAt: new Date('2026-10-02T09:00:00.000Z'),
    open: { start: OCT_1, end: NOV_1 },
    ...(subject ? { subject } : {}),
  })

/** A goal for Reception and Spa at once, as an old form could make: no page of its own. */
export function severalSubjects(id: string): GoalProgramBundle {
  const goal = existing(id, { subject: receptionSubject })
  const [window] = goal.assignments
  if (!window) throw new Error('expected a window')
  return {
    ...goal,
    assignments: [
      window,
      { ...window, id: `${id}-a2`, subject: { kind: 'portal', portalId: 'portal-spa' } },
    ],
  }
}

/** The commands over an in-memory Property, with the engine's own commands faked. */
export function changeWorld(
  programs: readonly GoalProgramBundle[] = [runningOctober()],
  now?: Date,
) {
  const { deps: setDeps, calls } = fakeWorld(programs)
  const deps = {
    policy: setDeps.policy,
    repository: setDeps.repository,
    recommendation: setDeps.recommendation,
    now: now === undefined ? setDeps.now : () => now,
    programs: {
      changeMonthTarget: vi.fn(async () => {
        calls.push('change month')
        return {
          month: { previous: 40, next: 45 },
          following: { outcome: 'applied' as const },
        }
      }),
      revise: vi.fn(async () => {
        calls.push('revise')
        return programs[0] ?? existing('revised')
      }),
      changeStatus: vi.fn(async () => {
        calls.push('stop')
        return (programs[0] ?? existing('stopped')).program
      }),
    },
  } satisfies MonthlyPortalGoalChangeDeps
  return { deps, calls }
}

export const OCTOBER_45 = {
  propertyId: PROPERTY_ID,
  programId: 'monthly',
  month: '2026-10',
  targetValue: 45,
  expectedTarget: 40,
  expectedVersion: 1,
  expectedFollowingMonth: '2026-11',
  targetSource: 'own',
} as const

export const FROM_NOVEMBER_45 = {
  propertyId: PROPERTY_ID,
  programId: 'monthly',
  metric: 'portal_rating_count',
  targetValue: 45,
  expectedVersion: 1,
  startMonth: '2026-11',
  targetSource: 'own',
} as const

export const asked = (deps: MonthlyPortalGoalChangeDeps) =>
  vi.mocked(deps.policy.authorize).mock.calls.map(([request]) => request.action)
