import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'

type ProgramFixture = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  programId: string
  programVersionId: string
  metricDefinitionId: string
}>

describe('canonical Goal Program database guards', () => {
  let lease: TestLease
  let fixture: ProgramFixture

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    const organizationId = `goal-program-${randomUUID()}`
    const propertyId = randomUUID()
    const portalId = randomUUID()
    const programId = randomUUID()
    const programVersionId = randomUUID()
    const metric = await lease.pool.query<{ definition_id: string }>(
      `SELECT definition_id
       FROM metric_definition_versions
       WHERE id = $1`,
      [METRIC_VERSION_IDS.portalRatingCountGoal],
    )
    const metricDefinitionId = metric.rows[0]?.definition_id
    if (!metricDefinitionId) throw new Error('seeded Goal metric version is missing')

    await lease.pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Goal Property', $3, 'UTC')`,
      [propertyId, organizationId, `goal-${randomUUID()}`],
    )
    await lease.pool.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $4, 'Goal Portal', $5)`,
      [portalId, organizationId, propertyId, propertyId, `goal-portal-${randomUUID()}`],
    )
    await lease.pool.query(
      `INSERT INTO goal_programs
         (id, organization_id, property_id, name, status, created_by)
       VALUES ($1, $2, $3, 'Monthly rating count', 'scheduled', 'test')`,
      [programId, organizationId, propertyId],
    )
    await lease.pool.query(
      `INSERT INTO goal_program_versions
         (id, program_id, organization_id, property_id, version,
          metric_definition_id, metric_definition_version_id, metric_key,
          metric_minimum_sample, target_value, property_timezone,
          effective_from, change_reason, created_by)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 'portal_rating_count', 0,
               25, 'UTC', '2026-01-01T00:00:00Z', 'created', 'test')`,
      [
        programVersionId,
        programId,
        organizationId,
        propertyId,
        metricDefinitionId,
        METRIC_VERSION_IDS.portalRatingCountGoal,
      ],
    )

    fixture = {
      organizationId,
      propertyId,
      portalId,
      programId,
      programVersionId,
      metricDefinitionId,
    }
  })

  afterAll(async () => {
    await lease?.release()
  })

  async function insertAssignment(
    input: {
      id?: string
      subjectKind?: 'property' | 'portal'
      portalId?: string | null
      effectiveFrom?: string
      effectiveTo?: string | null
    } = {},
  ): Promise<string> {
    const id = input.id ?? randomUUID()
    const subjectKind = input.subjectKind ?? 'property'
    await lease.pool.query(
      `INSERT INTO goal_subject_assignments
         (id, program_id, program_version_id, organization_id, property_id,
          metric_key, subject_kind, property_subject_id, portal_id,
          effective_from, effective_to, created_by)
       VALUES ($1, $2, $3, $4, $5, 'portal_rating_count', $6, $7, $8, $9, $10, 'test')`,
      [
        id,
        fixture.programId,
        fixture.programVersionId,
        fixture.organizationId,
        fixture.propertyId,
        subjectKind,
        subjectKind === 'property' ? fixture.propertyId : null,
        input.portalId ?? (subjectKind === 'portal' ? fixture.portalId : null),
        input.effectiveFrom ?? '2026-01-01T00:00:00Z',
        input.effectiveTo === undefined ? '2026-03-01T00:00:00Z' : input.effectiveTo,
      ],
    )
    return id
  }

  it('pins every canonical metric name to its exact governed version', async () => {
    await expect(
      lease.pool.query(
        `INSERT INTO goal_program_versions
           (id, program_id, organization_id, property_id, version,
            metric_definition_id, metric_definition_version_id, metric_key,
            metric_minimum_sample, target_value, property_timezone,
            effective_from, change_reason, created_by)
         VALUES ($1, $2, $3, $4, 2, $5, $6, 'portal_rating_average', 10,
                 4.5, 'UTC', '2026-03-01T00:00:00Z', 'wrong pin', 'test')`,
        [
          randomUUID(),
          fixture.programId,
          fixture.organizationId,
          fixture.propertyId,
          fixture.metricDefinitionId,
          METRIC_VERSION_IDS.portalRatingCountGoal,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('prevents overlapping assignments for the same subject and metric', async () => {
    await insertAssignment()
    await expect(
      insertAssignment({
        effectiveFrom: '2026-02-01T00:00:00Z',
        effectiveTo: null,
      }),
    ).rejects.toMatchObject({ code: '23P01' })

    await expect(
      insertAssignment({
        effectiveFrom: '2026-03-01T00:00:00Z',
        effectiveTo: null,
      }),
    ).resolves.toEqual(expect.any(String))
  })

  it('rejects a subject owned by another tenant', async () => {
    const otherOrganizationId = `goal-program-${randomUUID()}`
    const otherPropertyId = randomUUID()
    const otherPortalId = randomUUID()
    await lease.pool.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Other Property', $3, 'UTC')`,
      [otherPropertyId, otherOrganizationId, `other-${randomUUID()}`],
    )
    await lease.pool.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $4, 'Other Portal', $5)`,
      [
        otherPortalId,
        otherOrganizationId,
        otherPropertyId,
        otherPropertyId,
        `other-${randomUUID()}`,
      ],
    )

    await expect(
      insertAssignment({ subjectKind: 'portal', portalId: otherPortalId }),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('enforces full months, ordered closure, immutability, and direct revisions', async () => {
    const assignmentId = await insertAssignment({
      subjectKind: 'portal',
      effectiveTo: '2026-03-01T00:00:00Z',
    })
    const resultId = randomUUID()

    await expect(
      lease.pool.query(
        `INSERT INTO goal_monthly_results
           (id, assignment_id, program_id, program_version_id, organization_id,
            property_id, period_start, period_end, property_timezone)
         VALUES ($1, $2, $3, $4, $5, $6,
                 '2026-01-02T00:00:00Z', '2026-02-01T00:00:00Z', 'UTC')`,
        [
          randomUUID(),
          assignmentId,
          fixture.programId,
          fixture.programVersionId,
          fixture.organizationId,
          fixture.propertyId,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await lease.pool.query(
      `INSERT INTO goal_monthly_results
         (id, assignment_id, program_id, program_version_id, organization_id,
          property_id, period_start, period_end, property_timezone)
       VALUES ($1, $2, $3, $4, $5, $6,
               '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'UTC')`,
      [
        resultId,
        assignmentId,
        fixture.programId,
        fixture.programVersionId,
        fixture.organizationId,
        fixture.propertyId,
      ],
    )

    await expect(
      lease.pool.query(
        `UPDATE goal_monthly_results
         SET status = 'closed', evaluation_state = 'eligible', value = 12,
             sample_count = 12, achieved = false, reason = NULL,
             source_complete_through = period_end, evaluation_watermark = now(),
             closed_at = now()
         WHERE id = $1`,
        [resultId],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await lease.pool.query(
      `UPDATE goal_monthly_results
       SET status = 'reconciling'
       WHERE id = $1`,
      [resultId],
    )
    await lease.pool.query(
      `UPDATE goal_monthly_results
       SET status = 'closed', evaluation_state = 'eligible', value = 12,
           sample_count = 12, achieved = false, reason = NULL,
           source_complete_through = period_end, evaluation_watermark = now(),
           closed_at = now()
       WHERE id = $1`,
      [resultId],
    )
    await expect(
      lease.pool.query(`UPDATE goal_monthly_results SET value = 13 WHERE id = $1`, [
        resultId,
      ]),
    ).rejects.toMatchObject({ code: '55000' })

    const firstRevisionId = randomUUID()
    await lease.pool.query(
      `INSERT INTO goal_result_revisions
         (id, monthly_result_id, organization_id, property_id, revision,
          evaluation_state, value, sample_count, achieved,
          source_complete_through, evaluation_watermark, change_reason, created_by)
       VALUES ($1, $2, $3, $4, 1, 'eligible', 11, 11, false,
               '2026-02-01T00:00:00Z', now(), 'late rating retraction', 'system')`,
      [firstRevisionId, resultId, fixture.organizationId, fixture.propertyId],
    )
    await expect(
      lease.pool.query(
        `INSERT INTO goal_result_revisions
           (id, monthly_result_id, organization_id, property_id, revision,
            evaluation_state, value, sample_count, achieved,
            source_complete_through, evaluation_watermark, change_reason, created_by)
         VALUES ($1, $2, $3, $4, 2, 'eligible', 10, 10, false,
                 '2026-02-01T00:00:00Z', now(), 'missing lineage', 'system')`,
        [randomUUID(), resultId, fixture.organizationId, fixture.propertyId],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
