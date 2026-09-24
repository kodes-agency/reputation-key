import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { METRIC_DEFINITION_IDS, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createMonthlyResultNotificationFactsLookup } from './monthly-result-notification-facts.lookup'

describe.sequential('monthly-result notification facts lookup (integration)', () => {
  let lease: TestLease
  let organizationId: string
  let propertyId: string

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    organizationId = `goal-notification-facts-${randomUUID()}`
    propertyId = randomUUID()
  })

  beforeEach(async () => {
    propertyId = randomUUID()
    await lease.pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Goal Notification Facts Property', $3, 'UTC')`,
      [propertyId, organizationId, `goal-notification-${randomUUID()}`],
    )
  })

  afterAll(async () => {
    await lease?.release()
  })

  async function seedClosedResult(
    subject:
      | Readonly<{ kind: 'property' }>
      | Readonly<{ kind: 'portal_group'; id: string }>
      | Readonly<{ kind: 'portal'; id: string }>,
    achieved = true,
    /**
     * The Property's own calendar. A month is stored as the UTC instants of
     * its LOCAL boundaries, so a Property ahead of UTC starts its month on
     * the previous UTC day: reading the period in UTC would name the month
     * before it.
     */
    period: Readonly<{ timezone: string; start: string; end: string }> = {
      timezone: 'UTC',
      start: '2026-07-01T00:00:00.000Z',
      end: '2026-08-01T00:00:00.000Z',
    },
  ) {
    const programId = randomUUID()
    const programVersionId = randomUUID()
    const assignmentId = randomUUID()
    const monthlyResultId = randomUUID()
    const programName = `Monthly result ${subject.kind} ${randomUUID()}`
    const effectiveFrom = new Date(period.start)
    const periodEnd = new Date(period.end)
    const closedAt = new Date('2026-08-02T12:00:00.000Z')

    await lease.pool.query(
      `INSERT INTO goal_programs
         (id, organization_id, property_id, name, status, current_version,
          created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', 1, 'manager-1', $5, $5)`,
      [programId, organizationId, propertyId, programName, effectiveFrom],
    )
    await lease.pool.query(
      `INSERT INTO goal_program_versions
         (id, program_id, organization_id, property_id, version,
          metric_definition_id, metric_definition_version_id, metric_key,
          metric_minimum_sample, target_value, property_timezone,
          effective_from, change_reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 'portal_rating_count', 0, 10,
               $8, $7, 'created', 'manager-1', $7)`,
      [
        programVersionId,
        programId,
        organizationId,
        propertyId,
        METRIC_DEFINITION_IDS.portalRatingCount,
        METRIC_VERSION_IDS.portalRatingCountGoal,
        effectiveFrom,
        period.timezone,
      ],
    )
    await lease.pool.query(
      `INSERT INTO goal_subject_assignments
         (id, program_id, program_version_id, organization_id, property_id,
          metric_key, subject_kind, property_subject_id, portal_group_id,
          portal_id, effective_from, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 'portal_rating_count', $6, $7, $8, $9,
               $10, 'manager-1', $10)`,
      [
        assignmentId,
        programId,
        programVersionId,
        organizationId,
        propertyId,
        subject.kind,
        subject.kind === 'property' ? propertyId : null,
        subject.kind === 'portal_group' ? subject.id : null,
        subject.kind === 'portal' ? subject.id : null,
        effectiveFrom,
      ],
    )
    await lease.pool.query(
      `INSERT INTO goal_monthly_results
         (id, assignment_id, program_id, program_version_id, organization_id,
          property_id, period_start, period_end, property_timezone, status,
          evaluation_state, value, sample_count, achieved,
          source_complete_through, evaluation_watermark, closed_at,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $11, 'closed', 'eligible',
               12, 12, $9, $8, $10, $10, $7, $10)`,
      [
        monthlyResultId,
        assignmentId,
        programId,
        programVersionId,
        organizationId,
        propertyId,
        effectiveFrom,
        periodEnd,
        achieved,
        closedAt,
        period.timezone,
      ],
    )

    return { programId, programVersionId, assignmentId, monthlyResultId, programName }
  }

  it('names the month on the Property\u2019s calendar, not on UTC', async () => {
    // July in Auckland begins on 30 June in UTC. Reading the period on the
    // server's clock would report a June goal for a July result.
    const seeded = await seedClosedResult({ kind: 'property' }, true, {
      timezone: 'Pacific/Auckland',
      start: '2026-06-30T12:00:00.000Z',
      end: '2026-07-31T12:00:00.000Z',
    })
    const lookup = createMonthlyResultNotificationFactsLookup(getDb())

    await expect(
      lookup.findMonthlyResultNotificationFacts({
        organizationId,
        propertyId,
        assignmentId: seeded.assignmentId,
        monthlyResultId: seeded.monthlyResultId,
      }),
    ).resolves.toMatchObject({ periodMonth: '2026-07' })
  })

  it('returns exact joined facts for every Goal subject kind', async () => {
    const portalGroupId = randomUUID()
    const portalId = randomUUID()
    await lease.pool.query(
      `INSERT INTO portal_groups
         (id, organization_id, property_id, name)
       VALUES ($1, $2, $3, 'Front desk')`,
      [portalGroupId, organizationId, propertyId],
    )
    await lease.pool.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $5, 'Reception QR', $4)`,
      [portalId, organizationId, propertyId, `reception-${randomUUID()}`, propertyId],
    )
    const cases = [
      {
        seeded: await seedClosedResult({ kind: 'property' }),
        subject: { kind: 'property', propertyId },
      },
      {
        seeded: await seedClosedResult({ kind: 'portal_group', id: portalGroupId }),
        subject: { kind: 'portal_group', portalGroupId },
      },
      {
        seeded: await seedClosedResult({ kind: 'portal', id: portalId }),
        subject: { kind: 'portal', portalId },
      },
    ] as const
    const lookup = createMonthlyResultNotificationFactsLookup(getDb())

    for (const { seeded, subject } of cases) {
      await expect(
        lookup.findMonthlyResultNotificationFacts({
          organizationId,
          propertyId,
          assignmentId: seeded.assignmentId,
          monthlyResultId: seeded.monthlyResultId,
        }),
      ).resolves.toEqual({
        programId: seeded.programId,
        monthlyResultId: seeded.monthlyResultId,
        assignmentId: seeded.assignmentId,
        programName: seeded.programName,
        periodMonth: '2026-07',
        subject,
      })
    }
  })

  it('returns null instead of falling back across status, outcome, or identity', async () => {
    const portalId = randomUUID()
    await lease.pool.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $5, 'Non-achieved QR', $4)`,
      [portalId, organizationId, propertyId, `non-achieved-${randomUUID()}`, propertyId],
    )
    const seeded = await seedClosedResult({ kind: 'portal', id: portalId }, false)
    const lookup = createMonthlyResultNotificationFactsLookup(getDb())
    const exact = {
      organizationId,
      propertyId,
      assignmentId: seeded.assignmentId,
      monthlyResultId: seeded.monthlyResultId,
    }

    await expect(lookup.findMonthlyResultNotificationFacts(exact)).resolves.toBeNull()
    for (const mismatch of [
      { organizationId: `${organizationId}-other` },
      { propertyId: randomUUID() },
      { assignmentId: randomUUID() },
      { monthlyResultId: randomUUID() },
    ]) {
      await expect(
        lookup.findMonthlyResultNotificationFacts({ ...exact, ...mismatch }),
      ).resolves.toBeNull()
    }
  })

  async function appendRevision(
    monthlyResultId: string,
    input: Readonly<{
      revision: number
      supersedesRevisionId: string | null
      evaluationState: 'eligible' | 'unavailable'
      value: number | null
      achieved: boolean | null
      at: string
    }>,
  ): Promise<string> {
    const id = randomUUID()
    const eligible = input.evaluationState === 'eligible'
    await lease.pool.query(
      `INSERT INTO goal_result_revisions
         (id, monthly_result_id, organization_id, property_id, revision,
          supersedes_revision_id, evaluation_state, value, sample_count,
          achieved, reason, source_complete_through, evaluation_watermark,
          change_reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               'metric correction', 'system', $13)`,
      [
        id,
        monthlyResultId,
        organizationId,
        propertyId,
        input.revision,
        input.supersedesRevisionId,
        input.evaluationState,
        input.value,
        input.value ?? 0,
        input.achieved,
        eligible ? null : 'reading_unavailable',
        eligible ? new Date('2026-08-01T00:00:00.000Z') : null,
        new Date(input.at),
      ],
    )
    return id
  }

  it('resolves a correction to the current head of its result', async () => {
    const seeded = await seedClosedResult({ kind: 'property' })
    const firstRevisionId = await appendRevision(seeded.monthlyResultId, {
      revision: 1,
      supersedesRevisionId: null,
      evaluationState: 'unavailable',
      value: null,
      achieved: null,
      at: '2026-08-03T12:00:00.000Z',
    })
    const lookup = createMonthlyResultNotificationFactsLookup(getDb())
    const firstFence = {
      organizationId,
      propertyId,
      programId: seeded.programId,
      programVersionId: seeded.programVersionId,
      assignmentId: seeded.assignmentId,
      monthlyResultId: seeded.monthlyResultId,
      revisionId: firstRevisionId,
      revision: 1,
    }

    await expect(
      lookup.findMonthlyResultRevisionNotificationFacts(firstFence),
    ).resolves.toMatchObject({
      programId: seeded.programId,
      programVersionId: seeded.programVersionId,
      monthlyResultId: seeded.monthlyResultId,
      revisionId: firstRevisionId,
      revision: 1,
      evaluationState: 'unavailable',
      achieved: null,
    })

    const secondRevisionId = await appendRevision(seeded.monthlyResultId, {
      revision: 2,
      supersedesRevisionId: firstRevisionId,
      evaluationState: 'eligible',
      value: 8,
      achieved: false,
      at: '2026-08-04T12:00:00.000Z',
    })

    // A superseded correction resolves to the head that replaced it; the
    // caller decides whether that head still says what its notice says.
    for (const fence of [
      firstFence,
      { ...firstFence, revisionId: secondRevisionId, revision: 2 },
    ]) {
      await expect(
        lookup.findMonthlyResultRevisionNotificationFacts(fence),
      ).resolves.toMatchObject({
        revisionId: secondRevisionId,
        revision: 2,
        evaluationState: 'eligible',
        achieved: false,
      })
    }
    for (const mismatch of [
      { revisionId: randomUUID() },
      { revision: 2 },
      { revisionId: secondRevisionId, revision: 1 },
      { programVersionId: randomUUID() },
    ]) {
      await expect(
        lookup.findMonthlyResultRevisionNotificationFacts({ ...firstFence, ...mismatch }),
      ).resolves.toBeNull()
    }
  })

  // Probe scenario A: the month closed achieved, r1 un-achieved it, and r2 (a
  // smaller change, still a miss, so no notice of its own) landed before r1's
  // notice was handled. r1's notice must still resolve, or "Goal completed"
  // stands uncorrected.
  it('keeps an un-achieving correction resolvable after a smaller one supersedes it', async () => {
    const seeded = await seedClosedResult({ kind: 'property' })
    const missId = await appendRevision(seeded.monthlyResultId, {
      revision: 1,
      supersedesRevisionId: null,
      evaluationState: 'eligible',
      value: 9,
      achieved: false,
      at: '2026-08-03T12:00:00.000Z',
    })
    const smallerId = await appendRevision(seeded.monthlyResultId, {
      revision: 2,
      supersedesRevisionId: missId,
      evaluationState: 'eligible',
      value: 8,
      achieved: false,
      at: '2026-08-04T12:00:00.000Z',
    })
    const lookup = createMonthlyResultNotificationFactsLookup(getDb())

    await expect(
      lookup.findMonthlyResultRevisionNotificationFacts({
        organizationId,
        propertyId,
        programId: seeded.programId,
        programVersionId: seeded.programVersionId,
        assignmentId: seeded.assignmentId,
        monthlyResultId: seeded.monthlyResultId,
        revisionId: missId,
        revision: 1,
      }),
    ).resolves.toMatchObject({
      revisionId: smallerId,
      revision: 2,
      evaluationState: 'eligible',
      achieved: false,
    })
  })

  // "Goal completed" announces the month as it stands, not as it first
  // closed: a correction that un-achieved it before the notice was handled or
  // delivered must stop it, and one that achieves it again restores it.
  it('confirms a completion only while the current head is achieved', async () => {
    const seeded = await seedClosedResult({ kind: 'property' })
    const lookup = createMonthlyResultNotificationFactsLookup(getDb())
    const exact = {
      organizationId,
      propertyId,
      assignmentId: seeded.assignmentId,
      monthlyResultId: seeded.monthlyResultId,
    }
    const missId = await appendRevision(seeded.monthlyResultId, {
      revision: 1,
      supersedesRevisionId: null,
      evaluationState: 'eligible',
      value: 9,
      achieved: false,
      at: '2026-08-03T12:00:00.000Z',
    })

    await expect(lookup.findMonthlyResultNotificationFacts(exact)).resolves.toBeNull()

    await appendRevision(seeded.monthlyResultId, {
      revision: 2,
      supersedesRevisionId: missId,
      evaluationState: 'eligible',
      value: 11,
      achieved: true,
      at: '2026-08-04T12:00:00.000Z',
    })
    await expect(lookup.findMonthlyResultNotificationFacts(exact)).resolves.toMatchObject(
      {
        monthlyResultId: seeded.monthlyResultId,
        programName: seeded.programName,
      },
    )
  })
})
