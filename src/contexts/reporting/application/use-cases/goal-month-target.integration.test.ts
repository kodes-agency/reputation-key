// Changing the target of a month that is still running, against PostgreSQL.
//
// The command runs on the real repository: the transaction, the row locks, the
// guard on the database clock and the log of target changes are all PostgreSQL's.
// Monthly results cannot be deleted, so every test runs in a savepoint of one
// held transaction that is rolled back. The database clock decides which month
// is running, so the months are placed around the real current month.
import {
  afterAll,
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../../readings/contracts'
import type { GoalSubject } from '../../domain/goal-program'
import { createGoalProgramRepository } from '../../infrastructure/repositories/goal-program.repository'
import { monthTargetMarker } from '../goal-month-target-marker'
import { monthTargetPlan } from '../goal-month-target-plan'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import {
  createGoalProgramService,
  type GoalActor,
  type GoalMetricReadPort,
  type GoalProgramSubjectReader,
} from '../../monthly-goals/goal-programs.server'

const ORGANIZATION_ID = 'org-1'
const PROPERTY_ID = '00000000-0000-4000-8000-00000000a001'
const LOBBY_ID = '00000000-0000-4000-8000-00000000b001'
const POOL_ID = '00000000-0000-4000-8000-00000000b002'

const actor: GoalActor = {
  organizationId: ORGANIZATION_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
}

const MINUTE_MS = 60_000
const HALF_DAY_MS = 12 * 60 * MINUTE_MS
const DAY_MS = 24 * 60 * MINUTE_MS

/** The first instant of the UTC month `offset` months from the current one. */
function monthStart(offset: number): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
}

function monthKey(offset: number): string {
  return monthStart(offset).toISOString().slice(0, 7)
}

