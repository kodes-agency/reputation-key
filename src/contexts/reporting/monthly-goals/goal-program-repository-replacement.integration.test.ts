import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { GoalProgramVersion } from '../application/ports/goal-program.repository'
import {
  FEBRUARY,
  followingVersion,
  JANUARY,
  MARCH,
  openMonth,
  windowsOf,
} from './goal-program-bundle.test-fixtures'
import { useGoalProgramRepositorySuite } from './goal-program-repository-suite.test-fixtures'

// A head with no month (a goal that has not started, or a change still
// waiting for its month) is replaced by the next change. The replaced version
// and its assignments keep the empty window [from, from).
describe.sequential(
  'Goal Program repository replacing a head that has no month (integration)',
  () => {
    const suite = useGoalProgramRepositorySuite('goal-program-replacement')
    const { organizationId } = suite
    const plannedAt = new Date('2026-01-15T12:00:00.000Z')
    const editedAt = new Date('2026-01-20T12:00:00.000Z')
    const january = JANUARY
    const february = FEBRUARY
    const march = MARCH

    /** A goal set mid-January for February: scheduled, with no month yet. */
    const scheduledForFebruary = (label: string) =>
      suite.seed(label, {
        status: 'scheduled',
        effectiveFrom: february.start,
        at: plannedAt,
      })

    const following = (
      previous: GoalProgramVersion,
      effectiveFrom: Date,
      target: number,
    ) => followingVersion(previous, effectiveFrom, target, editedAt)

    it('superseding a rowless head leaves an empty version window and no overlap', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Superseded Goal Property',
      )
      const second = following(bundle.version, february.start, 40)
      await expect(
        repository.revise({
          expectedVersion: bundle.version,
          ...second,
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)
      // A second change replaces the first one the same way, even when it
      // starts a month later (the Property changed time zone, say): the
      // replaced plan never covered the month in between.
      const third = following(second.version, march.start, 55)
      await expect(
        repository.revise({
          expectedVersion: second.version,
          ...third,
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)

      const replaced = await repository.getHistory(
        organizationId,
        targetPropertyId,
        bundle.program.id,
      )
      expect(replaced).toMatchObject({
        program: { status: 'scheduled', currentVersion: 3 },
        version: { id: third.version.id, targetValue: 55 },
        results: [],
      })
      // Two versions and two assignments of one subject share one start; the
      // empty windows overlap nothing, so both no-overlap constraints hold.
      expect(windowsOf(replaced)).toEqual({
        versions: [
          [1, february.start, february.start],
          [2, february.start, february.start],
          [3, march.start, null],
        ],
        assignments: [
          [1, february.start, february.start],
          [2, february.start, february.start],
          [3, march.start, null],
        ],
      })
    })

    it('replaces a change still waiting for its month and leaves the version in force alone', async () => {
      const repository = suite.repository()
      const targetPropertyId = await suite.createProperty('Pending Change Property')
      const running = suite.bundle({
        propertyId: targetPropertyId,
        status: 'active',
        effectiveFrom: january.start,
        at: january.start,
        withOpenResult: { end: january.end },
      })
      await repository.create({ bundle: running, auditAction: 'goal.program.created' })
      const pending = following(running.version, february.start, 40)
      await expect(
        repository.revise({
          expectedVersion: running.version,
          ...pending,
          supersedeRowlessHead: false,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)

      const replacement = following(pending.version, february.start, 55)
      await expect(
        repository.revise({
          expectedVersion: pending.version,
          ...replacement,
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)

      const replaced = await repository.getHistory(
        organizationId,
        targetPropertyId,
        running.program.id,
      )
      expect(windowsOf(replaced).versions).toEqual([
        [1, january.start, january.end],
        [2, february.start, february.start],
        [3, february.start, null],
      ])
      // January stays open under the version it opened with.
      expect(replaced?.results).toMatchObject([
        { programVersionId: running.version.id, status: 'open' },
      ])
    })

    it('refuses to replace a head that has a month, and changes nothing', async () => {
      const repository = suite.repository()
      const targetPropertyId = await suite.createProperty('Started Goal Property')
      const running = suite.bundle({
        propertyId: targetPropertyId,
        status: 'active',
        effectiveFrom: january.start,
        at: january.start,
        withOpenResult: { end: january.end },
      })
      await repository.create({ bundle: running, auditAction: 'goal.program.created' })

      await expect(
        repository.revise({
          expectedVersion: running.version,
          ...following(running.version, february.start, 40),
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(false)
      await expect(
        repository.getHistory(organizationId, targetPropertyId, running.program.id),
      ).resolves.toMatchObject({
        program: { currentVersion: 1 },
        version: { id: running.version.id, effectiveTo: null },
        versions: [{ id: running.version.id }],
      })
    })

    it('a superseded assignment does not block another goal for that subject', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Released Subject Property',
      )
      const portalId = randomUUID()
      await suite.pool.query(
        `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $5, 'Lobby QR', $4)`,
        [
          portalId,
          organizationId,
          targetPropertyId,
          `lobby-${randomUUID()}`,
          targetPropertyId,
        ],
      )
      // The change moves the goal from the whole Property to one Portal.
      const moved = following(bundle.version, february.start, 25)
      await expect(
        repository.revise({
          expectedVersion: bundle.version,
          version: moved.version,
          assignments: moved.assignments.map((subjectAssignment) => ({
            ...subjectAssignment,
            subject: { kind: 'portal', portalId },
          })),
          supersedeRowlessHead: true,
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)

      // The Property subject is free from February, as if never planned.
      await expect(
        repository.findAssignmentConflicts({
          organizationId,
          propertyId: targetPropertyId,
          metric: 'portal_rating_count',
          effectiveFrom: february.start,
          subjects: [{ kind: 'property', propertyId: targetPropertyId }],
        }),
      ).resolves.toEqual([])
      const other = suite.bundle({
        propertyId: targetPropertyId,
        status: 'scheduled',
        effectiveFrom: february.start,
        at: editedAt,
      })
      await expect(
        repository.create({ bundle: other, auditAction: 'goal.program.created' }),
      ).resolves.toBe('created')
      // The Portal the goal moved to is held, by the new head.
      await expect(
        repository.findAssignmentConflicts({
          organizationId,
          propertyId: targetPropertyId,
          metric: 'portal_rating_count',
          effectiveFrom: february.start,
          subjects: [{ kind: 'portal', portalId }],
        }),
      ).resolves.toEqual([
        {
          subject: { kind: 'portal', portalId },
          programId: bundle.program.id,
          effectiveTo: null,
        },
      ])
    })

    it('activation after a supersede activates the new head', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Activated Head Property',
      )
      const second = following(bundle.version, february.start, 40)
      await repository.revise({
        expectedVersion: bundle.version,
        ...second,
        supersedeRowlessHead: true,
        actorId: 'manager-1',
        at: editedAt,
      })
      const current = await repository.getHistory(
        organizationId,
        targetPropertyId,
        bundle.program.id,
      )
      if (!current) throw new Error('expected the superseded Goal Program')

      await expect(
        repository.activate({
          bundle: current,
          results: [
            openMonth(
              second.assignments[0]!,
              february.start,
              february.end,
              february.start,
            ),
          ],
          at: february.start,
        }),
      ).resolves.toMatchObject({ status: 'active', currentVersion: 2 })
      await expect(
        repository.getHistory(organizationId, targetPropertyId, bundle.program.id),
      ).resolves.toMatchObject({
        program: { status: 'active' },
        version: { id: second.version.id, targetValue: 40 },
        results: [
          {
            programVersionId: second.version.id,
            periodStart: february.start,
            status: 'open',
          },
        ],
      })
    })

    it('a stale activation after a supersede changes nothing', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Stale Activation Property',
      )
      // Maintenance read the goal, then the manager replaced its plan.
      await repository.revise({
        expectedVersion: bundle.version,
        ...following(bundle.version, february.start, 40),
        supersedeRowlessHead: true,
        actorId: 'manager-1',
        at: editedAt,
      })

      await expect(
        repository.activate({
          bundle,
          results: [
            openMonth(
              bundle.assignments[0]!,
              february.start,
              february.end,
              february.start,
            ),
          ],
          at: february.start,
        }),
      ).resolves.toBeNull()
      await expect(
        repository.getHistory(organizationId, targetPropertyId, bundle.program.id),
      ).resolves.toMatchObject({
        program: { status: 'scheduled', currentVersion: 2 },
        results: [],
      })
    })

    // What a scheduled goal waits for is decided from its plan, so a
    // replacement states it again in the same update that moves the head.
    it('a replacement of a scheduled goal states what it now waits for', async () => {
      const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
        'Restated Reason Property',
      )
      expect(bundle.program.statusReason).toBe('awaiting_first_full_month')
      const second = following(bundle.version, february.start, 40)
      await expect(
        repository.revise({
          expectedVersion: bundle.version,
          ...second,
          supersedeRowlessHead: true,
          scheduledStatusReason: 'metric_source_not_active',
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)
      await expect(
        repository.getHistory(organizationId, targetPropertyId, bundle.program.id),
      ).resolves.toMatchObject({
        program: {
          status: 'scheduled',
          statusReason: 'metric_source_not_active',
          currentVersion: 2,
        },
      })

      // A change that says nothing about the reason leaves it as it is.
      const third = following(second.version, february.start, 55)
      await repository.revise({
        expectedVersion: second.version,
        ...third,
        supersedeRowlessHead: true,
        actorId: 'manager-1',
        at: editedAt,
      })
      await expect(
        repository.getHistory(organizationId, targetPropertyId, bundle.program.id),
      ).resolves.toMatchObject({
        program: { statusReason: 'metric_source_not_active', currentVersion: 3 },
      })

      await repository.revise({
        expectedVersion: third.version,
        ...following(third.version, february.start, 70),
        supersedeRowlessHead: true,
        scheduledStatusReason: 'awaiting_first_full_month',
        actorId: 'manager-1',
        at: editedAt,
      })
      await expect(
        repository.getHistory(organizationId, targetPropertyId, bundle.program.id),
      ).resolves.toMatchObject({
        program: { statusReason: 'awaiting_first_full_month', currentVersion: 4 },
      })
    })

    // The reason of a goal that has started belongs to its status: nothing
    // when it is active, the manager's note when it was paused. A caller that
    // read the goal while it was still scheduled must not overwrite either.
    it('a revision leaves the status reason of a goal that is not scheduled alone', async () => {
      const repository = suite.repository()
      const targetPropertyId = await suite.createProperty('Kept Reason Property')
      const running = suite.bundle({
        propertyId: targetPropertyId,
        status: 'active',
        effectiveFrom: january.start,
        at: january.start,
        withOpenResult: { end: january.end },
      })
      await repository.create({ bundle: running, auditAction: 'goal.program.created' })
      const pending = following(running.version, february.start, 40)
      await expect(
        repository.revise({
          expectedVersion: running.version,
          ...pending,
          supersedeRowlessHead: false,
          scheduledStatusReason: 'awaiting_first_full_month',
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)
      await expect(
        repository.getHistory(organizationId, targetPropertyId, running.program.id),
      ).resolves.toMatchObject({
        program: { status: 'active', statusReason: null, currentVersion: 2 },
      })

      await repository.changeStatus({
        organizationId,
        propertyId: targetPropertyId,
        programId: running.program.id,
        expectedStatus: 'active',
        status: 'paused',
        reason: 'Closed for works',
        actorId: 'manager-1',
        at: editedAt,
      })
      await expect(
        repository.revise({
          expectedVersion: pending.version,
          ...following(pending.version, february.start, 55),
          supersedeRowlessHead: true,
          scheduledStatusReason: 'metric_source_not_active',
          actorId: 'manager-1',
          at: editedAt,
        }),
      ).resolves.toBe(true)
      await expect(
        repository.getHistory(organizationId, targetPropertyId, running.program.id),
      ).resolves.toMatchObject({
        program: {
          status: 'paused',
          statusReason: 'Closed for works',
          currentVersion: 3,
        },
      })
    })
  },
)
