import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  seedStaffAccountFixture,
  cleanStaffAccountFixture,
  STAFF_FIXTURE_NOW as NOW,
  type StaffAccountFixture,
} from './staff-account-fixture'
import {
  METRIC_DEFINITION_IDS,
  METRIC_VERSION_IDS,
} from '#/contexts/reporting/domain/metric-registry'
export async function seedStaffTarget(
  pool: Pool,
  metric: 'qualified_scans' | 'portal_rating_count' = 'qualified_scans',
) {
  const row = await seedStaffAccountFixture(pool)
  const groupId = randomUUID(),
    placeId = randomUUID(),
    programId = randomUUID(),
    versionId = randomUUID()
  await pool.query(
    "INSERT INTO portal_groups (id, organization_id, property_id, name) VALUES ($1,$2,$3,'Desk')",
    [groupId, row.organizationId, row.propertyId],
  )
  await pool.query(
    "INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug) VALUES ($1::uuid,$2,$3::uuid,$3::text,'Desk',$1::text)",
    [placeId, row.organizationId, row.propertyId],
  )
  await pool.query(
    "INSERT INTO portal_group_memberships (organization_id, property_id, portal_id, portal_group_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,'test')",
    [row.organizationId, row.propertyId, row.portalId, groupId, NOW],
  )
  await pool.query(
    "INSERT INTO goal_programs (id, organization_id, property_id, name, status, created_by) VALUES ($1,$2,$3,'Target','active','test')",
    [programId, row.organizationId, row.propertyId],
  )
  const scans = metric === 'qualified_scans'
  await pool.query(
    "INSERT INTO goal_program_versions (id, program_id, organization_id, property_id, version, metric_definition_id, metric_definition_version_id, metric_key, metric_minimum_sample, target_value, property_timezone, effective_from, change_reason, created_by) VALUES ($1,$2,$3,$4,1,$5,$6,$7,0,25,'Europe/Sofia',$8,'created','test')",
    [
      versionId,
      programId,
      row.organizationId,
      row.propertyId,
      scans
        ? METRIC_DEFINITION_IDS.qualifiedScan
        : METRIC_DEFINITION_IDS.portalRatingCount,
      scans
        ? METRIC_VERSION_IDS.qualifiedScanGoal
        : METRIC_VERSION_IDS.portalRatingCountGoal,
      metric,
      NOW,
    ],
  )
  await pool.query(
    "INSERT INTO goal_subject_assignments (id, program_id, program_version_id, organization_id, property_id, metric_key, subject_kind, portal_group_id, effective_from, created_by) VALUES ($1,$2,$3,$4,$5,$6,'portal_group',$7,$8,'test')",
    [
      randomUUID(),
      programId,
      versionId,
      row.organizationId,
      row.propertyId,
      metric,
      groupId,
      NOW,
    ],
  )
  return { ...row, groupId, placeId }
}
export async function cleanStaffTarget(pool: Pool, row: StaffAccountFixture) {
  for (const table of [
    'goal_subject_assignments',
    'goal_program_versions',
    'goal_programs',
    'portal_group_memberships',
    'portal_groups',
  ])
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
      row.organizationId,
    ])
  await cleanStaffAccountFixture(pool, row)
}