/** The instant the local calendar month `offset` months from now begins in `timeZone`. */
function localMonthStart(timeZone: string, offset: number): Date {
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
type Calendar = Readonly<{
  start: Date
  next: Date
  key: string
  nextKey: string
  mid: Date
  late: Date
}>

function calendarAt(offset: number): Calendar {
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
const RUNNING = calendarAt(0)
const MARCH = RUNNING.start
const APRIL = RUNNING.next

const LOBBY: GoalSubject = { kind: 'portal', portalId: LOBBY_ID }
const POOL: GoalSubject = { kind: 'portal', portalId: POOL_ID }

let held: HeldTransaction | undefined
let db: Database

beforeAll(async () => {
  held = await holdTransaction()
  db = held.db
})

afterAll(async () => {
  await held?.rollBack()
})

beforeEach(async () => {
  const client = held!.client
  await client.query('SAVEPOINT scenario')
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
})

afterEach(async () => {
  await held!.client.query('ROLLBACK TO SAVEPOINT scenario')
})

/** A version as stored, including one a change replaced, which the read leaves out. */
async function versionRow(programId: string, version: number) {
  const found = await held!.client.query<{
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

function setup(initialNow = RUNNING.mid, calendar: Calendar = RUNNING) {
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
  return {
    service,
    repository,
    metrics,
    subjects,
    policy,
    createGoal,
    change,
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

const refusal = (code: string) => ({ name: 'GoalProgramError', code })

describe('changeMonthTarget', () => {
  it('changes the running month’s target and logs who, when, old and new', async () => {
    const { createGoal, change, stored, policy, repository } = setup()
    const goal = await createGoal()

    await expect(change({ note: '  Fewer guests in March  ' })).resolves.toEqual({
      month: { previous: 25, next: 20 },
      following: { outcome: 'not_requested' },
    })

    expect(policy.authorize).toHaveBeenLastCalledWith({
      actor,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      action: 'goal.update',
    })
    expect((await stored()).results).toEqual([
      expect.objectContaining({ id: goal.results[0]?.id, targetValue: 20 }),
    ])
    expect((await stored()).targetChanges).toEqual([
      expect.objectContaining({
        programId: goal.program.id,
        monthlyResultId: goal.results[0]?.id,
        previousTargetValue: 25,
        newTargetValue: 20,
        followingOutcome: 'not_requested',
        followingReason: null,
        followingVersionId: null,
        note: 'Fewer guests in March',
        createdBy: 'manager-1',
        createdAt: RUNNING.mid,
      }),
    ])
    // The version keeps the target the goal was set with, and no version is written.
    expect((await stored()).versions).toEqual([
      expect.objectContaining({ targetValue: 25 }),
    ])
    expect(repository.revise).not.toHaveBeenCalled()
  })

  it('stores no note when none was written', async () => {
    const { createGoal, change, stored } = setup()
    await createGoal()

    await change({ note: '   ' })

    expect((await stored()).targetChanges).toEqual([
      expect.objectContaining({ note: null }),
    ])
  })

  it('refuses without goal.update before it reads the goal', async () => {
    const { createGoal, change, policy, repository } = setup()
    await createGoal()
    repository.get.mockClear()
    policy.authorize.mockRejectedValueOnce(new Error('denied'))

    await expect(change()).rejects.toThrow('denied')
    expect(repository.get).not.toHaveBeenCalled()
    expect(repository.changeMonthTarget).not.toHaveBeenCalled()
  })

  it('answers not_found for a Property with no time zone on record', async () => {
    const { createGoal, change, subjects, repository } = setup()
    await createGoal()
    subjects.getTimezone.mockResolvedValue(null)

    await expect(change()).rejects.toMatchObject(refusal('not_found'))
    expect(repository.changeMonthTarget).not.toHaveBeenCalled()
  })

  describe('which month', () => {
    it('refuses after the period end: a form opened in March and saved in April changes neither month', async () => {
      const { createGoal, change, stored, setNow, repository } = setup()
      await createGoal()

      // The catch-up step has opened April by the time the command reads.
      setNow(new Date(APRIL.getTime() + 5 * MINUTE_MS))
      await expect(change()).rejects.toMatchObject(refusal('month_locked'))

      expect((await stored()).results.map((result) => result.periodStart)).toEqual([
        MARCH,
        APRIL,
      ])
      expect(
        (await stored()).results.every((result) => result.targetValue === null),
      ).toBe(true)
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('refuses after the period end for a paused goal, whose next month never opened', async () => {
      const { createGoal, change, service, stored, setNow } = setup()
      const goal = await createGoal()
      await service.changeStatus(
        { propertyId: PROPERTY_ID, programId: goal.program.id, status: 'paused' },
        actor,
      )

      setNow(new Date(APRIL.getTime() + 5 * MINUTE_MS))
      await expect(change()).rejects.toMatchObject(refusal('month_locked'))
      expect((await stored()).results).toHaveLength(1)
    })

    it('refuses with month_locked when the database finds the period over', async () => {
      // The command's clock still reads the goal's month; the database's has
      // passed it, because that month is last month.
      const lastMonth = calendarAt(-1)
      const { createGoal, change, stored, setNow } = setup(lastMonth.mid, lastMonth)
      await createGoal()
      setNow(new Date(lastMonth.next.getTime() - 100))

      await expect(change({ applyToFollowing: true })).rejects.toMatchObject(
        refusal('month_locked'),
      )
      expect((await stored()).results[0]).toMatchObject({ targetValue: null })
      expect((await stored()).versions).toHaveLength(1)
      expect((await stored()).targetChanges).toEqual([])
    })

    it('opens a month that has begun before it looks for the running month', async () => {
      // The goal's month is over on the database clock; the one after is running.
      const lastMonth = calendarAt(-1)
      const { createGoal, change, stored, setNow } = setup(lastMonth.mid, lastMonth)
      await createGoal()

      // The hourly job has not opened this month yet.
      setNow(new Date(lastMonth.next.getTime() + 5 * MINUTE_MS))
      await expect(
        change({ month: lastMonth.nextKey, expectedFollowingMonth: monthKey(1) }),
      ).resolves.toMatchObject({
        month: { previous: 25, next: 20 },
      })

      expect((await stored()).results).toEqual([
        expect.objectContaining({ periodStart: lastMonth.start, targetValue: null }),
        expect.objectContaining({ periodStart: lastMonth.next, targetValue: 20 }),
      ])
    })

    it('a scheduled goal has no open month', async () => {
      const { service, change, repository, adopt } = setup(calendarAt(-1).mid)
      const scheduled = await service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'March ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [LOBBY],
          startMonth: RUNNING.key,
        },
        actor,
      )

      adopt(scheduled)

      await expect(change({ month: monthKey(-1) })).rejects.toMatchObject(
        refusal('no_open_month'),
      )
      await expect(change({ month: RUNNING.key })).rejects.toMatchObject(
        refusal('no_open_month'),
      )
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('a paused goal’s running month can be changed', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      await service.changeStatus(
        { propertyId: PROPERTY_ID, programId: goal.program.id, status: 'paused' },
        actor,
      )

      await expect(change()).resolves.toMatchObject({ month: { previous: 25, next: 20 } })
      expect((await stored()).results[0]).toMatchObject({ targetValue: 20 })
    })

    it('an ended goal is refused', async () => {
      const { createGoal, change, service, repository } = setup()
      const goal = await createGoal()
      await service.changeStatus(
        { propertyId: PROPERTY_ID, programId: goal.program.id, status: 'ended' },
        actor,
      )

      await expect(change()).rejects.toMatchObject(refusal('invalid_transition'))
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('changing a multi-subject goal updates every running row under one change id', async () => {
      const { createGoal, change, stored } = setup()
      await createGoal([LOBBY, POOL])

      await change()

      expect((await stored()).results.map((result) => result.targetValue)).toEqual([
        20, 20,
      ])
      const logged = (await stored()).targetChanges ?? []
      expect(logged.map((row) => row.monthlyResultId).sort()).toEqual(
        (await stored()).results.map((result) => result.id).sort(),
      )
      expect(new Set(logged.map((row) => row.changeId)).size).toBe(1)
      expect(new Set(logged.map((row) => row.id)).size).toBe(2)
    })
  })

  describe('the target', () => {
    it.each([
      ['a fraction of a rating', 20.5],
      ['zero', 0],
      ['a negative number', -3],
    ])('refuses %s for a count', async (_label, targetValue) => {
      const { createGoal, change, repository } = setup()
      await createGoal()

      await expect(change({ targetValue })).rejects.toMatchObject(
        refusal('invalid_target'),
      )
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('validates against the measure of the running month, not of a change waiting for its month', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      // From April the goal measures the average rating; March still counts ratings.
      await service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: goal.program.id,
          metric: 'portal_rating_average',
          targetValue: 4.5,
          subjects: [LOBBY],
        },
        actor,
      )

      await expect(change({ targetValue: 4.5 })).rejects.toMatchObject(
        refusal('invalid_target'),
      )
      await expect(change({ targetValue: 30 })).resolves.toMatchObject({
        month: { previous: 25, next: 30 },
      })
      expect((await stored()).results[0]).toMatchObject({ targetValue: 30 })
    })
  })

  describe('a goal that changed under the form', () => {
    it('refuses a stale expected target', async () => {
      const { createGoal, change, stored } = setup()
      await createGoal()
      await change({ targetValue: 22 })

      // This form still shows 25.
      await expect(change({ targetValue: 20, expectedTarget: 25 })).rejects.toMatchObject(
        refusal('revision_conflict'),
      )
      expect((await stored()).results[0]).toMatchObject({ targetValue: 22 })
      expect((await stored()).targetChanges).toHaveLength(1)
    })

    it('refuses a stale expected version', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      // Another manager scheduled a change after the form opened on version 1.
      await service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: goal.program.id,
          metric: 'portal_rating_count',
          targetValue: 40,
          subjects: [LOBBY],
        },
        actor,
      )

      await expect(
        change({ expectedVersion: 1, applyToFollowing: true }),
      ).rejects.toMatchObject(refusal('revision_conflict'))
      expect((await stored()).results[0]).toMatchObject({ targetValue: null })
      expect((await stored()).version).toMatchObject({ version: 2, targetValue: 40 })
    })

    it('the database refuses a write whose month changed after the command read it', async () => {
      const { createGoal, change, stored, repository } = setup()
      await createGoal()
      const write = repository.changeMonthTarget.getMockImplementation()
      // Someone else's 22 lands after this save read 25, and the save still writes.
      repository.changeMonthTarget.mockImplementationOnce(async (input) => {
        await write?.({ ...input, targetValue: 22, storedTargetValue: 22 })
        return write!(input)
      })

      await expect(change()).rejects.toMatchObject(refusal('revision_conflict'))
      expect((await stored()).results[0]).toMatchObject({ targetValue: 22 })
      expect((await stored()).targetChanges).toHaveLength(1)
    })

    it('the database refuses a write to a goal that ended after the command read it', async () => {
      const { createGoal, change, service, stored, repository } = setup()
      const goal = await createGoal()
      const write = repository.changeMonthTarget.getMockImplementation()
      repository.changeMonthTarget.mockImplementationOnce(async (input) => {
        await service.changeStatus(
          { propertyId: PROPERTY_ID, programId: goal.program.id, status: 'ended' },
          actor,
        )
        return write!(input)
      })

      await expect(change()).rejects.toMatchObject(refusal('invalid_transition'))
      expect((await stored()).results[0]).toMatchObject({ targetValue: null })
      expect((await stored()).targetChanges).toEqual([])
    })

    it('reports a write the repository refused as a conflict', async () => {
      const { createGoal, change, repository } = setup()
      await createGoal()
      repository.changeMonthTarget.mockResolvedValueOnce('revision_conflict')

      await expect(change()).rejects.toMatchObject(refusal('revision_conflict'))
      // The goal is read again, but a month that is not as asked is not written twice.
      expect(repository.changeMonthTarget).toHaveBeenCalledOnce()
    })

    it('refuses when the months after would start with another month than the form showed', async () => {
      const { createGoal, change, stored, subjects, repository } = setup()
      await createGoal()
      // The form was opened while the Property was on UTC and showed "from
      // Apr 1". The Property has since moved to Sofia, where a version can
      // only start with May: April would have no goal result, and the form
      // never said so.
      subjects.getTimezone.mockResolvedValue('Europe/Sofia')

      await expect(change({ applyToFollowing: true })).rejects.toMatchObject(
        refusal('revision_conflict'),
      )
      expect((await stored()).results[0]).toMatchObject({ targetValue: null })
      expect((await stored()).versions).toHaveLength(1)
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('changes the month alone whatever the form showed for the months after', async () => {
      const { createGoal, change, subjects } = setup()
      await createGoal()
      subjects.getTimezone.mockResolvedValue('Europe/Sofia')

      // No version is cut, so the month one would start with decides nothing.
      await expect(change()).resolves.toEqual({
        month: { previous: 25, next: 20 },
        following: { outcome: 'not_requested' },
      })
    })
  })

  describe('the months after', () => {
    it('applies to following months through a new version from next month, in one write', async () => {
      const { createGoal, change, stored, repository, setNow } = setup()
      const goal = await createGoal([LOBBY, POOL])
      setNow(RUNNING.late)

      await expect(
        change({ applyToFollowing: true, note: 'Fewer guests' }),
      ).resolves.toEqual({
        month: { previous: 25, next: 20 },
        following: { outcome: 'applied', startsAt: APRIL },
      })

      // One call writes the month, the log and the version together.
      expect(repository.changeMonthTarget).toHaveBeenCalledOnce()
      expect(repository.revise).not.toHaveBeenCalled()
      const [first, second] = (await stored()).versions
      expect(first).toMatchObject({
        id: goal.version.id,
        targetValue: 25,
        effectiveTo: APRIL,
      })
      expect(second).toMatchObject({
        version: 2,
        metric: 'portal_rating_count',
        metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
        targetValue: 20,
        propertyTimezone: 'UTC',
        effectiveFrom: APRIL,
        effectiveTo: null,
        changeReason: 'target_changed',
        createdBy: 'manager-1',
        createdAt: RUNNING.late,
      })
      expect((await stored()).program.currentVersion).toBe(2)
      expect(
        (await stored()).assignments
          .filter((assignment) => assignment.programVersionId === second?.id)
          .map((assignment) => [assignment.subject, assignment.effectiveFrom]),
      ).toEqual([
        [LOBBY, APRIL],
        [POOL, APRIL],
      ])
      // The note is the change's: the log carries it, and the version records
      // only what kind of change it was.
      expect((await stored()).targetChanges).toEqual([
        expect.objectContaining({
          followingOutcome: 'applied',
          followingVersionId: second?.id,
          note: 'Fewer guests',
        }),
        expect.objectContaining({
          followingOutcome: 'applied',
          followingVersionId: second?.id,
          note: 'Fewer guests',
        }),
      ])
      // March keeps its version; only its own target moved.
      expect((await stored()).results.map((result) => result.programVersionId)).toEqual([
        goal.version.id,
        goal.version.id,
      ])
    })

    it('stores where the new target came from with the change and on the version for the months after', async () => {
      const { createGoal, change, stored, setNow } = setup()
      await createGoal([LOBBY, POOL])
      setNow(RUNNING.late)

      await change({ applyToFollowing: true, targetSource: 'recommended' })

      expect(
        (await stored()).targetChanges?.map((logged) => logged.targetSource),
      ).toEqual(['recommended', 'recommended'])
      expect((await stored()).version).toMatchObject({
        version: 2,
        targetValue: 20,
        targetSource: 'recommended',
      })
    })

    it('stores the source on the version when only the months after take the target, and none on a change not told', async () => {
      const { createGoal, change, stored } = setup()
      await createGoal()
      await change()

      await change({ expectedTarget: 20, applyToFollowing: true, targetSource: 'own' })

      expect((await stored()).version).toMatchObject({
        version: 2,
        targetValue: 20,
        targetSource: 'own',
      })
      expect(
        (await stored()).targetChanges?.map((logged) => logged.targetSource),
      ).toEqual([undefined])
    })

    it('a failed following step leaves the month unchanged', async () => {
      const { createGoal, change, stored, repository } = setup()
      await createGoal()
      // The version cannot be written: the head moved between the read and the write.
      repository.changeMonthTarget.mockImplementationOnce(async (input) => {
        expect(input.following.revision).not.toBeNull()
        return 'revision_conflict'
      })

      await expect(change({ applyToFollowing: true })).rejects.toMatchObject(
        refusal('revision_conflict'),
      )
      expect((await stored()).results[0]).toMatchObject({ targetValue: null })
      expect((await stored()).versions).toHaveLength(1)
      expect((await stored()).targetChanges).toEqual([])
      expect(repository.revise).not.toHaveBeenCalled()
    })

    it('a scheduled change with the same measure is replaced and logged as replaced', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      // From April: 40 ratings, for the lobby and the pool.
      await service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: goal.program.id,
          metric: 'portal_rating_count',
          targetValue: 40,
          subjects: [LOBBY, POOL],
        },
        actor,
      )

      await expect(change({ applyToFollowing: true })).resolves.toEqual({
        month: { previous: 25, next: 20 },
        following: { outcome: 'replaced_scheduled_change', startsAt: APRIL },
      })

      const { version: head, versions } = await stored()
      const [inForce] = versions
      const replaced = await versionRow(head.programId, 2)
      expect(inForce).toMatchObject({ targetValue: 25, effectiveTo: APRIL })
      // The replaced change keeps an empty window.
      expect(replaced).toMatchObject({
        targetValue: 40,
        effectiveFrom: APRIL,
        effectiveTo: APRIL,
      })
      expect(head).toMatchObject({
        version: 3,
        targetValue: 20,
        effectiveFrom: APRIL,
        effectiveTo: null,
        changeReason: 'target_changed',
      })
      // It keeps the subjects of the change it replaces.
      expect(
        (await stored()).assignments
          .filter((assignment) => assignment.programVersionId === head?.id)
          .map((assignment) => assignment.subject),
      ).toEqual([LOBBY, POOL])
      expect((await stored()).targetChanges).toEqual([
        expect.objectContaining({
          followingOutcome: 'replaced_scheduled_change',
          followingVersionId: head?.id,
        }),
      ])
    })

    it('a scheduled change with another measure is kept and logged as kept', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      await service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: goal.program.id,
          metric: 'portal_rating_average',
          targetValue: 4.5,
          subjects: [LOBBY],
        },
        actor,
      )

      await expect(change({ applyToFollowing: true })).resolves.toEqual({
        month: { previous: 25, next: 20 },
        following: { outcome: 'kept_scheduled_change' },
      })

      expect((await stored()).results[0]).toMatchObject({ targetValue: 20 })
      expect((await stored()).versions).toHaveLength(2)
      expect((await stored()).version).toMatchObject({
        metric: 'portal_rating_average',
        targetValue: 4.5,
      })
      expect((await stored()).targetChanges).toEqual([
        expect.objectContaining({
          followingOutcome: 'kept_scheduled_change',
          followingReason: null,
          followingVersionId: null,
        }),
      ])
    })

    it('a scheduled change with another measure is kept even when its number is the same', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      // From April: an average of 4. For March: 4 ratings.
      await service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: goal.program.id,
          metric: 'portal_rating_average',
          targetValue: 4,
          subjects: [LOBBY],
        },
        actor,
      )

      await expect(change({ targetValue: 4, applyToFollowing: true })).resolves.toEqual({
        month: { previous: 25, next: 4 },
        following: { outcome: 'kept_scheduled_change' },
      })
      expect((await stored()).versions).toHaveLength(2)
    })

    it('an archived Portal subject gives not_applied and the month still changes', async () => {
      const { createGoal, change, stored, subjects } = setup()
      await createGoal([LOBBY, POOL])
      // The pool's Portal was archived after the goal was set.
      subjects.subjectBelongsToProperty.mockImplementation(
        async (_organizationId, _propertyId, subject) =>
          !(subject.kind === 'portal' && subject.portalId === POOL_ID),
      )

      await expect(change({ applyToFollowing: true })).resolves.toEqual({
        month: { previous: 25, next: 20 },
        following: { outcome: 'not_applied', reason: 'subject_unavailable' },
      })

      expect((await stored()).results.map((result) => result.targetValue)).toEqual([
        20, 20,
      ])
      // No version is written, and no subject is dropped from the goal.
      expect((await stored()).versions).toHaveLength(1)
      expect((await stored()).targetChanges).toEqual([
        expect.objectContaining({
          followingOutcome: 'not_applied',
          followingReason: 'subject_unavailable',
          followingVersionId: null,
        }),
        expect.objectContaining({
          followingOutcome: 'not_applied',
          followingReason: 'subject_unavailable',
        }),
      ])
    })

    it.each([
      ['is not active', { state: 'unavailable', reason: 'metric_source_not_active' }],
      ['cannot be read', { state: 'unavailable', reason: null }],
      ['is quarantined', { state: 'quarantined', reason: null }],
    ] as const)(
      'a measure whose source %s gives not_applied and the month still changes',
      async (_label, readiness) => {
        const { createGoal, change, stored, metrics } = setup()
        await createGoal()
        metrics.queryGoalMetric.mockResolvedValueOnce({
          definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
          metricKey: 'portal.rating_count',
          exactValue: null,
          sampleCount: 0,
          minimumSample: 0,
          sourceCompleteThrough: null,
          ...readiness,
        })

        await expect(change({ applyToFollowing: true })).resolves.toEqual({
          month: { previous: 25, next: 20 },
          following: { outcome: 'not_applied', reason: 'metric_unavailable' },
        })
        expect((await stored()).results[0]).toMatchObject({ targetValue: 20 })
        expect((await stored()).versions).toHaveLength(1)
      },
    )

    it('a measure that is no longer approved gives not_applied and the month still changes', async () => {
      const { createGoal, change, stored, metrics } = setup()
      await createGoal()
      metrics.getApprovedGoalVersion.mockResolvedValueOnce(null)

      await expect(change({ applyToFollowing: true })).resolves.toMatchObject({
        following: { outcome: 'not_applied', reason: 'metric_unavailable' },
      })
      expect((await stored()).results[0]).toMatchObject({ targetValue: 20 })
    })

    it('a target the months after already have is applied without a new version', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      await service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: goal.program.id,
          metric: 'portal_rating_count',
          targetValue: 20,
          subjects: [LOBBY],
        },
        actor,
      )

      // April is already set to 20; March now follows it.
      await expect(change({ applyToFollowing: true })).resolves.toEqual({
        month: { previous: 25, next: 20 },
        following: { outcome: 'applied', startsAt: APRIL },
      })

      expect((await stored()).versions).toHaveLength(2)
      expect((await stored()).targetChanges).toEqual([
        // The version was written by the earlier change, not by this one.
        expect.objectContaining({
          followingOutcome: 'applied',
          followingVersionId: null,
        }),
      ])
    })

    it('starts the following version one local month later after the Property moved east', async () => {
      const { createGoal, change, stored, subjects } = setup()
      await createGoal()
      subjects.getTimezone.mockResolvedValue('Europe/Sofia')

      // Sofia's April begins before the UTC March ends.
      const sofiaMay = localMonthStart('Europe/Sofia', 2)
      await expect(
        change({ applyToFollowing: true, expectedFollowingMonth: monthKey(2) }),
      ).resolves.toMatchObject({
        following: { outcome: 'applied', startsAt: sofiaMay },
      })
      expect((await stored()).version).toMatchObject({
        propertyTimezone: 'Europe/Sofia',
        effectiveFrom: sofiaMay,
      })
    })
  })

  it('carries the target on after the Property moved west: the months after still start with the month the form named', async () => {
    const { createGoal, change, stored, subjects } = setup()
    await createGoal()
    // The form said "from Apr 1" on a UTC calendar. New York's April begins
    // four hours after the UTC March ends: the same month, and none is skipped.
    subjects.getTimezone.mockResolvedValue('America/New_York')
    const newYorkApril = localMonthStart('America/New_York', 1)

    await expect(change({ applyToFollowing: true })).resolves.toMatchObject({
      following: { outcome: 'applied', startsAt: newYorkApril },
    })
    expect((await stored()).version).toMatchObject({
      propertyTimezone: 'America/New_York',
      effectiveFrom: newYorkApril,
    })
  })

  describe('saving again', () => {
    it('a repeated save writes no new version and no log row', async () => {
      const { createGoal, change, stored, repository } = setup()
      await createGoal()
      const form = { expectedVersion: 1, expectedTarget: 25, applyToFollowing: true }
      await change(form)
      const afterFirst = await stored()
      repository.changeMonthTarget.mockClear()

      // The same form, sent again: its expected target and version are both stale.
      await expect(change(form)).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'applied', startsAt: APRIL },
      })

      expect(await stored()).toEqual(afterFirst)
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
      expect(repository.revise).not.toHaveBeenCalled()
    })

    it('a repeated save of a month-only change writes nothing', async () => {
      const { createGoal, change, stored, repository } = setup()
      await createGoal()
      await change()
      const afterFirst = await stored()
      repository.changeMonthTarget.mockClear()

      await expect(change()).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'not_requested' },
      })
      expect(await stored()).toEqual(afterFirst)
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('the same target with the months after newly asked for writes only the version', async () => {
      const { createGoal, change, stored, repository } = setup()
      await createGoal()
      await change()
      repository.changeMonthTarget.mockClear()

      // The form was opened after the first save: it shows 20 and version 1.
      await expect(
        change({ expectedTarget: 20, applyToFollowing: true }),
      ).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'applied', startsAt: APRIL },
      })

      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
      expect(repository.revise).toHaveBeenCalledOnce()
      expect((await stored()).version).toMatchObject({
        version: 2,
        targetValue: 20,
        effectiveFrom: APRIL,
        changeReason: 'target_changed',
      })
      // The month did not change again, so the log has only the first change.
      expect((await stored()).targetChanges).toHaveLength(1)
    })

    it('the same target with the months after newly asked for keeps the note on the version', async () => {
      const { createGoal, change, stored } = setup()
      await createGoal()
      await change()

      await change({
        expectedTarget: 20,
        applyToFollowing: true,
        note: '  Agreed with the GM for spring  ',
      })

      // No month changed, so no log row can carry the note: the version does,
      // as the version of an ordinary revision would.
      expect((await stored()).version).toMatchObject({
        version: 2,
        targetValue: 20,
        changeReason: 'Agreed with the GM for spring',
      })
      expect((await stored()).targetChanges).toEqual([
        expect.objectContaining({ note: null }),
      ])
    })

    it('a repeated save whose months after could not be changed answers the same again', async () => {
      const { createGoal, change, stored, subjects, repository } = setup()
      await createGoal([LOBBY, POOL])
      // The pool's Portal was archived after the goal was set.
      subjects.subjectBelongsToProperty.mockImplementation(
        async (_organizationId, _propertyId, subject) =>
          !(subject.kind === 'portal' && subject.portalId === POOL_ID),
      )
      const form = { expectedVersion: 1, expectedTarget: 25, applyToFollowing: true }
      await change(form)
      const afterFirst = await stored()
      repository.changeMonthTarget.mockClear()

      // The month has the target now, and the months after still cannot take it.
      await expect(change(form)).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'not_applied', reason: 'subject_unavailable' },
      })

      expect(await stored()).toEqual(afterFirst)
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
      expect(repository.revise).not.toHaveBeenCalled()
    })

    it('carries the target on when someone else already set the month to it', async () => {
      const { createGoal, change, stored } = setup()
      await createGoal()
      // Another manager changed March to 20, for March only, while this form
      // still showed 25. The head is the one this form was opened on.
      await change()

      await expect(
        change({ expectedTarget: 25, applyToFollowing: true }),
      ).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'applied', startsAt: APRIL },
      })

      expect((await stored()).version).toMatchObject({ version: 2, targetValue: 20 })
      expect((await stored()).targetChanges).toHaveLength(1)
    })

    it('a save that lost to the same save sent at the same moment answers unchanged', async () => {
      const { createGoal, change, stored, repository } = setup()
      await createGoal()
      const write = repository.changeMonthTarget.getMockImplementation()
      // Both requests read the goal before either wrote. The other one
      // commits first, so this one finds the month no longer as it read it.
      repository.changeMonthTarget.mockImplementationOnce(async (input) => {
        await write?.(input)
        return 'revision_conflict'
      })

      await expect(change({ applyToFollowing: true })).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'applied', startsAt: APRIL },
      })

      expect((await stored()).results[0]).toMatchObject({ targetValue: 20 })
      expect((await stored()).targetChanges).toHaveLength(1)
      expect((await stored()).versions).toHaveLength(2)
      expect(repository.changeMonthTarget).toHaveBeenCalledOnce()
    })

    it('a save that lost to another change of the month is refused', async () => {
      const { createGoal, change, stored, repository } = setup()
      await createGoal()
      const write = repository.changeMonthTarget.getMockImplementation()
      // Someone else's 22 lands between this save's read and its write.
      repository.changeMonthTarget.mockImplementationOnce(async (input) => {
        await write?.({ ...input, targetValue: 22, storedTargetValue: 22 })
        return 'revision_conflict'
      })

      await expect(change()).rejects.toMatchObject(refusal('revision_conflict'))
      expect((await stored()).results[0]).toMatchObject({ targetValue: 22 })
      expect(repository.changeMonthTarget).toHaveBeenCalledOnce()
    })

    it('a stale form cannot replace a scheduled change through a repeated save', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      await change()
      // Another manager schedules 40 from April after this form was opened.
      await service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: goal.program.id,
          metric: 'portal_rating_count',
          targetValue: 40,
          subjects: [LOBBY],
        },
        actor,
      )

      await expect(
        change({ expectedVersion: 1, expectedTarget: 20, applyToFollowing: true }),
      ).rejects.toMatchObject(refusal('revision_conflict'))
      expect((await stored()).version).toMatchObject({ version: 2, targetValue: 40 })
    })
  })

  it('a later revision returns the goal with the month’s change log still on it', async () => {
    const { createGoal, change, service } = setup()
    const goal = await createGoal()
    await change()

    const revisedGoal = await service.revise(
      {
        propertyId: PROPERTY_ID,
        programId: goal.program.id,
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [LOBBY],
      },
      actor,
    )

    expect(revisedGoal.targetChanges).toEqual([
      expect.objectContaining({ previousTargetValue: 25, newTargetValue: 20 }),
    ])
  })

  describe('what the month says afterwards', () => {
    const marker = (bundle: GoalProgramBundle) => {
      const month = bundle.results[0]
      if (!month) throw new Error('the goal has no month')
      return monthTargetMarker(bundle, month, bundle.versions[0] ?? bundle.version)
    }

    it('two changes in one month report the starting target and a count of two', async () => {
      const { createGoal, change, stored, setNow } = setup()
      await createGoal()
      await change({ targetValue: 22 })
      setNow(RUNNING.late)
      await change({ targetValue: 20, expectedTarget: 22 })

      expect(marker(await stored())).toEqual({
        changedAt: RUNNING.late,
        changedBy: 'manager-1',
        startTarget: 25,
        changeCount: 2,
      })
      expect(monthTargetPlan(await stored(), RUNNING.late, 'UTC')).toMatchObject({
        effectiveTarget: 20,
        startTarget: 25,
        changeCount: 2,
      })
    })

    it('a change back to the starting target shows no marker', async () => {
      const { createGoal, change, stored, setNow } = setup()
      await createGoal()
      await change({ targetValue: 20 })
      setNow(RUNNING.late)

      await expect(change({ targetValue: 25, expectedTarget: 20 })).resolves.toEqual({
        month: { previous: 20, next: 25 },
        following: { outcome: 'not_requested' },
      })

      // The month uses its version's target again and stores none of its own.
      expect((await stored()).results[0]).toMatchObject({ targetValue: null })
      expect(marker(await stored())).toBeNull()
      expect((await stored()).targetChanges).toEqual([
        expect.objectContaining({ previousTargetValue: 25, newTargetValue: 20 }),
        expect.objectContaining({ previousTargetValue: 20, newTargetValue: 25 }),
      ])
    })

    it('a change back that also covers the months after needs no version: they never left that target', async () => {
      const { createGoal, change, stored } = setup()
      await createGoal()
      await change({ targetValue: 20 })

      await expect(
        change({ targetValue: 25, expectedTarget: 20, applyToFollowing: true }),
      ).resolves.toEqual({
        month: { previous: 20, next: 25 },
        following: { outcome: 'applied', startsAt: APRIL },
      })
      expect((await stored()).versions).toHaveLength(1)
    })
  })
})
