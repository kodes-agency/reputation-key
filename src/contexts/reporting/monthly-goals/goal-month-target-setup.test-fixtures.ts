// Shared harness of the month-target suites against PostgreSQL.
//
// The command runs on the real repository: the transaction, the row locks, the
// guard on the database clock and the log of target changes are all PostgreSQL's.
// The database clock decides which month is running, so the months are placed
// around the real current month.
import type { Client } from 'pg'
import { vi } from 'vitest'
import type { Database } from '#/shared/db'
import { findMetricVersionById } from '../readings/contracts'
import type { GoalSubject } from '../domain/goal-program'
import { createGoalProgramRepository } from './goal-program-repository.server'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import {
  actor,
  ORGANIZATION_ID,
  PROPERTY_ID,
  useScenarioTransaction,
} from './goal-program-service.test-fixtures'
import { createGoalProgramService } from './goal-programs.server'
import {
  type GoalMetricReadPort,
  type GoalProgramSubjectReader,
} from '../application/use-cases/goal-program-shared'

const LOBBY_ID = '00000000-0000-4000-8000-00000000b001'
export const POOL_ID = '00000000-0000-4000-8000-00000000b002'

export const MINUTE_MS = 60_000
const HALF_DAY_MS = 12 * 60 * MINUTE_MS
export const DAY_MS = 24 * 60 * MINUTE_MS

/** The first instant of the UTC month `offset` months from the current one. */
export function monthStart(offset: number): Date {
  const now = new Date(vi.getRealSystemTime())
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
}

export function monthKey(offset: number): string {
  return monthStart(offset).toISOString().slice(0, 7)
}

/** The instant the local calendar month `offset` months from now begins in `timeZone`. */
export function localMonthStart(timeZone: string, offset: number): Date {
  const wanted = monthStart(offset).getTime()
  const offsetAt = (instant: number): number => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, Number(part.value)]),
    )
    const local = Date.UTC(
      parts.year!,
      parts.month! - 1,
      parts.day!,
      parts.hour!,
      parts.minute!,
      parts.second!,
    )
    return local - Math.floor(instant / 1000) * 1000
  }
  const first = wanted - offsetAt(wanted)
  return new Date(wanted - offsetAt(first))
}

/** The month the goals here are set for; the months around it are named from it. */
export type Calendar = Readonly<{
  start: Date
  next: Date
  key: string
  nextKey: string
  mid: Date
  late: Date
}>

export function calendarAt(offset: number): Calendar {
  const start = monthStart(offset)
  return {
    start,
    next: monthStart(offset + 1),
    key: monthKey(offset),
    nextKey: monthKey(offset + 1),
    mid: new Date(start.getTime() + 14 * DAY_MS + HALF_DAY_MS),
    late: new Date(start.getTime() + 19 * DAY_MS + HALF_DAY_MS),
  }
}

/** The running month: the database clock agrees with the command's. */
export const RUNNING = calendarAt(0)
export const MARCH = RUNNING.start
export const APRIL = RUNNING.next

export const LOBBY: GoalSubject = { kind: 'portal', portalId: LOBBY_ID }
export const POOL: GoalSubject = { kind: 'portal', portalId: POOL_ID }

