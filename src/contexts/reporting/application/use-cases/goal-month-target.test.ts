// Changing the target of a month that is still running.
//
// The repository here is an in-memory stand-in that keeps the port's contract
// for the calls the command makes: one Program, its versions, months and the
// log of target changes. What PostgreSQL adds (the transaction, the row locks
// and the guard on the database clock) is pinned in
// infrastructure/repositories/goal-month-target.repository.test.ts.
import { describe, expect, it, vi } from 'vitest'
import type { GovernedMetricVersion } from '../../domain/metric-registry'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { GoalSubject } from '../../domain/goal-program'
import { monthTargetMarker } from '../goal-month-target-marker'
import { monthTargetPlan } from '../goal-month-target-plan'
import type {
  GoalMonthTargetChange,
  GoalProgramBundle,
  GoalProgramRepository,
} from '../ports/goal-program.repository'
import {
  createGoalProgramService,
  type GoalActor,
  type GoalMetricReadPort,
  type GoalProgramSubjectReader,
} from './goal-programs'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}

const MARCH = new Date('2026-03-01T00:00:00.000Z')
const APRIL = new Date('2026-04-01T00:00:00.000Z')
const MARCH_15 = new Date('2026-03-15T12:00:00.000Z')
const MARCH_20 = new Date('2026-03-20T12:00:00.000Z')

const LOBBY: GoalSubject = { kind: 'portal', portalId: 'portal-lobby' }
const POOL: GoalSubject = { kind: 'portal', portalId: 'portal-pool' }

type ChangeInput = Parameters<GoalProgramRepository['changeMonthTarget']>[0]
type ReviseInput = Parameters<GoalProgramRepository['revise']>[0]

/** The stored Program as a revision leaves it, or null when the port refuses it. */
function revised(
  stored: GoalProgramBundle,
  input: ReviseInput,
): GoalProgramBundle | null {
  if (stored.version.id !== input.expectedVersion.id) return null
  const headHasMonths = stored.results.some(
    (result) => result.programVersionId === input.expectedVersion.id,
  )
  if (input.supersedeRowlessHead && headHasMonths) return null
  const closedAt = (window: Readonly<{ effectiveFrom: Date }>) =>
    input.supersedeRowlessHead ? window.effectiveFrom : input.version.effectiveFrom
  return {
    ...stored,
    program: {
      ...stored.program,
      currentVersion: input.version.version,
      updatedAt: input.at,
    },
    version: input.version,
    versions: [
      ...stored.versions.map((known) =>
        known.id === input.expectedVersion.id
          ? { ...known, effectiveTo: closedAt(known) }
          : known,
      ),
      input.version,
    ],
    assignments: [
      ...stored.assignments.map((known) =>
        known.programVersionId === input.expectedVersion.id && known.effectiveTo === null
          ? { ...known, effectiveTo: closedAt(known) }
          : known,
      ),
      ...input.assignments,
    ],
  }
}

/** The answer of the port, with the Program as the change leaves it. */
function monthTargetChanged(
  stored: GoalProgramBundle,
  input: ChangeInput,
  databaseNow: Date,
): Readonly<{ answer: 'revision_conflict' | 'month_locked' }> | GoalProgramBundle {
  if (
    stored.program.status === 'ended' ||
    stored.version.id !== input.expectedVersion.id
  ) {
    return { answer: 'revision_conflict' }
  }
  const afterRevision = input.following.revision
    ? revised(stored, {
        ...input.following.revision,
        expectedVersion: input.expectedVersion,
        actorId: input.actorId,
        at: input.at,
      })
    : stored
  if (!afterRevision) return { answer: 'revision_conflict' }
  const running = stored.results.filter(
    (result) =>
      result.status === 'open' &&
      result.periodStart <= input.at &&
      input.at < result.periodEnd,
  )
  const planned = new Map(input.months.map((month) => [month.monthlyResultId, month]))
  if ([...planned.keys()].some((id) => !running.some((result) => result.id === id))) {
    return { answer: 'month_locked' }
  }
  if (
    running.some(
      (result) => planned.get(result.id)?.storedTargetValue !== result.targetValue,
    )
  ) {
    return { answer: 'revision_conflict' }
  }
  // The guard reads the database clock, not the command's.
  if (running.some((result) => databaseNow >= result.periodEnd)) {
    return { answer: 'month_locked' }
  }
  const logged: readonly GoalMonthTargetChange[] = input.months.map((month) => ({
    id: month.changeRowId,
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    programId: input.programId,
    monthlyResultId: month.monthlyResultId,
    changeId: input.changeId,
    previousTargetValue: month.previousTargetValue,
    newTargetValue: input.targetValue,
    followingOutcome: input.following.outcome,
    followingReason: input.following.reason,
    followingVersionId: input.following.revision?.version.id ?? null,
    note: input.note,
    createdBy: input.actorId,
    createdAt: input.at,
  }))
  return {
    ...afterRevision,
    results: afterRevision.results.map((result) =>
      planned.has(result.id)
        ? { ...result, targetValue: input.storedTargetValue, updatedAt: input.at }
        : result,
    ),
    targetChanges: [...(afterRevision.targetChanges ?? []), ...logged],
  }
}

