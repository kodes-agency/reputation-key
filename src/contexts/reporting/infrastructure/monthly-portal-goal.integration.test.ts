// A barrier lets both commands pass their pre-check before either writes.
// The Property definition lock must still allow only one non-ended count goal.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { findMetricVersionById } from '../domain/metric-registry'
import type { PortalGoalMeasure } from '../domain/goal-recommendation-types'
import { monthlyPortalGoalOf } from '../application/monthly-portal-goal-identity'
import type { GoalProgramRepository } from '../application/ports/goal-program.repository'
import {
  createGoalProgramService,
  type GoalActor,
} from '../application/use-cases/goal-programs'
import { setMonthlyPortalGoal } from '../application/use-cases/monthly-portal-goal'
import { createGoalProgramRepository } from './repositories/goal-program.repository'

const NOW = new Date('2026-10-23T09:00:00.000Z')
const RACE_TIMEOUT_MS = 60_000

/** Resolves once `parties` callers are waiting, so each passes the pre-check first. */
function barrier(parties: number): () => Promise<void> {
  let waiting = 0
  let open: () => void = () => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return async () => {
    waiting += 1
    if (waiting === parties) open()
    await opened
  }
}

describe.sequential('Monthly portal goal set (integration)', () => {
  let lease: TestLease
  const organizationId = `monthly-portal-goal-${randomUUID()}`
  const actor: GoalActor = { organizationId, userId: 'elena', role: 'PropertyManager' }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  afterAll(async () => {
    await lease?.release()
  })

  async function propertyFixture(): Promise<string> {
    const id = randomUUID()
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Seaview Hotel', $3, 'UTC')`,
      [id, organizationId, `monthly-portal-goal-${randomUUID()}`],
    )
    return id
  }

  function programsWith(repository: GoalProgramRepository) {
    return createGoalProgramService({
      repository,
      policy: { authorize: async () => undefined },
      subjects: {
        getTimezone: async () => 'UTC',
        subjectBelongsToProperty: async () => true,
      },
      metrics: {
        queryGoalMetric: async (query) => ({
          definitionVersionId: query.definitionVersionId,
          metricKey: null,
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
    })
  }

  /** Every set reads the Property's Programs before any of them writes. */
  function commandWith(repository: GoalProgramRepository, parties: number) {
    const listed = barrier(parties)
    const programs = programsWith(repository)
    return (propertyId: string, metric: PortalGoalMeasure) =>
      setMonthlyPortalGoal(
        {
          policy: { authorize: async () => undefined },
          repository: {
            list: async (...args) => {
              const found = await repository.list(...args)
              await listed()
              return found
            },
          },
          programs,
          recommendation: {
            subjects: { getTimezone: async () => 'UTC' },
            facts: {
              listPortalReadiness: async () => ({ portals: [], truncated: false }),
              readDailyCounts: async () => ({
                days: [],
                unreadable: [],
                lastScanAt: new Map(),
                groupDays: [],
                groupUnreadable: [],
              }),
            },
          },
          now: () => NOW,
        },
        {
          propertyId,
          metric,
          targetValue: 40,
          startMonth: '2026-11',
          targetSource: 'own',
        },
        actor,
      )
  }

  it(
    'two sets racing on the same measure: one wins, the other is refused',
    async () => {
      const repository = createGoalProgramRepository(getDb())
      const propertyId = await propertyFixture()
      const set = commandWith(repository, 2)

      const outcomes = await Promise.allSettled([
        set(propertyId, 'portal_rating_count'),
        set(propertyId, 'portal_rating_count'),
      ])

      expect(outcomes.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ])
      const refused = outcomes.find((outcome) => outcome.status === 'rejected')
      expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
        code: 'subject_has_goal',
      })
      const stored = await repository.list(organizationId, propertyId)
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatchObject({
        program: { name: 'Monthly portal goal', status: 'scheduled' },
        version: { metric: 'portal_rating_count', targetValue: 40, targetSource: 'own' },
      })
      // From then on the pre-check refuses, on either measure.
      await expect(
        commandWith(repository, 1)(propertyId, 'qualified_scans'),
      ).rejects.toMatchObject({ code: 'subject_has_goal' })
    },
    RACE_TIMEOUT_MS,
  )

  it('the generic create cannot set another count goal with a different start month', async () => {
    const repository = createGoalProgramRepository(getDb())
    const propertyId = await propertyFixture()
    const programs = programsWith(repository)
    await commandWith(repository, 1)(propertyId, 'portal_rating_count')
    await expect(
      programs.create(
        {
          propertyId,
          name: 'Scans',
          metric: 'qualified_scans',
          targetValue: 40,
          startMonth: '2026-10',
          subjects: [{ kind: 'property', propertyId }],
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'subject_has_goal' })
    expect(await repository.list(organizationId, propertyId)).toHaveLength(1)
  })

  it(
    'serializes a generic create against a revision into the count identity',
    async () => {
      const repository = createGoalProgramRepository(getDb())
      const propertyId = await propertyFixture()
      const average = await programsWith(repository).create(
        {
          propertyId,
          name: 'Average',
          metric: 'portal_rating_average',
          targetValue: 4.5,
          startMonth: '2026-11',
          subjects: [{ kind: 'property', propertyId }],
        },
        actor,
      )
      const ready = barrier(2)
      const programs = programsWith({
        ...repository,
        create: async (input) => {
          await ready()
          return repository.create(input)
        },
        revise: async (input) => {
          await ready()
          return repository.revise(input)
        },
      })
      const outcomes = await Promise.allSettled([
        programs.create(
          {
            propertyId,
            name: 'Ratings',
            metric: 'portal_rating_count',
            targetValue: 40,
            startMonth: '2026-11',
            subjects: [{ kind: 'property', propertyId }],
          },
          actor,
        ),
        programs.revise(
          {
            propertyId,
            programId: average.program.id,
            metric: 'qualified_scans',
            targetValue: 40,
            subjects: [{ kind: 'property', propertyId }],
          },
          actor,
        ),
      ])
      expect(outcomes.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ])
      const refused = outcomes.find((outcome) => outcome.status === 'rejected')
      expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
        code: 'subject_has_goal',
      })
      const stored = await repository.list(organizationId, propertyId)
      expect(
        stored.filter(({ version }) => version.metric !== 'portal_rating_average'),
      ).toHaveLength(1)
    },
    RACE_TIMEOUT_MS,
  )

  it('keeps average and several-subject programs alongside the Property count goal', async () => {
    const repository = createGoalProgramRepository(getDb())
    const propertyId = await propertyFixture()
    const programs = programsWith(repository)
    const portalId = randomUUID()
    await lease.pool.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $4, 'Reception', $5)`,
      [portalId, organizationId, propertyId, propertyId, `portal-${randomUUID()}`],
    )
    await programs.create(
      {
        propertyId,
        name: 'Average',
        metric: 'portal_rating_average',
        targetValue: 4.5,
        startMonth: '2026-11',
        subjects: [{ kind: 'property', propertyId }],
      },
      actor,
    )
    await programs.create(
      {
        propertyId,
        name: 'Several subjects',
        metric: 'qualified_scans',
        targetValue: 40,
        startMonth: '2026-11',
        subjects: [
          { kind: 'property', propertyId },
          { kind: 'portal', portalId },
        ],
      },
      actor,
    )
    await commandWith(repository, 1)(propertyId, 'portal_rating_count')
    const stored = await repository.list(organizationId, propertyId)
    expect(stored).toHaveLength(3)
    expect(
      stored.find(({ program }) => program.name === 'Several subjects')?.assignments,
    ).toHaveLength(2)
  })

  it('frees the identity after Stop without deleting the ended goal', async () => {
    const repository = createGoalProgramRepository(getDb())
    const propertyId = await propertyFixture()
    const first = await commandWith(repository, 1)(propertyId, 'portal_rating_count')
    await programsWith(repository).changeStatus(
      {
        propertyId,
        programId: first.program.id,
        status: 'ended',
      },
      actor,
    )
    await commandWith(repository, 1)(propertyId, 'qualified_scans')
    const stored = await repository.list(organizationId, propertyId)
    expect(stored).toHaveLength(2)
    expect(
      stored.find(({ program }) => program.id === first.program.id)?.program.status,
    ).toBe('ended')
  })

  it(
    'two sets racing on different count measures: one wins, the other is refused',
    async () => {
      const repository = createGoalProgramRepository(getDb())
      const propertyId = await propertyFixture()
      const set = commandWith(repository, 2)

      const outcomes = await Promise.allSettled([
        set(propertyId, 'portal_rating_count'),
        set(propertyId, 'qualified_scans'),
      ])

      const stored = await repository.list(organizationId, propertyId)
      expect(outcomes.map(({ status }) => status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ])
      const refused = outcomes.find((outcome) => outcome.status === 'rejected')
      expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
        code: 'subject_has_goal',
      })
      expect(stored).toHaveLength(1)
      expect(monthlyPortalGoalOf(stored, NOW)?.program.id).toBe(stored[0]?.program.id)
    },
    RACE_TIMEOUT_MS,
  )
})