/** The Property and its two Portals every month-target test starts from. */
async function seedMonthTargetScenario(client: Client) {
  await client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Month target Property', 'month-target-property', 'UTC')`,
    [PROPERTY_ID, ORGANIZATION_ID],
  )
  for (const [portalId, slug] of [
    [LOBBY_ID, 'month-target-lobby'],
    [POOL_ID, 'month-target-pool'],
  ] as const) {
    await client.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $4, $5, $5)`,
      [portalId, ORGANIZATION_ID, PROPERTY_ID, PROPERTY_ID, slug],
    )
  }
}

/** The scenario of the month-target suites, with its service wiring. */
export function useMonthTargetScenario() {
  const scenario = useScenarioTransaction(seedMonthTargetScenario)
  return {
    setup: (initialNow?: Date, calendar?: Calendar) =>
      createMonthTargetHarness(scenario.db(), initialNow, calendar),
    /** A version as stored, including one a change replaced, which the read leaves out. */
    versionRow: (programId: string, version: number) =>
      versionRow(scenario.client(), programId, version),
  }
}

async function versionRow(client: Client, programId: string, version: number) {
  const found = await client.query<{
    targetValue: number
    effectiveFrom: Date
    effectiveTo: Date | null
  }>(
    `SELECT target_value::float8 AS "targetValue", effective_from AS "effectiveFrom",
            effective_to AS "effectiveTo"
       FROM goal_program_versions WHERE program_id = $1 AND version = $2`,
    [programId, version],
  )
  return found.rows[0]
}

export function createMonthTargetHarness(
  db: Database,
  initialNow = RUNNING.mid,
  calendar: Calendar = RUNNING,
) {
  let id = 0
  let now = initialNow
  const real = createGoalProgramRepository(db)
  const repository = {
    ...real,
    get: vi.fn(real.get),
    revise: vi.fn(real.revise),
    changeMonthTarget: vi.fn(real.changeMonthTarget),
  }
  const metrics = {
    queryGoalMetric: vi.fn<GoalMetricReadPort['queryGoalMetric']>(async (query) => ({
      definitionVersionId: query.definitionVersionId,
      metricKey: 'portal.rating_count',
      state: 'updating',
      exactValue: 0,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'source_reconciling',
    })),
    getApprovedGoalVersion: vi.fn<
      NonNullable<GoalMetricReadPort['getApprovedGoalVersion']>
    >(async (versionId) => findMetricVersionById(versionId)),
  }
  const subjects = {
    ratingSubjectsSkipPrivateRating: vi.fn(async () => false),
    staffTargetProblem: vi.fn(async () => null),
    getTimezone: vi.fn<GoalProgramSubjectReader['getTimezone']>(async () => 'UTC'),
    subjectBelongsToProperty: vi.fn<GoalProgramSubjectReader['subjectBelongsToProperty']>(
      async () => true,
    ),
  }
  const policy = { authorize: vi.fn(async () => undefined) }
  const service = createGoalProgramService({
    repository,
    policy,
    subjects,
    metrics,
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => now,
  })

  let programId: string | null = null
  const stored = async (): Promise<GoalProgramBundle> => {
    if (!programId) throw new Error('no Program is stored')
    const found = await real.get(ORGANIZATION_ID, PROPERTY_ID, programId)
    if (!found) throw new Error('the stored Program is gone')
    return found
  }

  /** A goal of 25 ratings for the month, set before it and counting since its first day. */
  const createGoal = async (goalSubjects: readonly GoalSubject[] = [LOBBY]) => {
    const createdAt = now
    now = calendar.start
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: goalSubjects,
        startMonth: calendar.key,
      },
      actor,
    )
    now = createdAt
    programId = bundle.program.id
    return bundle
  }
  const change = async (
    patch: Partial<Parameters<typeof service.changeMonthTarget>[0]> = {},
  ) =>
    service.changeMonthTarget(
      {
        propertyId: PROPERTY_ID,
        programId: (await stored()).program.id,
        month: calendar.key,
        targetValue: 20,
        expectedTarget: 25,
        expectedVersion: (await stored()).program.currentVersion,
        expectedFollowingMonth: calendar.nextKey,
        applyToFollowing: false,
        ...patch,
      },
      actor,
    )
  /** Plans a revision of the goal for the month after the running one. */
  const schedule = (
    goal: GoalProgramBundle,
    patch: Omit<Parameters<typeof service.revise>[0], 'propertyId' | 'programId'>,
  ) =>
    service.revise(
      { propertyId: PROPERTY_ID, programId: goal.program.id, ...patch },
      actor,
    )
  const setStatus = (goal: GoalProgramBundle, status: 'paused' | 'ended') =>
    service.changeStatus(
      { propertyId: PROPERTY_ID, programId: goal.program.id, status },
      actor,
    )
  return {
    service,
    repository,
    metrics,
    subjects,
    policy,
    createGoal,
    change,
    schedule,
    setStatus,
    stored,
    /** Points the helpers at a goal the test set through the service itself. */
    adopt: (bundle: GoalProgramBundle) => {
      programId = bundle.program.id
    },
    setNow: (next: Date) => {
      now = next
    },
  }
}

export const refusal = (code: string) => ({ name: 'GoalProgramError', code })