function setup(initialNow = MARCH_15) {
  let id = 0
  let now = initialNow
  let databaseNow: Date | null = null
  let stored: GoalProgramBundle | null = null
  const must = (): GoalProgramBundle => {
    if (!stored) throw new Error('no Program is stored')
    return stored
  }
  const repository = {
    create: vi.fn<GoalProgramRepository['create']>(async ({ bundle }) => {
      stored = { ...bundle, targetChanges: [] }
      return 'created'
    }),
    get: vi.fn<GoalProgramRepository['get']>(async () => stored),
    isOrganizationHeld: vi.fn<GoalProgramRepository['isOrganizationHeld']>(
      async () => false,
    ),
    findAssignmentConflicts: vi.fn<GoalProgramRepository['findAssignmentConflicts']>(
      async () => [],
    ),
    appendResults: vi.fn<GoalProgramRepository['appendResults']>(async ({ results }) => {
      stored = { ...must(), results: [...must().results, ...results] }
      return results.length
    }),
    changeStatus: vi.fn<GoalProgramRepository['changeStatus']>(async (input) => {
      const program = { ...must().program, status: input.status, updatedAt: input.at }
      stored = { ...must(), program }
      return program
    }),
    revise: vi.fn<GoalProgramRepository['revise']>(async (input) => {
      const next = revised(must(), input)
      if (next) stored = next
      return next !== null
    }),
    changeMonthTarget: vi.fn<GoalProgramRepository['changeMonthTarget']>(
      async (input) => {
        const next = monthTargetChanged(must(), input, databaseNow ?? input.at)
        if ('answer' in next) return next.answer
        stored = next
        return 'changed'
      },
    ),
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
    >(
      async (versionId) =>
        ({
          definition: { id: `definition-${versionId}` },
          version: {
            id: versionId,
            minimumSample:
              versionId === METRIC_VERSION_IDS.portalRatingAverageGoal ? 10 : 0,
          },
        }) as unknown as GovernedMetricVersion,
    ),
  }
  const subjects = {
    getTimezone: vi.fn<GoalProgramSubjectReader['getTimezone']>(async () => 'UTC'),
    subjectBelongsToProperty: vi.fn<GoalProgramSubjectReader['subjectBelongsToProperty']>(
      async () => true,
    ),
    listCurrentPortalIds: vi.fn<GoalProgramSubjectReader['listCurrentPortalIds']>(
      async () => [],
    ),
  }
  const policy = { authorize: vi.fn(async () => undefined) }
  const service = createGoalProgramService({
    repository: repository as unknown as GoalProgramRepository,
    policy,
    subjects,
    metrics,
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => now,
  })

  /** A goal of 25 ratings for March, set before the month and counting since its first day. */
  const createGoal = async (goalSubjects: readonly GoalSubject[] = [LOBBY]) => {
    const createdAt = now
    now = MARCH
    const bundle = await service.create(
      {
        propertyId: 'property-1',
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: goalSubjects,
        startMonth: '2026-03',
      },
      actor,
    )
    now = createdAt
    return bundle
  }
  const change = (patch: Partial<Parameters<typeof service.changeMonthTarget>[0]> = {}) =>
    service.changeMonthTarget(
      {
        propertyId: 'property-1',
        programId: must().program.id,
        month: '2026-03',
        targetValue: 20,
        expectedTarget: 25,
        expectedVersion: must().program.currentVersion,
        expectedFollowingMonth: '2026-04',
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
    stored: must,
    setNow: (next: Date) => {
      now = next
    },
    setDatabaseNow: (next: Date) => {
      databaseNow = next
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
      propertyId: 'property-1',
      action: 'goal.update',
    })
    expect(stored().results).toEqual([
      expect.objectContaining({ id: goal.results[0]?.id, targetValue: 20 }),
    ])
    expect(stored().targetChanges).toEqual([
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
        createdAt: MARCH_15,
      }),
    ])
    // The version keeps the target the goal was set with, and no version is written.
    expect(stored().versions).toEqual([expect.objectContaining({ targetValue: 25 })])
    expect(repository.revise).not.toHaveBeenCalled()
  })

  it('stores no note when none was written', async () => {
    const { createGoal, change, stored } = setup()
    await createGoal()

    await change({ note: '   ' })

    expect(stored().targetChanges).toEqual([expect.objectContaining({ note: null })])
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
      setNow(new Date('2026-04-01T00:05:00.000Z'))
      await expect(change()).rejects.toMatchObject(refusal('month_locked'))

      expect(stored().results.map((result) => result.periodStart)).toEqual([MARCH, APRIL])
      expect(stored().results.every((result) => result.targetValue === null)).toBe(true)
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('refuses after the period end for a paused goal, whose next month never opened', async () => {
      const { createGoal, change, service, stored, setNow } = setup()
      const goal = await createGoal()
      await service.changeStatus(
        { propertyId: 'property-1', programId: goal.program.id, status: 'paused' },
        actor,
      )

      setNow(new Date('2026-04-01T00:05:00.000Z'))
      await expect(change()).rejects.toMatchObject(refusal('month_locked'))
      expect(stored().results).toHaveLength(1)
    })

    it('refuses with month_locked when the database finds the period over', async () => {
      // The command's clock still reads March; the database's has passed it.
      const { createGoal, change, stored, setNow, setDatabaseNow } = setup()
      await createGoal()
      setNow(new Date('2026-03-31T23:59:59.900Z'))
      setDatabaseNow(APRIL)

      await expect(change({ applyToFollowing: true })).rejects.toMatchObject(
        refusal('month_locked'),
      )
      expect(stored().results[0]).toMatchObject({ targetValue: null })
      expect(stored().versions).toHaveLength(1)
      expect(stored().targetChanges).toEqual([])
    })

    it('opens a month that has begun before it looks for the running month', async () => {
      const { createGoal, change, stored, setNow } = setup()
      await createGoal()

      // The hourly job has not opened April yet.
      setNow(new Date('2026-04-01T00:05:00.000Z'))
      await expect(change({ month: '2026-04' })).resolves.toMatchObject({
        month: { previous: 25, next: 20 },
      })

      expect(stored().results).toEqual([
        expect.objectContaining({ periodStart: MARCH, targetValue: null }),
        expect.objectContaining({ periodStart: APRIL, targetValue: 20 }),
      ])
    })

    it('a scheduled goal has no open month', async () => {
      const { service, change, repository } = setup(new Date('2026-02-20T12:00:00.000Z'))
      await service.create(
        {
          propertyId: 'property-1',
          name: 'March ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [LOBBY],
          startMonth: '2026-03',
        },
        actor,
      )

      await expect(change({ month: '2026-02' })).rejects.toMatchObject(
        refusal('no_open_month'),
      )
      await expect(change({ month: '2026-03' })).rejects.toMatchObject(
        refusal('no_open_month'),
      )
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('a paused goal’s running month can be changed', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      await service.changeStatus(
        { propertyId: 'property-1', programId: goal.program.id, status: 'paused' },
        actor,
      )

      await expect(change()).resolves.toMatchObject({ month: { previous: 25, next: 20 } })
      expect(stored().results[0]).toMatchObject({ targetValue: 20 })
    })

    it('an ended goal is refused', async () => {
      const { createGoal, change, service, repository } = setup()
      const goal = await createGoal()
      await service.changeStatus(
        { propertyId: 'property-1', programId: goal.program.id, status: 'ended' },
        actor,
      )

      await expect(change()).rejects.toMatchObject(refusal('invalid_transition'))
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
    })

    it('changing a multi-subject goal updates every running row under one change id', async () => {
      const { createGoal, change, stored } = setup()
      await createGoal([LOBBY, POOL])

      await change()

      expect(stored().results.map((result) => result.targetValue)).toEqual([20, 20])
      const logged = stored().targetChanges ?? []
      expect(logged.map((row) => row.monthlyResultId).sort()).toEqual(
        stored()
          .results.map((result) => result.id)
          .sort(),
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
          propertyId: 'property-1',
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
      expect(stored().results[0]).toMatchObject({ targetValue: 30 })
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
      expect(stored().results[0]).toMatchObject({ targetValue: 22 })
      expect(stored().targetChanges).toHaveLength(1)
    })

    it('refuses a stale expected version', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      // Another manager scheduled a change after the form opened on version 1.
      await service.revise(
        {
          propertyId: 'property-1',
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
      expect(stored().results[0]).toMatchObject({ targetValue: null })
      expect(stored().version).toMatchObject({ version: 2, targetValue: 40 })
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
      expect(stored().results[0]).toMatchObject({ targetValue: null })
      expect(stored().versions).toHaveLength(1)
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
      setNow(MARCH_20)

      await expect(
        change({ applyToFollowing: true, note: 'Fewer guests' }),
      ).resolves.toEqual({
        month: { previous: 25, next: 20 },
        following: { outcome: 'applied', startsAt: APRIL },
      })

      // One call writes the month, the log and the version together.
      expect(repository.changeMonthTarget).toHaveBeenCalledOnce()
      expect(repository.revise).not.toHaveBeenCalled()
      const [first, second] = stored().versions
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
        createdAt: MARCH_20,
      })
      expect(stored().program.currentVersion).toBe(2)
      expect(
        stored()
          .assignments.filter((assignment) => assignment.programVersionId === second?.id)
          .map((assignment) => [assignment.subject, assignment.effectiveFrom]),
      ).toEqual([
        [LOBBY, APRIL],
        [POOL, APRIL],
      ])
      // The note is the change's: the log carries it, and the version records
      // only what kind of change it was.
      expect(stored().targetChanges).toEqual([
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
      expect(stored().results.map((result) => result.programVersionId)).toEqual([
        goal.version.id,
        goal.version.id,
      ])
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
      expect(stored().results[0]).toMatchObject({ targetValue: null })
      expect(stored().versions).toHaveLength(1)
      expect(stored().targetChanges).toEqual([])
      expect(repository.revise).not.toHaveBeenCalled()
    })

    it('a scheduled change with the same measure is replaced and logged as replaced', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      // From April: 40 ratings, for the lobby and the pool.
      await service.revise(
        {
          propertyId: 'property-1',
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

      const [inForce, replaced, head] = stored().versions
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
        stored()
          .assignments.filter((assignment) => assignment.programVersionId === head?.id)
          .map((assignment) => assignment.subject),
      ).toEqual([LOBBY, POOL])
      expect(stored().targetChanges).toEqual([
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
          propertyId: 'property-1',
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

      expect(stored().results[0]).toMatchObject({ targetValue: 20 })
      expect(stored().versions).toHaveLength(2)
      expect(stored().version).toMatchObject({
        metric: 'portal_rating_average',
        targetValue: 4.5,
      })
      expect(stored().targetChanges).toEqual([
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
          propertyId: 'property-1',
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
      expect(stored().versions).toHaveLength(2)
    })

    it('an archived Portal subject gives not_applied and the month still changes', async () => {
      const { createGoal, change, stored, subjects } = setup()
      await createGoal([LOBBY, POOL])
      // The pool's Portal was archived after the goal was set.
      subjects.subjectBelongsToProperty.mockImplementation(
        async (_organizationId, _propertyId, subject) =>
          !(subject.kind === 'portal' && subject.portalId === 'portal-pool'),
      )

      await expect(change({ applyToFollowing: true })).resolves.toEqual({
        month: { previous: 25, next: 20 },
        following: { outcome: 'not_applied', reason: 'subject_unavailable' },
      })

      expect(stored().results.map((result) => result.targetValue)).toEqual([20, 20])
      // No version is written, and no subject is dropped from the goal.
      expect(stored().versions).toHaveLength(1)
      expect(stored().targetChanges).toEqual([
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
        expect(stored().results[0]).toMatchObject({ targetValue: 20 })
        expect(stored().versions).toHaveLength(1)
      },
    )

    it('a measure that is no longer approved gives not_applied and the month still changes', async () => {
      const { createGoal, change, stored, metrics } = setup()
      await createGoal()
      metrics.getApprovedGoalVersion.mockResolvedValueOnce(null)

      await expect(change({ applyToFollowing: true })).resolves.toMatchObject({
        following: { outcome: 'not_applied', reason: 'metric_unavailable' },
      })
      expect(stored().results[0]).toMatchObject({ targetValue: 20 })
    })

    it('a target the months after already have is applied without a new version', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      await service.revise(
        {
          propertyId: 'property-1',
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

      expect(stored().versions).toHaveLength(2)
      expect(stored().targetChanges).toEqual([
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
      const sofiaMay = new Date('2026-04-30T21:00:00.000Z')
      await expect(
        change({ applyToFollowing: true, expectedFollowingMonth: '2026-05' }),
      ).resolves.toMatchObject({
        following: { outcome: 'applied', startsAt: sofiaMay },
      })
      expect(stored().version).toMatchObject({
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
    const newYorkApril = new Date('2026-04-01T04:00:00.000Z')

    await expect(change({ applyToFollowing: true })).resolves.toMatchObject({
      following: { outcome: 'applied', startsAt: newYorkApril },
    })
    expect(stored().version).toMatchObject({
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
      const afterFirst = stored()
      repository.changeMonthTarget.mockClear()

      // The same form, sent again: its expected target and version are both stale.
      await expect(change(form)).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'applied', startsAt: APRIL },
      })

      expect(stored()).toBe(afterFirst)
      expect(repository.changeMonthTarget).not.toHaveBeenCalled()
      expect(repository.revise).not.toHaveBeenCalled()
    })

    it('a repeated save of a month-only change writes nothing', async () => {
      const { createGoal, change, stored, repository } = setup()
      await createGoal()
      await change()
      const afterFirst = stored()
      repository.changeMonthTarget.mockClear()

      await expect(change()).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'not_requested' },
      })
      expect(stored()).toBe(afterFirst)
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
      expect(stored().version).toMatchObject({
        version: 2,
        targetValue: 20,
        effectiveFrom: APRIL,
        changeReason: 'target_changed',
      })
      // The month did not change again, so the log has only the first change.
      expect(stored().targetChanges).toHaveLength(1)
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
      expect(stored().version).toMatchObject({
        version: 2,
        targetValue: 20,
        changeReason: 'Agreed with the GM for spring',
      })
      expect(stored().targetChanges).toEqual([expect.objectContaining({ note: null })])
    })

    it('a repeated save whose months after could not be changed answers the same again', async () => {
      const { createGoal, change, stored, subjects, repository } = setup()
      await createGoal([LOBBY, POOL])
      // The pool's Portal was archived after the goal was set.
      subjects.subjectBelongsToProperty.mockImplementation(
        async (_organizationId, _propertyId, subject) =>
          !(subject.kind === 'portal' && subject.portalId === 'portal-pool'),
      )
      const form = { expectedVersion: 1, expectedTarget: 25, applyToFollowing: true }
      await change(form)
      const afterFirst = stored()
      repository.changeMonthTarget.mockClear()

      // The month has the target now, and the months after still cannot take it.
      await expect(change(form)).resolves.toEqual({
        month: 'unchanged',
        following: { outcome: 'not_applied', reason: 'subject_unavailable' },
      })

      expect(stored()).toBe(afterFirst)
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

      expect(stored().version).toMatchObject({ version: 2, targetValue: 20 })
      expect(stored().targetChanges).toHaveLength(1)
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

      expect(stored().results[0]).toMatchObject({ targetValue: 20 })
      expect(stored().targetChanges).toHaveLength(1)
      expect(stored().versions).toHaveLength(2)
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
      expect(stored().results[0]).toMatchObject({ targetValue: 22 })
      expect(repository.changeMonthTarget).toHaveBeenCalledOnce()
    })

    it('a stale form cannot replace a scheduled change through a repeated save', async () => {
      const { createGoal, change, service, stored } = setup()
      const goal = await createGoal()
      await change()
      // Another manager schedules 40 from April after this form was opened.
      await service.revise(
        {
          propertyId: 'property-1',
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
      expect(stored().version).toMatchObject({ version: 2, targetValue: 40 })
    })
  })

  it('a later revision returns the goal with the month’s change log still on it', async () => {
    const { createGoal, change, service } = setup()
    const goal = await createGoal()
    await change()

    const revisedGoal = await service.revise(
      {
        propertyId: 'property-1',
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
      setNow(MARCH_20)
      await change({ targetValue: 20, expectedTarget: 22 })

      expect(marker(stored())).toEqual({
        changedAt: MARCH_20,
        changedBy: 'manager-1',
        startTarget: 25,
        changeCount: 2,
      })
      expect(monthTargetPlan(stored(), MARCH_20, 'UTC')).toMatchObject({
        effectiveTarget: 20,
        startTarget: 25,
        changeCount: 2,
      })
    })

    it('a change back to the starting target shows no marker', async () => {
      const { createGoal, change, stored, setNow } = setup()
      await createGoal()
      await change({ targetValue: 20 })
      setNow(MARCH_20)

      await expect(change({ targetValue: 25, expectedTarget: 20 })).resolves.toEqual({
        month: { previous: 20, next: 25 },
        following: { outcome: 'not_requested' },
      })

      // The month uses its version's target again and stores none of its own.
      expect(stored().results[0]).toMatchObject({ targetValue: null })
      expect(marker(stored())).toBeNull()
      expect(stored().targetChanges).toEqual([
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
      expect(stored().versions).toHaveLength(1)
    })
  })
})
