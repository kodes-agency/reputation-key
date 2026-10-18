// In-memory doubles for the Monthly portal goal's card and page reads: an
// in-memory Property on Sofia time with its Portals, their readings, its
// Programs and the governed figure of each month, recording what was asked.
import { vi } from 'vitest'
import type {
  RecommendationDayCount,
  RecommendationPortal,
} from '../../domain/goal-recommendation-types'
import type { GoalMetricEvaluation, GoalTargetSource } from '../../domain/goal-program'
import type {
  GoalMonthlyResult,
  GoalProgramBundle,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import type {
  GoalRecommendationCounts,
  GoalRecommendationFactsPort,
} from '../ports/goal-recommendation-facts.port'
import type { GoalActor } from './goal-program-shared'
import type { GovernedGoalMetricResult } from './query-goal-metric'
import type {
  PortalGoalCardView,
  PortalGoalOfCard,
} from '../dto/monthly-portal-goal.types'
import type { MonthlyPortalGoalPageDeps } from './monthly-portal-goal-page'

export const PROPERTY_ID = 'property-1'
export const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'elena',
  role: 'PropertyManager',
}
// Seaview, on Sofia time (UTC+3 until Oct 25).
export const OCT_17 = new Date('2026-10-17T09:00:00.000Z')
export const OCT_23 = new Date('2026-10-23T09:00:00.000Z')
export const AT_NOON = 'T09:00:00.000Z'

/** A published Portal, live and with its code made on `since` (local noon). */
export function portal(
  name: string,
  since: string,
  patch: Partial<RecommendationPortal> = {},
): RecommendationPortal {
  const at = new Date(`${since}${AT_NOON}`)
  return {
    portalId: `portal-${name.toLowerCase()}`,
    name,
    publicationState: 'published',
    liveSince: at,
    liveIntervals: [{ from: at, to: null }],
    codeIssuedAt: at,
    codeReady: true,
    ...patch,
  }
}

export const draft = (name: string): RecommendationPortal => ({
  portalId: `portal-${name.toLowerCase()}`,
  name,
  publicationState: 'draft',
  liveSince: null,
  liveIntervals: [],
  codeIssuedAt: null,
  codeReady: false,
})

/** `count` readings of `measure` at a Portal on each of `days`. */
export const readings = (
  portalId: string | null,
  measure: RecommendationDayCount['measure'],
  days: readonly string[],
  count = 1,
): RecommendationDayCount[] =>
  days.map((localDay) => ({ portalId, measure, localDay, count }))

/** November on Sofia time. */
export const NOV_1 = new Date('2026-10-31T22:00:00.000Z')
export const DEC_1 = new Date('2026-11-30T22:00:00.000Z')
export const NOV_22 = new Date('2026-11-22T10:00:00.000Z')

/** One month of a goal: its first and last instants, and how far its result has got. */
export type MonthShape = Readonly<{
  start: Date
  end: Date
  target?: number
  status?: GoalMonthlyResult['status']
  evaluation?: Partial<GoalMetricEvaluation>
}>

type GoalShape = Readonly<{
  status?: GoalProgramBundle['program']['status']
  /** When its first month begins. */
  from?: Date
  /** Where its window ends: an ended goal's runs to the end of the month it was stopped in. */
  until?: Date
  /** When it was ended, as migration 0062 records it. */
  endedAt?: Date
  /** Who ended it, as migration 0062 records it. */
  endedBy?: string
  /** When it was set: Oct 23 unless said. */
  createdAt?: Date
  /** Where its number came from, when the set said. */
  targetSource?: GoalTargetSource
  /** The month that is open, while it runs: its first and last instants. */
  open?: Readonly<{ start: Date; end: Date; target?: number }>
  /** Its other months, earlier ones first. */
  months?: readonly MonthShape[]
}>

