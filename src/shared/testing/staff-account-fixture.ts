import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { deleteTestOrganizations } from './integration-helpers'
import { invitationId } from '#/shared/domain/ids'

export const STAFF_FIXTURE_NOW = new Date('2026-11-04T12:00:00Z')
export type StaffAccountFixture = Awaited<ReturnType<typeof seedStaffAccountFixture>>

export async function seedStaffAccountFixture(pool: Pool) {
  const suffix = randomUUID()
  const row = {
    organizationId: `staff-account-${suffix}`,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    participantId: randomUUID(),
    participationId: randomUUID(),
    invitationId: invitationId(`staff-invitation-${suffix}`),
    userId: `staff-user-${suffix}`,
    inviterId: `staff-inviter-${suffix}`,
    email: `polly-${suffix}@example.com`,
  }
  await pool.query(
    'INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, $2)',
    [row.organizationId, STAFF_FIXTURE_NOW],
  )
  await pool.query(
    "INSERT INTO properties (id, organization_id, name, slug, timezone, country_code) VALUES ($1::uuid, $2, 'Harbor', $1::text, 'Europe/Sofia', 'BG')",
    [row.propertyId, row.organizationId],
  )
  await pool.query(
    "INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug, kind, public_name) VALUES ($1::uuid, $2, $3::uuid, $3::text, 'Polly Smith', $4, 'personal', 'Harbor')",
    [
      row.portalId,
      row.organizationId,
      row.propertyId,
      `portal-${row.portalId.slice(0, 8)}`,
    ],
  )
  await pool.query(
    "INSERT INTO staff_participants (id, organization_id, display_name, created_by) VALUES ($1, $2, 'Polly Smith', $3)",
    [row.participantId, row.organizationId, row.inviterId],
  )
  await pool.query(
    "INSERT INTO staff_participations (id, organization_id, property_id, staff_participant_id, personal_portal_id, display_name, created_by) VALUES ($1, $2, $3, $4, $5, 'Polly Smith', $6)",
    [
      row.participationId,
      row.organizationId,
      row.propertyId,
      row.participantId,
      row.portalId,
      row.inviterId,
    ],
  )
  await pool.query(
    'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $1, $2, true, $3, $3)',
    [row.inviterId, `${row.inviterId}@example.com`, STAFF_FIXTURE_NOW],
  )
  await pool.query(
    `INSERT INTO invitation (id, "organizationId", email, role, status, "expiresAt", "staffParticipationId", "propertyIds", "inviterId", "createdAt") VALUES ($1, $2, $3, 'member', 'pending', $4, $5, $6, $7, $8)`,
    [
      row.invitationId,
      row.organizationId,
      row.email,
      new Date(STAFF_FIXTURE_NOW.getTime() + 7 * 86400000),
      row.participationId,
      JSON.stringify([row.propertyId]),
      row.inviterId,
      STAFF_FIXTURE_NOW,
    ],
  )
  return row
}

export async function seedStaffAccountUser(
  pool: Pool,
  row: StaffAccountFixture,
  accountId = `${row.userId}-credential`,
) {
  await pool.query(
    'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, false, $4, $4)',
    [row.userId, 'Polly Smith', row.email, STAFF_FIXTURE_NOW],
  )
  await pool.query(
    `INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt") VALUES ($1, $2, 'credential', $2, 'test-only-hash', $3, $3)`,
    [accountId, row.userId, STAFF_FIXTURE_NOW],
  )
}

export async function cleanStaffAccountFixture(pool: Pool, row: StaffAccountFixture) {
  await pool.query('DELETE FROM verification WHERE identifier = $1', [
    `invited-registration:${row.invitationId}`,
  ])
  for (const table of ['metric_corrections', 'metric_readings']) {
    if (table === 'metric_corrections')
      await pool.query(
        'DELETE FROM metric_corrections WHERE reading_id IN (SELECT id FROM metric_readings WHERE organization_id = $1)',
        [row.organizationId],
      )
    else
      await pool.query('DELETE FROM metric_readings WHERE organization_id = $1', [
        row.organizationId,
      ])
  }
  for (const table of [
    'outbox_events',
    'staff_onboardings',
    'staff_property_settings',
    'portal_responsibilities',
    'portal_group_memberships',
    'staff_participations',
    'staff_user_links',
    'staff_participants',
    'portal_address_downloads',
    'portal_tokens',
    'portals',
    'property_access_grant',
    'properties',
  ])
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
      row.organizationId,
    ])
  await pool.query('DELETE FROM invitation WHERE "organizationId" = $1', [
    row.organizationId,
  ])
  await pool.query('DELETE FROM member WHERE "organizationId" = $1', [row.organizationId])
  await deleteTestOrganizations(pool, [row.organizationId])
  await pool.query('DELETE FROM "user" WHERE id IN ($1, $2)', [row.userId, row.inviterId])
}
