import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { seedGoalMonth } from '../testing/goal-running-month-seed'
import { createGoalProgramRepository } from './goal-program.repository'
import { monthlyPortalGoalOf } from '../../application/monthly-portal-goal-identity'
import { monthlyPortalGoalOnCard } from '../../monthly-goals/monthly-portal-goal-running.server'
import { gatherPortalGoalRecommendation } from '../../application/use-cases/goal-recommendation-read'
import { fakeWorld } from '../../monthly-goals/monthly-portal-goal.test-fixtures'
import { anyPortalGoalMonthClosed } from '#/contexts/reporting/monthly-goals/ui/portal-goal-results-foot'

describe.sequential(
  'Stopped Goal summaries with older unsettled months (integration)',
  () => {
    let held: HeldTransaction | undefined
    beforeAll(async () => {
      held = await holdTransaction()
    })
    afterAll(async () => {
      await held?.rollBack()
    })
    beforeEach(async () => {
      await held?.client.query('SAVEPOINT unsettled_summary_case')
    })
    afterEach(async () => {
      await held?.client.query('ROLLBACK TO SAVEPOINT unsettled_summary_case')
    })

    it.each(['open', 'reconciling'] as const)(
      'keeps the August %s month when September and October have closed',
      async (status) => {
        if (!held) throw new Error('Unsettled Goal fixture is unavailable')
        const { client, db } = held
        const org = `goal-unsettled-${randomUUID()}`
        const property = randomUUID()
        await client.query(
          `INSERT INTO organization (id, name, slug, "createdAt")
         VALUES ($1, 'Unsettled Goal', $1, now())`,
          [org],
        )
        await client.query(
          `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1::uuid, $2, 'Unsettled Goal', $1::text, 'UTC')`,
          [property, org],
        )
        const seeded = await seedGoalMonth(client, {
          organizationId: org,
          propertyId: property,
          target: 120,
          monthStatus: status,
        })
        await client.query(
          `INSERT INTO goal_monthly_results
           (id, assignment_id, program_id, program_version_id, organization_id, property_id,
            period_start, period_end, property_timezone, status, evaluation_state,
            sample_count, created_at, updated_at)
         SELECT gen_random_uuid(), $1, $2, $3, $4, $5, month AT TIME ZONE 'UTC', (month + interval '1 month') AT TIME ZONE 'UTC',
           'UTC', 'open', 'updating', 0, month, month
         FROM generate_series(timestamp '2026-09-01 00:00:00',
           timestamp '2026-10-01 00:00:00', interval '1 month') AS month`,
          [seeded.assignmentId, seeded.programId, seeded.versionId, org, property],
        )
        const repository = createGoalProgramRepository(db)
        expect(
          await repository.changeStatus({
            organizationId: org,
            propertyId: property,
            programId: seeded.programId,
            expectedStatus: 'active',
            status: 'ended',
            reason: null,
            actorId: 'manager-1',
            at: new Date('2026-10-15T12:00:00Z'),
          }),
        ).toMatchObject({ status: 'ended' })
        await client.query(
          `UPDATE goal_monthly_results SET status = 'reconciling', updated_at = period_end
         WHERE program_id = $1 AND period_start >= '2026-09-01T00:00:00Z'`,
          [seeded.programId],
        )
        await client.query(
          `UPDATE goal_monthly_results SET status = 'closed', evaluation_state = 'eligible',
           value = 130, sample_count = 130, achieved = true, reason = NULL,
           source_complete_through = period_end, evaluation_watermark = period_end,
           closed_at = period_end, updated_at = period_end
         WHERE program_id = $1 AND period_start >= '2026-09-01T00:00:00Z'`,
          [seeded.programId],
        )
        const now = new Date('2026-11-15T12:00:00Z')
        const full = await repository.getHistory(org, property, seeded.programId)
        const summary = await repository.get(org, property, seeded.programId)
        if (!full || !summary) throw new Error('Stopped Goal is unavailable')
        const fullGoal = monthlyPortalGoalOf([full], now)
        expect(fullGoal?.program.id).toBe(seeded.programId)
        expect(monthlyPortalGoalOf([summary], now)?.program.id).toBe(fullGoal?.program.id)
        expect(
          monthlyPortalGoalOf(await repository.list(org, property), now)?.program.id,
        ).toBe(fullGoal?.program.id)
        expect(
          summary.results.find((result) => result.id === seeded.resultId),
        ).toMatchObject({
          status,
          periodStart: new Date('2026-08-01T00:00:00Z'),
        })
        const { deps } = fakeWorld({ now, timezone: 'UTC' })
        const recommendation = await gatherPortalGoalRecommendation(deps.recommendation, {
          organizationId: org,
          propertyId: property,
          now,
        })
        const selected = monthlyPortalGoalOf([summary], now)
        if (!selected) throw new Error('Stopped Goal was omitted from summary')
        const card = await monthlyPortalGoalOnCard({ metrics: deps.metrics }, selected, {
          recommendation,
          now,
          actor: { organizationId: org, userId: 'manager-1', role: 'PropertyManager' },
        })
        expect(card.countingMonth).toEqual({
          key: '2026-08',
          measure: 'qualified_scans',
          target: 120,
        })
      },
    )

    it('keeps the monthly-results link when an older closed month precedes two open months', async () => {
      if (!held) throw new Error('Closed Goal fixture is unavailable')
      const { client, db } = held
      const org = `goal-closed-summary-${randomUUID()}`
      const property = randomUUID()
      await client.query(
        `INSERT INTO organization (id, name, slug, "createdAt")
         VALUES ($1, 'Closed Goal', $1, now())`,
        [org],
      )
      await client.query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1::uuid, $2, 'Closed Goal', $1::text, 'UTC')`,
        [property, org],
      )
      const seeded = await seedGoalMonth(client, {
        organizationId: org,
        propertyId: property,
        target: 120,
      })
      await client.query(
        `INSERT INTO goal_monthly_results
           (id, assignment_id, program_id, program_version_id, organization_id, property_id,
            period_start, period_end, property_timezone, status, evaluation_state,
            sample_count, created_at, updated_at)
         SELECT gen_random_uuid(), $1, $2, $3, $4, $5,
           month AT TIME ZONE 'UTC', (month + interval '1 month') AT TIME ZONE 'UTC',
           'UTC', 'open', 'updating', 0, month, month
         FROM generate_series(timestamp '2026-09-01 00:00:00',
           timestamp '2026-10-01 00:00:00', interval '1 month') AS month`,
        [seeded.assignmentId, seeded.programId, seeded.versionId, org, property],
      )
      await client.query(
        `UPDATE goal_monthly_results SET status = 'reconciling', updated_at = period_end
         WHERE id = $1`,
        [seeded.resultId],
      )
      await client.query(
        `UPDATE goal_monthly_results SET status = 'closed', evaluation_state = 'eligible',
           value = 130, sample_count = 130, achieved = true, reason = NULL,
           source_complete_through = period_end, evaluation_watermark = period_end,
           closed_at = period_end, updated_at = period_end WHERE id = $1`,
        [seeded.resultId],
      )
      const repository = createGoalProgramRepository(db)
      const full = await repository.getHistory(org, property, seeded.programId)
      const summary = await repository.get(org, property, seeded.programId)
      if (!full || !summary) throw new Error('Goal summary is unavailable')
      expect(anyPortalGoalMonthClosed([full])).toBe(true)
      expect(anyPortalGoalMonthClosed([summary])).toBe(true)
      expect(anyPortalGoalMonthClosed(await repository.list(org, property))).toBe(true)
      expect(
        summary.results.find((result) => result.id === seeded.resultId),
      ).toMatchObject({ status: 'closed' })
    })
  },
)
