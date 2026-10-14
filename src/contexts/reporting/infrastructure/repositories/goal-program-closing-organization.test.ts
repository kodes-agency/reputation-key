// Goal maintenance leaves a closing Organization alone, against PostgreSQL.
//
// The Closing phase pauses the Organization's ACTIVE goals, but the database
// has no scheduled -> paused edge, and a closure request suspends nothing. A
// goal that was still scheduled when the request came (any goal set mid-month
// is, until the 1st) was therefore activated by the hourly job inside the
// recovery window, and Goal's purge-readiness check then refused the
// Organization for good: it throws on an active program.
//
// The same hold refuses a person: nothing may put a goal into `active` in such
// an Organization, or the purge-readiness check meets it again. The Closing
// phase has run once by then, so a manager could resume a goal it paused, or
// set a goal for the current month, and the Organization would stay in
// `closing` on every pass.
//
// Nothing is committed: monthly results cannot be deleted, so the fixture and
// every statement run in one held transaction that is rolled back.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import type { Tx } from '#/shared/outbox/commit'
import {
  findMetricVersionById,
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '../../domain/metric-registry'
import type { GoalProgramBundle } from '../../application/ports/goal-program.repository'
import type { GoalProgramDependencies } from '../../application/use-cases/goal-program-shared'
import { maintain } from '../../application/use-cases/goal-program-maintenance'
import { createGoalProgramService } from '../../application/use-cases/goal-programs'
import { GOAL_ORGANIZATION_LIFECYCLE_PHASES } from '../adapters/goal-organization-lifecycle.adapter'
import { createGoalProgramRepository } from './goal-program.repository'

const NOW = new Date('2026-10-14T09:00:00.000Z')
const SCHEDULED_FOR = new Date('2026-10-01T00:00:00.000Z')
const CREATED_AT = new Date('2026-09-25T09:00:00.000Z')
const REQUESTED_AT = new Date('2026-09-28T09:00:00.000Z')
const RECOVERABLE_UNTIL = new Date('2026-10-28T09:00:00.000Z')

type LifecycleState = 'active' | 'closure_requested' | 'closing' | 'cancelled'

describe.sequential('Goal maintenance in a closing Organization (integration)', () => {
  let held: HeldTransaction | undefined
  let client: HeldTransaction['client']
  let db: Database

  /** The Organization's lifecycle, walked along the edges the database allows. */
  async function setLifecycle(organizationId: string, to: LifecycleState): Promise<void> {
    if (to === 'active') return
    const reason = (code: string, state: string) =>
      client.query(
        `UPDATE organization_lifecycle_authority
         SET state = $2, revision = revision + 1, last_transition_at = $3,
             last_actor_id = 'admin:goal-closing-test', last_reason_code = $4,
             last_support_evidence_ref = 'test:goal-closing'
         WHERE organization_id = $1`,
        [organizationId, state, REQUESTED_AT, code],
      )
    await client.query(
      `UPDATE organization_lifecycle_authority
       SET state = 'closure_requested', revision = revision + 1,
           closure_lineage_id = $2, closure_requested_at = $3,
           recoverable_until = $4, reactivation_required = true,
           requested_by = 'admin:goal-closing-test',
           request_reason_code = 'test_workspace',
           request_support_evidence_ref = 'test:closure-request',
           last_transition_at = $3, last_actor_id = 'admin:goal-closing-test',
           last_reason_code = 'test_workspace',
           last_support_evidence_ref = 'test:closure-request'
       WHERE organization_id = $1`,
      [organizationId, randomUUID(), REQUESTED_AT, RECOVERABLE_UNTIL],
    )
    if (to === 'closing') await reason('closing_prepared', 'closing')
    // A cancelled closure returns to active and still awaits reactivation.
    if (to === 'cancelled') await reason('closure_cancelled', 'active')
  }

  /** A goal set on 25 September for October: scheduled, with no month yet. */
  async function scheduledGoal(state: LifecycleState): Promise<GoalProgramBundle> {
    const organizationId = `goal-closing-${randomUUID()}`
    const propertyId = randomUUID()
    const programId = randomUUID()
    await client.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Goal Closing Fixture', $1, $2)`,
      [organizationId, CREATED_AT],
    )
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Goal Closing Property', $3, 'UTC')`,
      [propertyId, organizationId, `goal-closing-${randomUUID()}`],
    )
    const version = {
      id: randomUUID(),
      programId,
      organizationId,
      propertyId,
      version: 1,
      metricDefinitionId: METRIC_DEFINITION_IDS.portalRatingCount,
      metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metric: 'portal_rating_count' as const,
      metricMinimumSample: 0,
      targetValue: 10,
      propertyTimezone: 'UTC',
      effectiveFrom: SCHEDULED_FOR,
      effectiveTo: null,
      changeReason: 'created',
      createdBy: 'manager-1',
      createdAt: CREATED_AT,
    }
    const bundle: GoalProgramBundle = {
      program: {
        id: programId,
        organizationId,
        propertyId,
        name: 'Ratings in October',
        description: null,
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
        currentVersion: 1,
        createdBy: 'manager-1',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      version,
      versions: [version],
      assignments: [
        {
          id: randomUUID(),
          programId,
          programVersionId: version.id,
          organizationId,
          propertyId,
          metric: 'portal_rating_count',
          subject: { kind: 'property', propertyId },
          effectiveFrom: SCHEDULED_FOR,
          effectiveTo: null,
          createdBy: 'manager-1',
          createdAt: CREATED_AT,
        },
      ],
      results: [],
    }
    await expect(
      createGoalProgramRepository(db).create({
        bundle,
        auditAction: 'goal.program.created',
      }),
    ).resolves.toBe('created')
    await setLifecycle(organizationId, state)
    return bundle
  }

  /**
   * Maintenance discovery is tenant-cross and this database is shared by every
   * integration suite, so it is narrowed to this goal's Organization; every
   * read and write still goes through PostgreSQL.
   */
  const dependencies = (goal: GoalProgramBundle): GoalProgramDependencies => {
    const repository = createGoalProgramRepository(db)
    const { organizationId } = goal.program
    return {
      repository: {
        ...repository,
        listOperational: async () =>
          (await repository.listOperational()).filter(
            (bundle) => bundle.program.organizationId === organizationId,
          ),
        listDueResults: async (at) =>
          (await repository.listDueResults(at)).filter(
            (result) => result.organizationId === organizationId,
          ),
      },
      policy: { authorize: async () => undefined },
      subjects: {
        getTimezone: async () => 'UTC',
        subjectBelongsToProperty: async () => true,
        listCurrentPortalIds: async () => [],
      },
      metrics: {
        queryGoalMetric: async (query) => ({
          definitionVersionId: query.definitionVersionId,
          metricKey: 'portal.rating_count',
          state: 'eligible',
          exactValue: 0,
          sampleCount: 0,
          minimumSample: 0,
          sourceCompleteThrough: null,
          reason: null,
        }),
        getApprovedGoalVersion: async (versionId) => findMetricVersionById(versionId),
      },
      id: randomUUID,
      now: () => NOW,
    }
  }

  async function statusOf(goal: GoalProgramBundle): Promise<string | undefined> {
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM goal_programs WHERE organization_id = $1 AND id = $2`,
      [goal.program.organizationId, goal.program.id],
    )
    return rows[0]?.status
  }

  /** Goal's purge-readiness phase for the Organization, as the lifecycle coordinator runs it. */
  function verifyPurgeReadiness(goal: GoalProgramBundle) {
    return GOAL_ORGANIZATION_LIFECYCLE_PHASES.verifyPurgeReadiness(db as unknown as Tx, {
      organizationId: goal.program.organizationId,
      closureLineageId: randomUUID(),
      lifecycleRevision: 3,
      recoverableUntil: RECOVERABLE_UNTIL,
      occurredAt: NOW,
    })
  }

  beforeAll(async () => {
    held = await holdTransaction()
    client = held.client
    db = held.db
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  it('activates a scheduled goal whose start has come, in an Organization that is not closing', async () => {
    const goal = await scheduledGoal('active')

    const stats = await maintain(dependencies(goal))

    expect(stats.activated).toBe(1)
    await expect(statusOf(goal)).resolves.toBe('active')
  })

  it.each(['closure_requested', 'closing', 'cancelled'] as const)(
    'leaves a scheduled goal scheduled while the Organization is %s',
    async (state) => {
      const goal = await scheduledGoal(state)

      const stats = await maintain(dependencies(goal))

      expect(stats.activated).toBe(0)
      await expect(statusOf(goal)).resolves.toBe('scheduled')
      const { rows } = await client.query(
        `SELECT 1 FROM goal_monthly_results WHERE organization_id = $1`,
        [goal.program.organizationId],
      )
      expect(rows).toEqual([])
    },
  )

  it('refuses to activate a program the Organization was closed under after maintenance listed it', async () => {
    const goal = await scheduledGoal('active')
    const repository = createGoalProgramRepository(db)
    const listed = (await repository.listOperational()).find(
      (bundle) => bundle.program.id === goal.program.id,
    )
    if (!listed) throw new Error('the scheduled goal was not listed')

    await setLifecycle(goal.program.organizationId, 'closure_requested')

    await expect(
      repository.activate({ bundle: listed, results: [], at: NOW }),
    ).resolves.toBe(null)
    await expect(statusOf(goal)).resolves.toBe('scheduled')
  })

  it('leaves the Organization ready to purge once its goals are fenced or never started', async () => {
    const goal = await scheduledGoal('closing')

    await maintain(dependencies(goal))

    await expect(verifyPurgeReadiness(goal)).resolves.toMatchObject({
      outcome: 'complete',
    })
  })

  it.each([
    ['active', false],
    ['closure_requested', true],
    ['closing', true],
    ['cancelled', true],
  ] as const)('reads an Organization that is %s as held: %s', async (state, isHeld) => {
    const goal = await scheduledGoal(state)

    await expect(
      createGoalProgramRepository(db).isOrganizationHeld(goal.program.organizationId),
    ).resolves.toBe(isHeld)
  })

  it('reads an Organization with no lifecycle row as not held', async () => {
    await expect(
      createGoalProgramRepository(db).isOrganizationHeld(`goal-closing-${randomUUID()}`),
    ).resolves.toBe(false)
  })

  describe('a manager in an Organization whose Closing phase has run', () => {
    const actor = {
      organizationId: '',
      userId: 'manager-1',
      role: 'AccountAdmin',
    } as const

    /** A goal that was active, then paused by the Closing phase of a closing Organization. */
    async function fencedGoal() {
      const goal = await scheduledGoal('active')
      const deps = dependencies(goal)
      await expect(maintain(deps)).resolves.toMatchObject({ activated: 1 })
      await setLifecycle(goal.program.organizationId, 'closing')
      await GOAL_ORGANIZATION_LIFECYCLE_PHASES.prepareClosing(db as unknown as Tx, {
        organizationId: goal.program.organizationId,
        closureLineageId: randomUUID(),
        lifecycleRevision: 2,
        recoverableUntil: RECOVERABLE_UNTIL,
        occurredAt: NOW,
      })
      await expect(statusOf(goal)).resolves.toBe('paused')
      return {
        goal,
        service: createGoalProgramService(deps),
        actor: { ...actor, organizationId: goal.program.organizationId },
      }
    }

    it('cannot resume the goal the phase paused, so the purge is not blocked again', async () => {
      const { goal, service, actor: manager } = await fencedGoal()

      await expect(
        service.changeStatus(
          {
            propertyId: goal.program.propertyId,
            programId: goal.program.id,
            status: 'active',
          },
          manager,
        ),
      ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'organization_closing' })

      await expect(statusOf(goal)).resolves.toBe('paused')
      await expect(verifyPurgeReadiness(goal)).resolves.toMatchObject({
        outcome: 'complete',
      })
    })

    it('cannot set a goal for the current month', async () => {
      const { goal, service, actor: manager } = await fencedGoal()
      const before = await client.query(
        `SELECT count(*)::int AS programs FROM goal_programs WHERE organization_id = $1`,
        [goal.program.organizationId],
      )

      await expect(
        service.create(
          {
            propertyId: goal.program.propertyId,
            name: 'Rating average this month',
            // Another measure than the paused goal's, so only the lifecycle
            // can stand in the way.
            metric: 'portal_rating_average',
            targetValue: 4.5,
            subjects: [{ kind: 'property', propertyId: goal.program.propertyId }],
            startMonth: '2026-10',
          },
          manager,
        ),
      ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'organization_closing' })

      const after = await client.query(
        `SELECT count(*)::int AS programs FROM goal_programs WHERE organization_id = $1`,
        [goal.program.organizationId],
      )
      expect(after.rows).toEqual(before.rows)
    })

    it('can still end the paused goal', async () => {
      const { goal, service, actor: manager } = await fencedGoal()

      await expect(
        service.changeStatus(
          {
            propertyId: goal.program.propertyId,
            programId: goal.program.id,
            status: 'ended',
          },
          manager,
        ),
      ).resolves.toMatchObject({ status: 'ended' })
    })
  })
})
