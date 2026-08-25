import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = 'org-staff-participant-constraints-a'
const ORG_B = 'org-staff-participant-constraints-b'
const PROPERTY_A = 'afc00000-0000-4000-8000-000000000001'
const PROPERTY_B = 'afc00000-0000-4000-8000-000000000002'
const PARTICIPANT_A = 'ac000000-0000-4000-8000-000000000011'
const PARTICIPANT_B = 'ac000000-0000-4000-8000-000000000012'
const PARTICIPATION_A = 'ac000000-0000-4000-8000-000000000021'
const USER = 'user-staff-participant-constraints'

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  for (const org of [ORG_A, ORG_B]) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $1, $1, NOW()) ON CONFLICT (id) DO NOTHING`,
      [org],
    )
  }
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $3, 'Participant Property A', 'participant-constraints-a', 'UTC', NOW(), NOW()),
            ($2, $4, 'Participant Property B', 'participant-constraints-b', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY_A, PROPERTY_B, ORG_A, ORG_B],
  )
})

afterAll(async () => {
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
  await pool.query('DELETE FROM properties WHERE id IN ($1, $2)', [
    PROPERTY_A,
    PROPERTY_B,
  ])
  await pool.query('DELETE FROM organization WHERE id IN ($1, $2)', [ORG_A, ORG_B])
  await pool.end()
})

beforeEach(async () => {
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
  await pool.query(
    `INSERT INTO staff_participants
       (id, organization_id, display_name, status, revision, created_by,
        created_at, updated_at)
     VALUES ($1, $3, 'No Login Participant', 'active', 1, 'manager', NOW(), NOW()),
            ($2, $4, 'Other Tenant Participant', 'active', 1, 'manager', NOW(), NOW())`,
    [PARTICIPANT_A, PARTICIPANT_B, ORG_A, ORG_B],
  )
})

describe('StaffParticipant database authority', () => {
  it('supports a participant and Property participation without a login user', async () => {
    await pool.query(
      `INSERT INTO staff_participations
         (id, organization_id, property_id, staff_participant_id, user_id,
          display_name, status, started_at, revision, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, 'No Login Participant', 'active', NOW(), 1,
               'manager', NOW(), NOW())`,
      [PARTICIPATION_A, ORG_A, PROPERTY_A, PARTICIPANT_A],
    )

    const row = await pool.query(
      `SELECT staff_participant_id, user_id, revision
       FROM staff_participations WHERE id = $1`,
      [PARTICIPATION_A],
    )
    expect(row.rows).toEqual([
      { staff_participant_id: PARTICIPANT_A, user_id: null, revision: 1 },
    ])
  })

  it('enforces one active participation per participant and Property', async () => {
    await pool.query(
      `INSERT INTO staff_participations
         (id, organization_id, property_id, staff_participant_id, user_id,
          display_name, status, started_at, revision, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, 'No Login Participant', 'active', NOW(), 1,
               'manager', NOW(), NOW())`,
      [PARTICIPATION_A, ORG_A, PROPERTY_A, PARTICIPANT_A],
    )

    await expect(
      pool.query(
        `INSERT INTO staff_participations
           (organization_id, property_id, staff_participant_id, user_id,
            display_name, status, started_at, revision, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, 'Duplicate', 'active', NOW(), 1,
                 'manager', NOW(), NOW())`,
        [ORG_A, PROPERTY_A, PARTICIPANT_A],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('rejects cross-tenant participation and duplicate active login links', async () => {
    await expect(
      pool.query(
        `INSERT INTO staff_participations
           (organization_id, property_id, staff_participant_id, user_id,
            display_name, status, started_at, revision, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, NULL, 'Wrong Tenant', 'active', NOW(), 1,
                 'manager', NOW(), NOW())`,
        [ORG_A, PROPERTY_A, PARTICIPANT_B],
      ),
    ).rejects.toMatchObject({ code: '23503' })

    await pool.query(
      `INSERT INTO staff_user_links
         (organization_id, staff_participant_id, user_id, effective_from, created_by)
       VALUES ($1, $2, $3, NOW(), 'manager')`,
      [ORG_A, PARTICIPANT_A, USER],
    )
    await pool.query(
      `INSERT INTO staff_participants
         (organization_id, display_name, status, revision, created_by, created_at, updated_at)
       VALUES ($1, 'Second Participant', 'active', 1, 'manager', NOW(), NOW())`,
      [ORG_A],
    )
    const second = await pool.query<{ id: string }>(
      `SELECT id FROM staff_participants
       WHERE organization_id = $1 AND display_name = 'Second Participant'`,
      [ORG_A],
    )
    await expect(
      pool.query(
        `INSERT INTO staff_user_links
           (organization_id, staff_participant_id, user_id, effective_from, created_by)
         VALUES ($1, $2, $3, NOW(), 'manager')`,
        [ORG_A, second.rows[0]!.id, USER],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('requires an archive reason and a positive revision', async () => {
    await expect(
      pool.query(
        `INSERT INTO staff_participants
           (organization_id, display_name, status, archived_at, archive_reason,
            revision, created_by, created_at, updated_at)
         VALUES ($1, 'Broken Archive', 'archived', NOW(), NULL, 1,
                 'manager', NOW(), NOW())`,
        [ORG_A],
      ),
    ).rejects.toMatchObject({ code: '23514' })

    await expect(
      pool.query(`UPDATE staff_participants SET revision = 0 WHERE id = $1`, [
        PARTICIPANT_A,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})
