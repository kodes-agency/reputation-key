import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { findMetricVersionById } from '../../domain/metric-registry'
import {
  createGoalProgramService,
  type GoalActor,
  type GoalMetricReadPort,
} from '../../application/use-cases/goal-programs'
import { createGoalProgramRepository } from './goal-program.repository'

/**
 * A revision after the Property's timezone changed must leave the open month
 * inside its own version's window, or the monthly-result guard rejects every
 * later update to it and Goal maintenance fails each hour. The months are in
 * the past so the guard's wall-clock checks admit reconciliation and closure.
 */
describe.sequential(
  'Goal Program revision across a timezone change (integration)',
  () => {
    let lease: TestLease
    let organizationId: string

    beforeAll(async () => {
      registerAllEventSchemas()
      lease = await acquireTestLease(getEnv().DATABASE_URL)
      organizationId = `goal-timezone-revision-${randomUUID()}`
    })

    afterAll(async () => {
      await lease?.release()
    })

    async function createProperty(): Promise<string> {
      const propertyId = randomUUID()
      await lease.pool.query(
        `INSERT INTO properties
         (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Goal Timezone Property', $3, 'UTC')`,
        [propertyId, organizationId, `goal-timezone-${randomUUID()}`],
      )
      return propertyId
    }

    function serviceFor(propertyId: string, start: Date, timezone: string) {
      const clock = { now: start, timezone }
      const metrics: GoalMetricReadPort = {
        queryGoalMetric: async (query) => ({
          definitionVersionId: query.definitionVersionId,
          metricKey: 'portal.rating_count',
          state: 'eligible',
          exactValue: 30,
          sampleCount: 30,
          minimumSample: 0,
          sourceCompleteThrough: query.periodEnd,
          reason: null,
        }),
        getApprovedGoalVersion: async (versionId) => findMetricVersionById(versionId),
      }
      const repository = createGoalProgramRepository(getDb())
      const service = createGoalProgramService({
        // Maintenance discovery is tenant-cross and this database is shared by
        // every integration suite. Discovery is narrowed to this case's
        // Property; every read and write still goes through PostgreSQL.
        repository: {
          ...repository,
          listOperational: async () =>
            (await repository.listOperational()).filter(
              (bundle) => bundle.program.propertyId === propertyId,
            ),
          listDueResults: async (at) =>
            (await repository.listDueResults(at)).filter(
              (result) => result.propertyId === propertyId,
            ),
        },
        policy: { authorize: async () => undefined },
        subjects: {
          getTimezone: async () => clock.timezone,
          subjectBelongsToProperty: async () => true,
          listCurrentPortalIds: async () => [],
        },
        metrics,
        id: randomUUID,
        now: () => clock.now,
      })
      return { service, clock }
    }

    it.each([
      {
        move: 'UTC to Europe/Sofia',
        from: 'UTC',
        to: 'Europe/Sofia',
        createdAt: '2026-03-01T00:00:00.000Z',
        openMonthEnd: '2026-04-01T00:00:00.000Z',
      },
      {
        move: 'Europe/Sofia to UTC',
        from: 'Europe/Sofia',
        to: 'UTC',
        createdAt: '2026-02-28T22:00:00.000Z',
        openMonthEnd: '2026-03-31T21:00:00.000Z',
      },
      {
        move: 'UTC to UTC',
        from: 'UTC',
        to: 'UTC',
        createdAt: '2026-03-01T00:00:00.000Z',
        openMonthEnd: '2026-04-01T00:00:00.000Z',
      },
    ])('closes the open month after a $move revision', async (move) => {
      const propertyId = await createProperty()
      const actor: GoalActor = {
        organizationId,
        userId: 'manager-1',
        role: 'PropertyManager',
      }
      const { service, clock } = serviceFor(
        propertyId,
        new Date(move.createdAt),
        move.from,
      )
      const created = await service.create(
        {
          propertyId,
          name: `Ratings ${move.move}`,
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [{ kind: 'property', propertyId }],
        },
        actor,
      )
      const openMonth = created.results[0]!
      expect(openMonth.periodEnd).toEqual(new Date(move.openMonthEnd))

      clock.now = new Date('2026-03-20T12:00:00.000Z')
      clock.timezone = move.to
      await service.revise(
        {
          propertyId,
          programId: created.program.id,
          metric: 'portal_rating_count',
          targetValue: 40,
          subjects: [{ kind: 'property', propertyId }],
          reason: `Property timezone moved (${move.move})`,
        },
        actor,
      )

      clock.now = new Date('2026-04-03T00:00:00.000Z')
      await expect(service.maintain()).resolves.toMatchObject({ failed: 0 })
      await expect(service.maintain()).resolves.toMatchObject({ failed: 0 })

      const settled = await service.get(
        { propertyId, programId: created.program.id },
        actor,
      )
      expect(settled.results.find((result) => result.id === openMonth.id)).toMatchObject({
        status: 'closed',
        evaluation: { state: 'eligible', achieved: true },
      })
    })
  },
)
