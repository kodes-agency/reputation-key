// Changing the target of a month that is still running, against PostgreSQL.
//
// The harness, calendar and savepoint scenario are in goal-month-target-setup.test-fixtures.ts.
import { describe, expect, it } from 'vitest'
import { actor, PROPERTY_ID } from './goal-program-service.test-fixtures'
import {
  APRIL,
  LOBBY,
  MARCH,
  MINUTE_MS,
  POOL,
  RUNNING,
  calendarAt,
  monthKey,
  refusal,
  useMonthTargetScenario,
} from './goal-month-target-setup.test-fixtures'

const { setup } = useMonthTargetScenario()

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
      const { createGoal, change, stored, setNow, setStatus } = setup()
      const goal = await createGoal()
      await setStatus(goal, 'paused')

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
      const { createGoal, change, stored, setStatus } = setup()
      const goal = await createGoal()
      await setStatus(goal, 'paused')

      await expect(change()).resolves.toMatchObject({ month: { previous: 25, next: 20 } })
      expect((await stored()).results[0]).toMatchObject({ targetValue: 20 })
    })

    it('an ended goal is refused', async () => {
      const { createGoal, change, repository, setStatus } = setup()
      const goal = await createGoal()
      await setStatus(goal, 'ended')

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
      const { createGoal, change, stored, schedule } = setup()
      const goal = await createGoal()
      // From April the goal measures the average rating; March still counts ratings.
      await schedule(goal, {
        metric: 'portal_rating_average',
        targetValue: 4.5,
        subjects: [LOBBY],
      })

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
      const { createGoal, change, stored, schedule } = setup()
      const goal = await createGoal()
      // Another manager scheduled a change after the form opened on version 1.
      await schedule(goal, {
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [LOBBY],
      })

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
      const { createGoal, change, stored, repository, setStatus } = setup()
      const goal = await createGoal()
      const write = repository.changeMonthTarget.getMockImplementation()
      repository.changeMonthTarget.mockImplementationOnce(async (input) => {
        await setStatus(goal, 'ended')
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
})
