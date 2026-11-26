// Changing the target of a month that is still running, against PostgreSQL:
// what happens to the months after it.
import { describe, expect, it } from 'vitest'
import { METRIC_VERSION_IDS } from '../readings/contracts'
import {
  APRIL,
  LOBBY,
  POOL,
  POOL_ID,
  RUNNING,
  localMonthStart,
  monthKey,
  refusal,
  useMonthTargetScenario,
} from './goal-month-target-setup.test-fixtures'

const { setup, versionRow } = useMonthTargetScenario()

describe('changeMonthTarget', () => {
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
      const { createGoal, change, stored, schedule } = setup()
      const goal = await createGoal()
      // From April: 40 ratings, for the lobby and the pool.
      await schedule(goal, {
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [LOBBY, POOL],
      })

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
      const { createGoal, change, stored, schedule } = setup()
      const goal = await createGoal()
      await schedule(goal, {
        metric: 'portal_rating_average',
        targetValue: 4.5,
        subjects: [LOBBY],
      })

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
      const { createGoal, change, stored, schedule } = setup()
      const goal = await createGoal()
      // From April: an average of 4. For March: 4 ratings.
      await schedule(goal, {
        metric: 'portal_rating_average',
        targetValue: 4,
        subjects: [LOBBY],
      })

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
      const { createGoal, change, stored, schedule } = setup()
      const goal = await createGoal()
      await schedule(goal, {
        metric: 'portal_rating_count',
        targetValue: 20,
        subjects: [LOBBY],
      })

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
})
