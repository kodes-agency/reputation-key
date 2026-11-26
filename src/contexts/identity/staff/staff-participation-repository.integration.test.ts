import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, propertyId, userId as userIdOf } from '#/shared/domain/ids'
import { createAssignedPortalLookup } from './assigned-portal-lookup.server'

const ORG_A = 'org-staff-participation-a'
const ORG_B = 'org-staff-participation-b'
const PROPERTY_A = 'db000000-0000-4000-8000-000000000001'
const PROPERTY_B = 'db000000-0000-4000-8000-000000000002'
const PARTICIPATION = 'db000000-0000-4000-8000-000000000011'
const PARTICIPANT = 'db000000-0000-4000-8000-000000000010'
const SECOND_PARTICIPATION = 'db000000-0000-4000-8000-000000000013'
const SECOND_PARTICIPANT = 'db000000-0000-4000-8000-000000000012'
const PORTAL_A = 'db000000-0000-4000-8000-000000000021'
const PORTAL_B = 'db000000-0000-4000-8000-000000000022'
const PORTAL_C = 'db000000-0000-4000-8000-000000000023'
const START = new Date('2026-08-07T12:00:00.000Z')
const CHANGE = new Date('2026-08-08T12:00:00.000Z')
const LATER = new Date('2026-08-09T12:00:00.000Z')

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  for (const org of [ORG_A, ORG_B]) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, NOW()) ON CONFLICT (id) DO NOTHING`,
      [org],
    )
  }
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Property A', 'staff-participation-a', 'UTC', NOW(), NOW()),
            ($2, $4, 'Property B', 'staff-participation-b', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY_A, PROPERTY_B, ORG_A, ORG_B],
  )
})

afterAll(async () => {
  await pool.query(
    'DELETE FROM portal_responsibilities WHERE organization_id IN ($1, $2)',
    [ORG_A, ORG_B],
  )
  await pool.query('DELETE FROM staff_participations WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM staff_user_links WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM staff_participants WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [
    PROPERTY_A,
    PROPERTY_B,
  ])
  await deleteTestOrganizations(pool, [ORG_A, ORG_B])
  await pool.end()
})

beforeEach(async () => {
  await pool.query(
    'DELETE FROM portal_responsibilities WHERE organization_id IN ($1, $2)',
    [ORG_A, ORG_B],
  )
  await pool.query('DELETE FROM staff_participations WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM staff_user_links WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM staff_participants WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query('DELETE FROM portals WHERE organization_id IN ($1, $2)', [
    ORG_A,
    ORG_B,
  ])
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, created_at, updated_at)
     VALUES ($1, $4, $5::uuid, 'property', $5::uuid::text, 'Portal A', 'staff-portal-a', NOW(), NOW()),
            ($2, $6, $7::uuid, 'property', $7::uuid::text, 'Portal B', 'staff-portal-b', NOW(), NOW()),
            ($3, $4, $5::uuid, 'property', $5::uuid::text, 'Portal C', 'staff-portal-c', NOW(), NOW())`,
    [PORTAL_A, PORTAL_B, PORTAL_C, ORG_A, PROPERTY_A, ORG_B, PROPERTY_B],
  )
})

/** An active participation without a login, written straight to the tables. */
const insertParticipation = async (
  ids: Readonly<{ participantId: string; participationId: string; name: string }>,
) => {
  await pool.query(
    `INSERT INTO staff_participants (id, organization_id, display_name, status, revision, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', 1, 'owner', $4, $4)`,
    [ids.participantId, ORG_A, ids.name, START],
  )
  await pool.query(
    `INSERT INTO staff_participations
       (id, organization_id, property_id, staff_participant_id, user_id, display_name,
        status, started_at, revision, created_by, updated_at)
     VALUES ($1, $2, $3, $4, NULL, $5, 'active', $6, 1, 'owner', $6)`,
    [ids.participationId, ORG_A, PROPERTY_A, ids.participantId, ids.name, START],
  )
}

