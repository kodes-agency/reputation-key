// Changing the target of a month that is still running, against PostgreSQL:
// saving the same change again, and what the month says afterwards.
import { describe, expect, it } from 'vitest'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import { monthTargetMarker } from '../application/goal-month-target-marker'
import { monthTargetPlan } from '../application/goal-month-target-plan'
import {
  APRIL,
  LOBBY,
  POOL,
  POOL_ID,
  RUNNING,
  refusal,
  useMonthTargetScenario,
} from './goal-month-target-setup.test-fixtures'

const { setup } = useMonthTargetScenario()

describe('changeMonthTarget', () => {
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
      const { createGoal, change, stored, schedule } = setup()
      const goal = await createGoal()
      await change()
      // Another manager schedules 40 from April after this form was opened.
      await schedule(goal, {
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [LOBBY],
      })

      await expect(
        change({ expectedVersion: 1, expectedTarget: 20, applyToFollowing: true }),
      ).rejects.toMatchObject(refusal('revision_conflict'))
      expect((await stored()).version).toMatchObject({ version: 2, targetValue: 40 })
    })
  })

  it('a later revision returns the goal with the month’s change log still on it', async () => {
    const { createGoal, change, schedule } = setup()
    const goal = await createGoal()
    await change()

    const revisedGoal = await schedule(goal, {
      metric: 'portal_rating_count',
      targetValue: 40,
      subjects: [LOBBY],
    })

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