/** A month's result row: open and updating unless the shape says how far it has got. */
function monthResult(
  programId: string,
  programVersionId: string,
  assignmentId: string,
  month: MonthShape,
  index: number,
): GoalMonthlyResult {
  return {
    id: `${programId}-m${index + 1}`,
    assignmentId,
    programId,
    programVersionId,
    organizationId: 'org-1',
    propertyId: PROPERTY_ID,
    periodStart: month.start,
    periodEnd: month.end,
    propertyTimezone: 'Europe/Sofia',
    status: month.status ?? 'open',
    targetValue: month.target ?? null,
    evaluation: {
      state: 'updating',
      value: null,
      sampleCount: 0,
      achieved: null,
      reason: 'period_open',
      ...month.evaluation,
    },
    sourceCompleteThrough: null,
    evaluationWatermark: null,
    closedAt: month.status === 'closed' ? month.end : null,
    createdAt: month.start,
    updatedAt: month.start,
  }
}

/** A Property count goal with the Property as its one subject, 40 a month. */
export function propertyGoal(
  id: string,
  metric: GoalProgramVersion['metric'],
  shape: GoalShape = {},
) {
  const from = shape.from ?? NOV_1
  const createdAt = shape.createdAt ?? OCT_23
  const version: GoalProgramVersion = {
    id: `${id}-v1`,
    programId: id,
    organizationId: 'org-1',
    propertyId: PROPERTY_ID,
    version: 1,
    metricDefinitionId: 'definition-1',
    metricDefinitionVersionId: 'definition-version-1',
    metric,
    metricMinimumSample: 0,
    targetValue: 40,
    propertyTimezone: 'Europe/Sofia',
    effectiveFrom: from,
    effectiveTo: shape.until ?? null,
    changeReason: 'created',
    createdBy: 'elena',
    createdAt,
    ...(shape.targetSource ? { targetSource: shape.targetSource } : {}),
  }
  const assignmentId = `${id}-a1`
  return {
    program: {
      id,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      name: 'Monthly portal goal',
      description: null,
      status: shape.status ?? 'scheduled',
      statusReason: null,
      currentVersion: 1,
      createdBy: 'elena',
      createdAt,
      updatedAt: shape.endedAt ?? createdAt,
      ...(shape.endedAt ? { endedAt: shape.endedAt } : {}),
      ...(shape.endedBy ? { endedBy: shape.endedBy } : {}),
    },
    version,
    versions: [version],
    assignments: [
      {
        id: assignmentId,
        programId: id,
        programVersionId: version.id,
        organizationId: 'org-1',
        propertyId: PROPERTY_ID,
        metric,
        subject: { kind: 'property', propertyId: PROPERTY_ID },
        effectiveFrom: from,
        effectiveTo: shape.until ?? null,
        createdBy: 'elena',
        createdAt,
      },
    ],
    results: [...(shape.open ? [shape.open] : []), ...(shape.months ?? [])].map(
      (month, index) => monthResult(id, version.id, assignmentId, month, index),
    ),
  } satisfies GoalProgramBundle
}

/** What a change from a coming month writes: a new head version. */
type NextVersion = Readonly<{
  metric?: GoalProgramVersion['metric']
  targetValue: number
  /** Its first month's first instant. */
  from: Date
  createdAt?: Date
  createdBy?: string
  changeReason?: string
  targetSource?: GoalTargetSource
}>

/**
 * The goal changed from a coming month: a new head version from `from`, with
 * its window, and the months it has opened.
 */
export function withNextVersion(
  base: ReturnType<typeof propertyGoal>,
  next: NextVersion,
  months: readonly MonthShape[] = [],
) {
  const id = base.program.id
  const metric = next.metric ?? base.version.metric
  const [window] = base.assignments
  if (!window) throw new Error('expected the first window')
  const version: GoalProgramVersion = {
    ...base.version,
    id: `${id}-v2`,
    version: 2,
    metric,
    metricDefinitionVersionId:
      metric === base.version.metric
        ? base.version.metricDefinitionVersionId
        : 'definition-version-2',
    targetValue: next.targetValue,
    effectiveFrom: next.from,
    effectiveTo: null,
    changeReason: next.changeReason ?? 'revised',
    createdBy: next.createdBy ?? 'elena',
    createdAt: next.createdAt ?? OCT_23,
    ...(next.targetSource ? { targetSource: next.targetSource } : {}),
  }
  const nextWindow = {
    ...window,
    id: `${id}-a2`,
    programVersionId: version.id,
    metric,
    effectiveFrom: next.from,
    effectiveTo: null,
  }
  return {
    ...base,
    program: { ...base.program, currentVersion: 2 },
    version,
    versions: [base.version, version],
    assignments: [window, nextWindow],
    results: [
      ...base.results,
      ...months.map((month, index) =>
        monthResult(id, version.id, nextWindow.id, month, base.results.length + index),
      ),
    ],
  } satisfies GoalProgramBundle
}

