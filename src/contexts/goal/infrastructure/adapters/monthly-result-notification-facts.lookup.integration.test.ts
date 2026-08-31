import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createMonthlyResultNotificationFactsLookup } from './monthly-result-notification-facts.lookup'

describe.sequential('monthly-result notification facts lookup (integration)', () => {
  let lease: TestLease
  let organizationId: string
  let propertyId: string
  let metricDefinitionId: string

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    organizationId = `goal-notification-facts-${randomUUID()}`
    propertyId = randomUUID()
    const metric = await lease.pool.query<{ definition_id: string }>(
      `SELECT definition_id FROM metric_definition_versions WHERE id = $1`,
      [METRIC_VERSION_IDS.portalRatingCountGoal],
    )
    metricDefinitionId = metric.rows[0]?.definition_id ?? ''
    if (!metricDefinitionId) throw new Error('seeded Goal metric version is missing')
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
  ) {
    const programId = randomUUID()
    const programVersionId = randomUUID()
    const assignmentId = randomUUID()
    const monthlyResultId = randomUUID()
    const programName = `Monthly result ${subject.kind} ${randomUUID()}`
    const effectiveFrom = new Date('2026-07-01T00:00:00.000Z')
    const periodEnd = new Date('2026-08-01T00:00:00.000Z')
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
               'UTC', $7, 'created', 'manager-1', $7)`,
      [
        programVersionId,
        programId,
        organizationId,
        propertyId,
        metricDefinitionId,
        METRIC_VERSION_IDS.portalRatingCountGoal,
        effectiveFrom,
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UTC', 'closed', 'eligible',
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
      ],
    )

    return { programId, programVersionId, assignmentId, monthlyResultId, programName }
  }

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

  it('returns non-achieved and unavailable correction facts only for the current revision fence', async () => {
    const seeded = await seedClosedResult({ kind: 'property' })
    const firstRevisionId = randomUUID()
    await lease.pool.query(
      `INSERT INTO goal_result_revisions
         (id, monthly_result_id, organization_id, property_id, revision,
          supersedes_revision_id, evaluation_state, value, sample_count,
          achieved, reason, source_complete_through, evaluation_watermark,
          change_reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, 1, NULL, 'unavailable', NULL, 0, NULL,
               'reading_unavailable', NULL, $5, 'metric correction', 'system', $5)`,
      [
        firstRevisionId,
        seeded.monthlyResultId,
        organizationId,
        propertyId,
        new Date('2026-08-03T12:00:00.000Z'),
      ],
    )
    const lookup = createMonthlyResultNotificationFactsLookup(getDb())
    const revisionLookup = lookup.findMonthlyResultRevisionNotificationFacts
    if (!revisionLookup) throw new Error('revision notification lookup is missing')
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

    await expect(revisionLookup(firstFence)).resolves.toMatchObject({
      programId: seeded.programId,
      programVersionId: seeded.programVersionId,
      monthlyResultId: seeded.monthlyResultId,
      revisionId: firstRevisionId,
      revision: 1,
      evaluationState: 'unavailable',
      achieved: null,
    })

    const secondRevisionId = randomUUID()
    await lease.pool.query(
      `INSERT INTO goal_result_revisions
         (id, monthly_result_id, organization_id, property_id, revision,
          supersedes_revision_id, evaluation_state, value, sample_count,
          achieved, reason, source_complete_through, evaluation_watermark,
          change_reason, created_by, created_at)
       VALUES ($1, $2, $3, $4, 2, $5, 'eligible', 8, 8, false,
               NULL, $6, $7, 'metric correction', 'system', $7)`,
      [
        secondRevisionId,
        seeded.monthlyResultId,
        organizationId,
        propertyId,
        firstRevisionId,
        new Date('2026-08-01T00:00:00.000Z'),
        new Date('2026-08-04T12:00:00.000Z'),
      ],
    )

    await expect(revisionLookup(firstFence)).resolves.toBeNull()
    await expect(
      revisionLookup({
        ...firstFence,
        revisionId: secondRevisionId,
        revision: 2,
      }),
    ).resolves.toMatchObject({
      revisionId: secondRevisionId,
      revision: 2,
      evaluationState: 'eligible',
      achieved: false,
    })
  })
})
