// The Monthly portal goal's month-start check-in on PostgreSQL (ADR 0068
// decision 8, PLAN PG-15): its Use is the change now, its Keep the answered
// month alone. Two managers pressing them at the same moment, each after
// reading the goal, both land: the month takes the new number and the
// check-in is answered, and neither undoes the other (Keep moves neither the
// goal's head nor its status, so the change's version stands).
//
// Both commands run on their own connections, so the data is committed: a
// Property of its own, in an Organization of its own. The month guard reads the
// database clock, so the month is the real current month, on UTC; the
// commands' clock is its 3rd, a day the check-in is open.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { calendarPeriodRange } from '#/shared/domain/period-range'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { findMetricVersionById } from '../domain/metric-registry'
import { monthKeyOf } from '../domain/goal-start'
import type { GoalProgramRepository } from '../application/ports/goal-program.repository'
import {
  createGoalProgramService,
  type GoalActor,
} from '../application/use-cases/goal-programs'
import {
  changeMonthlyPortalGoalNow,
  keepMonthlyPortalGoal,
  setMonthlyPortalGoal,
} from '../application/use-cases/monthly-portal-goal'
import { createGoalProgramRepository } from './repositories/goal-program.repository'

const TIMEZONE = 'UTC'
const RACE_TIMEOUT_MS = 60_000

/** Resolves once `parties` callers are waiting, so each reads the goal before any writes. */
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

describe.sequential('Monthly portal goal check-in (integration)', () => {
  let lease: TestLease
  const organizationId = `monthly-portal-goal-check-in-${randomUUID()}`
  const actor: GoalActor = { organizationId, userId: 'elena', role: 'PropertyManager' }
  const allow = { authorize: async () => undefined }
  const thisMonth = calendarPeriodRange(new Date(), TIMEZONE, 'monthly')
  const thisKey = monthKeyOf(thisMonth.start, TIMEZONE)
  const nextKey = monthKeyOf(
    calendarPeriodRange(thisMonth.end, TIMEZONE, 'monthly').start,
    TIMEZONE,
  )
  /** The 3rd of this month, at noon: the check-in is open. */
  const THIRD = new Date(thisMonth.start.getTime() + (2 * 24 + 12) * 60 * 60 * 1_000)

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
      [id, organizationId, `pg-check-in-${randomUUID()}`],
    )
    return id
  }

  /** The engine's commands over PostgreSQL, on the check-in's day. */
  function engine(repository: GoalProgramRepository) {
    return createGoalProgramService({
      repository,
      policy: allow,
      subjects: {
        getTimezone: async () => TIMEZONE,
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
      now: () => THIRD,
    })
  }

  const recommendation = {
    subjects: { getTimezone: async () => TIMEZONE },
    facts: {
      listPortalReadiness: async () => ({ portals: [], truncated: false }),
      readDailyCounts: async () => ({ days: [], unreadable: [], lastScanAt: new Map() }),
    },
  }

  it(
    'Use and Keep racing leave the new target and an answered month',
    async () => {
      const repository = createGoalProgramRepository(getDb())
      const programs = engine(repository)
      const propertyId = await propertyFixture()
      const { program } = await setMonthlyPortalGoal(
        { policy: allow, repository, programs, recommendation, now: () => THIRD },
        {
          propertyId,
          metric: 'portal_rating_count',
          targetValue: 40,
          startMonth: thisKey,
          targetSource: 'own',
        },
        actor,
      )
      // Each command reads the goal, and neither writes before both have.
      const read = barrier(2)
      const reading: GoalProgramRepository = {
        ...repository,
        list: async (...args) => {
          const found = await repository.list(...args)
          await read()
          return found
        },
      }

      const [used, kept] = await Promise.allSettled([
        changeMonthlyPortalGoalNow(
          {
            policy: allow,
            repository: reading,
            programs,
            recommendation,
            now: () => THIRD,
          },
          {
            propertyId,
            programId: program.id,
            month: thisKey,
            targetValue: 45,
            expectedTarget: 40,
            expectedVersion: 1,
            expectedFollowingMonth: nextKey,
            targetSource: 'own',
          },
          actor,
        ),
        keepMonthlyPortalGoal(
          { policy: allow, repository: reading, now: () => THIRD },
          { propertyId, programId: program.id, month: thisKey },
          actor,
        ),
      ])

      expect([used.status, kept.status]).toEqual(['fulfilled', 'fulfilled'])
      const goal = await repository.get(organizationId, propertyId, program.id)
      expect(goal?.results).toHaveLength(1)
      expect(goal?.results[0]).toMatchObject({ status: 'open', targetValue: 45 })
      // The change's version for the months after stands; Keep moved nothing.
      expect(goal?.version).toMatchObject({ version: 2, targetValue: 45 })
      expect(goal?.program).toMatchObject({
        status: 'active',
        currentVersion: 2,
        checkInAnsweredMonth: thisKey,
      })
    },
    RACE_TIMEOUT_MS,
  )

  it('Keep twice is the same answer, and a month not running is check_in_closed', async () => {
    const repository = createGoalProgramRepository(getDb())
    const programs = engine(repository)
    const propertyId = await propertyFixture()
    const { program } = await setMonthlyPortalGoal(
      { policy: allow, repository, programs, recommendation, now: () => THIRD },
      {
        propertyId,
        metric: 'portal_rating_count',
        targetValue: 40,
        startMonth: thisKey,
        targetSource: 'own',
      },
      actor,
    )
    const keep = (month: string, now: Date = THIRD) =>
      keepMonthlyPortalGoal(
        { policy: allow, repository, now: () => now },
        { propertyId, programId: program.id, month },
        actor,
      )

    await expect(keep(thisKey)).resolves.toEqual({ month: thisKey })
    await expect(keep(thisKey)).resolves.toEqual({ month: thisKey })
    await expect(keep(nextKey)).rejects.toMatchObject({ code: 'check_in_closed' })
    // The 8th: the check-in has folded away.
    const eighth = new Date(thisMonth.start.getTime() + 7 * 24 * 60 * 60 * 1_000)
    await expect(keep(thisKey, eighth)).rejects.toMatchObject({ code: 'check_in_closed' })

    const goal = await repository.get(organizationId, propertyId, program.id)
    expect(goal?.program).toMatchObject({
      currentVersion: 1,
      checkInAnsweredMonth: thisKey,
    })
    expect(goal?.targetChanges).toEqual([])
  })
})