/** The governed read of a month so far, as the metric context answers it. */
export const governed = (
  exactValue: number | null,
  state: GovernedGoalMetricResult['state'] = 'eligible',
): GovernedGoalMetricResult => ({
  definitionVersionId: 'definition-version-1',
  metricKey: null,
  state,
  exactValue,
  sampleCount: exactValue ?? 0,
  minimumSample: 0,
  sourceCompleteThrough: null,
  reason: null,
})

/** Running in November, 40 a month unless November's own number says otherwise. */
export const runningGoal = (november: Readonly<{ target?: number }> = {}) =>
  propertyGoal('monthly', 'portal_rating_count', {
    status: 'active',
    open: { start: NOV_1, end: DEC_1, ...november },
  })

/** Seaview's three Portals, live since October. */
export const SEAVIEW_PORTALS = [
  portal('Reception', '2026-10-09'),
  portal('Restaurant', '2026-10-09'),
  portal('Spa', '2026-10-15'),
]

type AuthorizeRequest = Parameters<MonthlyPortalGoalPageDeps['policy']['authorize']>[0]

type World = Readonly<{
  now?: Date
  timezone?: string | null
  portals?: readonly RecommendationPortal[]
  counts?: Partial<GoalRecommendationCounts>
  programs?: readonly GoalProgramBundle[]
  /** What the governed read says of a running month so far. */
  figure?: GovernedGoalMetricResult
  /** What it says of each month, by the month's first instant (ISO): it wins over `figure`. */
  figures?: Readonly<Record<string, GovernedGoalMetricResult>>
  /** What Portal names a Portal or a Portal Group, by `portal:<id>` or `portal_group:<id>`. */
  subjectNames?: Readonly<Record<string, string>>
}>

/** The card's and the page's reads over an in-memory Property, recording what was asked in order. */
export function fakeWorld(world: World = {}) {
  const calls: string[] = []
  const facts = {
    listPortalReadiness: vi.fn(async () => {
      calls.push('portals')
      return { portals: world.portals ?? [], truncated: false }
    }),
    readDailyCounts: vi.fn(async () => {
      calls.push('counts')
      return {
        days: world.counts?.days ?? [],
        unreadable: world.counts?.unreadable ?? [],
        lastScanAt: world.counts?.lastScanAt ?? new Map(),
      }
    }),
  } satisfies GoalRecommendationFactsPort
  const deps = {
    policy: {
      authorize: vi.fn(async (_request: AuthorizeRequest) => {
        calls.push('authorize')
      }),
    },
    reads: {
      list: vi.fn(async () => {
        calls.push('programs')
        return world.programs ?? []
      }),
    },
    metrics: {
      queryGoalMetric: vi.fn(async (query: Readonly<{ periodStart: Date }>) => {
        calls.push('figure')
        return (
          world.figures?.[query.periodStart.toISOString()] ?? world.figure ?? governed(0)
        )
      }),
    },
    recommendation: {
      subjects: {
        getTimezone: vi.fn(async () =>
          world.timezone === undefined ? 'Europe/Sofia' : world.timezone,
        ),
      },
      facts,
    },
    subjectNames: {
      getSubjectName: vi.fn(
        async (_organizationId: string, _propertyId: string, subject) => {
          calls.push('subject name')
          const key =
            subject.kind === 'portal'
              ? `portal:${subject.portalId}`
              : `portal_group:${subject.portalGroupId}`
          return world.subjectNames?.[key] ?? null
        },
      ),
    },
    logger: { warn: vi.fn() },
    now: () => world.now ?? OCT_17,
  } satisfies MonthlyPortalGoalPageDeps
  return { deps, calls }
}

/** The goal on a card that has one. */
export function goalOf(card: PortalGoalCardView): PortalGoalOfCard {
  if (card.state !== 'goal') throw new Error(`expected a goal, got ${card.state}`)
  return card.goal
}

/** Each local day from `first` for `count` days. */
export function days(first: string, count: number): string[] {
  const start = new Date(`${first}T00:00:00.000Z`).getTime()
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  )
}
