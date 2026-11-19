import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { findMetricVersionById } from '../../readings/contracts'
import {
  createGoalProgramService,
  type GoalActor,
  type GoalMetricReadPort,
} from '../../monthly-goals/goal-programs.server'
import { createGoalProgramRepository } from './goal-program.repository'
import { readGoalMetricSourceHead } from './goal-metric-source-head'

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
          sourceHead: await readGoalMetricSourceHead(getDb(), query, [
            'guest.rating.submitted',
            'guest.rating.retracted',
          ]),
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
        },
        metrics,
        id: randomUUID,
        now: () => clock.now,
      })
      return { service, clock }
    }

    it('waits for a concurrent materializer and keeps exactly one result for its month', async () => {
      const propertyId = await createProperty()
      const actor: GoalActor = {
        organizationId,
        userId: 'manager-1',
        role: 'PropertyManager',
      }
      const { service, clock } = serviceFor(
        propertyId,
        new Date('2026-03-01T00:00:00Z'),
        'UTC',
      )
      const created = await service.create(
        {
          propertyId,
          name: 'Monthly ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [{ kind: 'property', propertyId }],
        },
        actor,
      )
      clock.now = new Date('2026-04-01T00:10:00Z')
      const materializer = await lease.pool.connect()
      let committed = false
      let stopping: ReturnType<typeof service.changeStatus> | undefined
      try {
        await materializer.query('BEGIN')
        await materializer.query(
          'SELECT id FROM goal_programs WHERE id = $1 FOR UPDATE',
          [created.program.id],
        )
        const backend = await materializer.query<{ pid: number }>(
          'SELECT pg_backend_pid() AS pid',
        )
        stopping = service.changeStatus(
          { propertyId, programId: created.program.id, status: 'ended' },
          actor,
        )
        void stopping.catch(() => undefined)
        await vi.waitFor(
          async () => {
            const waiting = await lease.pool.query<{ blocked: boolean }>(
              'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked',
              [backend.rows[0]!.pid],
            )
            expect(waiting.rows[0]!.blocked).toBe(true)
          },
          { timeout: 5_000 },
        )
        await materializer.query(
          `
          INSERT INTO goal_monthly_results (
            id, assignment_id, program_id, program_version_id, organization_id,
            property_id, period_start, period_end, property_timezone
          ) SELECT $1, assignment_id, program_id, program_version_id, organization_id,
            property_id, period_end, $2, property_timezone
          FROM goal_monthly_results WHERE id = $3
        `,
          [randomUUID(), new Date('2026-05-01T00:00:00Z'), created.results[0]!.id],
        )
        await materializer.query('COMMIT')
        committed = true
        await expect(stopping).resolves.toMatchObject({ status: 'ended' })
      } finally {
        if (!committed) await materializer.query('ROLLBACK')
        await stopping?.catch(() => undefined)
        materializer.release()
      }
      const stopped = await service.get(
        { propertyId, programId: created.program.id },
        actor,
      )
      expect(stopped.results.map((result) => result.periodStart)).toEqual([
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z'),
      ])
      expect(stopped.version.effectiveTo).toEqual(new Date('2026-05-01T00:00:00Z'))
    })

    it.each([
      {
        timezone: 'UTC',
        start: '2026-03-01T00:00:00Z',
        stop: '2026-04-01T00:10:00Z',
        end: '2026-05-01T00:00:00Z',
      },
      {
        timezone: 'Europe/Sofia',
        start: '2026-02-28T22:00:00Z',
        stop: '2026-03-31T21:10:00Z',
        end: '2026-04-30T21:00:00Z',
      },
    ])(
      'Stop at 00:10 in $timezone preserves the due month and lets it close',
      async (time) => {
        const propertyId = await createProperty()
        const actor: GoalActor = {
          organizationId,
          userId: 'manager-1',
          role: 'PropertyManager',
        }
        const { service, clock } = serviceFor(
          propertyId,
          new Date(time.start),
          time.timezone,
        )
        const created = await service.create(
          {
            propertyId,
            name: 'Monthly ratings',
            metric: 'portal_rating_count',
            targetValue: 25,
            subjects: [{ kind: 'property', propertyId }],
          },
          actor,
        )
        clock.now = new Date(time.stop)
        await service.changeStatus(
          { propertyId, programId: created.program.id, status: 'ended' },
          actor,
        )
        const stopped = await service.get(
          { propertyId, programId: created.program.id },
          actor,
        )
        expect(stopped.results).toHaveLength(2)
        expect(stopped.results[1]).toMatchObject({
          periodStart: created.results[0]!.periodEnd,
          periodEnd: new Date(time.end),
        })
        expect(stopped.version.effectiveTo).toEqual(new Date(time.end))
        expect(stopped.assignments[0]!.effectiveTo).toEqual(new Date(time.end))
        clock.now = new Date('2026-05-03T00:00:00Z')
        await service.maintain()
        await service.maintain()
        const closed = await service.get(
          { propertyId, programId: created.program.id },
          actor,
        )
        expect(closed.results.map((result) => result.status)).toEqual([
          'closed',
          'closed',
        ])
        expect(closed.results).toHaveLength(2)
      },
    )

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