const insertResponsibility = (
  participationId: string,
  portalId: string,
  kind: 'primary' | 'supporting',
  effectiveFrom: Date,
  effectiveTo: Date | null,
) =>
  pool.query(
    `INSERT INTO portal_responsibilities
       (organization_id, property_id, portal_id, staff_participation_id, kind,
        effective_from, effective_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'owner')`,
    [ORG_A, PROPERTY_A, portalId, participationId, kind, effectiveFrom, effectiveTo],
  )

const ALEX = { participantId: PARTICIPANT, participationId: PARTICIPATION, name: 'Alex' }
const BLAIR = {
  participantId: SECOND_PARTICIPANT,
  participationId: SECOND_PARTICIPATION,
  name: 'Blair',
}

describe('assigned portal lookup', () => {
  const lookup = () => createAssignedPortalLookup(getDb())
  const assigned = (userId: string, org: string = ORG_A) =>
    lookup()(organizationId(org), userIdOf(userId), propertyId(PROPERTY_A))

  const linkAlex = async (now: Date) => {
    const hour = 60 * 60 * 1_000
    await pool.query(
      `INSERT INTO staff_user_links
         (organization_id, staff_participant_id, user_id, effective_from,
          effective_to, created_by)
       VALUES ($1, $2, 'current-linked-user', $3, $4, 'owner'),
              ($1, $2, 'future-linked-user', $5, NULL, 'owner')`,
      [
        ORG_A,
        PARTICIPANT,
        new Date(now.getTime() - hour),
        new Date(now.getTime() + hour),
        new Date(now.getTime() + 2 * hour),
      ],
    )
  }

  it('resolves a login link only while its effective interval contains now', async () => {
    await insertParticipation(ALEX)
    await pool.query(
      `UPDATE staff_participations SET personal_portal_id = $1 WHERE id = $2`,
      [PORTAL_A, PARTICIPATION],
    )
    await insertResponsibility(PARTICIPATION, PORTAL_A, 'primary', START, null)
    const { rows } = await pool.query<{ now: Date }>('SELECT NOW() AS now')
    const now = new Date(rows[0].now)
    const hour = 60 * 60 * 1_000
    await linkAlex(now)

    await expect(assigned('current-linked-user')).resolves.toEqual([PORTAL_A])
    await expect(assigned('future-linked-user')).resolves.toEqual([])
    await expect(assigned('current-linked-user', ORG_B)).resolves.toEqual([])

    const ambiguousLink = 'db000000-0000-4000-8000-000000000031'
    await pool.query(
      `INSERT INTO staff_user_links
         (id, organization_id, staff_participant_id, user_id, effective_from,
          effective_to, created_by)
       VALUES ($1, $2, $3, 'other-current-linked-user', $4, $5, 'owner')`,
      [
        ambiguousLink,
        ORG_A,
        PARTICIPANT,
        new Date(now.getTime() - hour),
        new Date(now.getTime() + hour),
      ],
    )
    await expect(assigned('current-linked-user')).resolves.toEqual([])
    await pool.query('DELETE FROM staff_user_links WHERE id = $1', [ambiguousLink])

    await pool.query(`UPDATE staff_participations SET started_at = $1 WHERE id = $2`, [
      new Date(now.getTime() + hour / 2),
      PARTICIPATION,
    ])
    await expect(assigned('current-linked-user')).resolves.toEqual([])
    await pool.query(`UPDATE staff_participations SET started_at = $1 WHERE id = $2`, [
      new Date(now.getTime() - hour),
      PARTICIPATION,
    ])
    await expect(assigned('current-linked-user')).resolves.toEqual([PORTAL_A])

    await pool.query(
      `UPDATE staff_participants
       SET status = 'archived', archived_at = NOW(), archive_reason = 'data_repair'
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PARTICIPANT],
    )
    await expect(assigned('current-linked-user')).resolves.toEqual([])
  })

  it('returns only the open primary responsibility for the personal Portal', async () => {
    await insertParticipation(ALEX)
    await pool.query(
      `UPDATE staff_participations SET personal_portal_id = $1 WHERE id = $2`,
      [PORTAL_A, PARTICIPATION],
    )
    await linkAlex(new Date())
    await insertResponsibility(PARTICIPATION, PORTAL_A, 'primary', START, null)
    await insertResponsibility(PARTICIPATION, PORTAL_C, 'supporting', START, null)

    await expect(assigned('current-linked-user')).resolves.toEqual([PORTAL_A])

    await pool.query(
      `UPDATE portal_responsibilities SET effective_to = $1
       WHERE portal_id = $2 AND kind = 'primary'`,
      [CHANGE, PORTAL_A],
    )
    await expect(assigned('current-linked-user')).resolves.toEqual([])
  })

  it('is empty when the participation has no personal Portal', async () => {
    await insertParticipation(ALEX)
    await linkAlex(new Date())
    await insertResponsibility(PARTICIPATION, PORTAL_A, 'primary', START, null)

    await expect(assigned('current-linked-user')).resolves.toEqual([])
  })
})

// The database alone keeps a Portal to one primary at a time. These write
// the table directly, so they hold whatever code writes responsibilities.
describe('portal responsibility constraints', () => {
  beforeEach(async () => {
    await insertParticipation(ALEX)
    await insertParticipation(BLAIR)
  })

  it('refuses a second active primary on the same Portal', async () => {
    await insertResponsibility(PARTICIPATION, PORTAL_A, 'primary', START, null)

    await expect(
      insertResponsibility(SECOND_PARTICIPATION, PORTAL_A, 'primary', CHANGE, null),
    ).rejects.toMatchObject({
      constraint: expect.stringMatching(
        /^pr_(unique_active_primary|no_overlapping_primary_intervals)$/,
      ),
    })
  })

  it('refuses overlapping primary intervals even when both are closed', async () => {
    await insertResponsibility(PARTICIPATION, PORTAL_A, 'primary', START, LATER)

    await expect(
      insertResponsibility(SECOND_PARTICIPATION, PORTAL_A, 'primary', CHANGE, LATER),
    ).rejects.toMatchObject({
      code: '23P01',
      constraint: 'pr_no_overlapping_primary_intervals',
    })
  })

  it('allows the next primary to start where the previous one ended', async () => {
    await insertResponsibility(PARTICIPATION, PORTAL_A, 'primary', START, CHANGE)
    await insertResponsibility(SECOND_PARTICIPATION, PORTAL_A, 'primary', CHANGE, null)

    const open = await pool.query(
      `SELECT staff_participation_id FROM portal_responsibilities
       WHERE organization_id = $1 AND portal_id = $2 AND kind = 'primary'
         AND effective_to IS NULL`,
      [ORG_A, PORTAL_A],
    )
    expect(open.rows).toEqual([{ staff_participation_id: SECOND_PARTICIPATION }])
  })

  it('does not limit supporting responsibilities', async () => {
    await insertResponsibility(PARTICIPATION, PORTAL_A, 'primary', START, null)
    await insertResponsibility(SECOND_PARTICIPATION, PORTAL_A, 'supporting', START, null)

    await expect(
      insertResponsibility(PARTICIPATION, PORTAL_C, 'supporting', START, null),
    ).resolves.toBeDefined()
  })

  it('refuses one participation holding the same Portal and kind twice at once', async () => {
    await insertResponsibility(PARTICIPATION, PORTAL_A, 'supporting', START, null)

    await expect(
      insertResponsibility(PARTICIPATION, PORTAL_A, 'supporting', CHANGE, null),
    ).rejects.toMatchObject({
      code: '23P01',
      constraint: 'pr_no_overlapping_responsibility_intervals',
    })
  })
})
