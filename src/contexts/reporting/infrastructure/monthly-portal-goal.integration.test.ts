// The Monthly portal goal's set command on PostgreSQL (ADR 0068 decision 1,
// PLAN PG-09): one per Property is a pre-check, not a lock. Two sets that both
// pass it at the same moment meet the database's no-overlap rule on one
// measure, which keeps the first and refuses the second `subject_has_goal` (the
// two inserts often deadlock in that check; the repository runs the victim once
// more, and it meets the first); on
// two measures both land, and the earliest-created is the monthly goal (the
// accepted race, watched by the beta count of PLAN §3.8).
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

  /**
   * The command over PostgreSQL's Goal Program tables, with the Property's
   * Programs read by every set before any of them writes.
   */
  function commandWith(repository: GoalProgramRepository, parties: number) {
    const listed = barrier(parties)
    const programs = createGoalProgramService({
      repository,
      policy: { authorize: async () => undefined },
      subjects: {
        getTimezone: async () => 'UTC',
        subjectBelongsToProperty: async () => true,
        listCurrentPortalIds: async () => [],
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

  it(
    'two sets racing on the two measures both land, and the first is the monthly goal',
    async () => {
      const repository = createGoalProgramRepository(getDb())
      const propertyId = await propertyFixture()
      const set = commandWith(repository, 2)

      const [ratings, scans] = await Promise.all([
        set(propertyId, 'portal_rating_count'),
        set(propertyId, 'qualified_scans'),
      ])

      const stored = await repository.list(organizationId, propertyId)
      expect(stored.map(({ program }) => program.id).sort()).toEqual(
        [ratings.program.id, scans.program.id].sort(),
      )
      const first = [...stored].sort(
        (a, b) =>
          a.program.createdAt.getTime() - b.program.createdAt.getTime() ||
          a.program.id.localeCompare(b.program.id),
      )[0]
      expect(monthlyPortalGoalOf(stored, NOW)?.program.id).toBe(first?.program.id)
    },
    RACE_TIMEOUT_MS,
  )
})
