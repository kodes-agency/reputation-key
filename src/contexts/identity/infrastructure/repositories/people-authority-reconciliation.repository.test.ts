import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { withLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { buildPeopleAuthorityReconciliationReportFromDatabase } from './people-authority-reconciliation.repository'

const ORG = 'org-people-authority-report'
const PROPERTY = 'ed000000-0000-4000-8000-000000000001'
const PORTAL = 'ed000000-0000-4000-8000-000000000002'
const TEAM = 'ed000000-0000-4000-8000-000000000003'
const PARTICIPANT = 'ed000000-0000-4000-8000-000000000004'
const PARTICIPATION = 'ed000000-0000-4000-8000-000000000005'
const EXACT_ASSIGNMENT = 'ed000000-0000-4000-8000-000000000006'
const MAPPABLE_ASSIGNMENT = 'ed000000-0000-4000-8000-000000000007'
const ORPHAN_ASSIGNMENT = 'ed000000-0000-4000-8000-000000000008'
const RESPONSIBILITY = 'ed000000-0000-4000-8000-000000000009'
const TEAM_MEMBERSHIP = 'ed000000-0000-4000-8000-000000000010'
const OLD_GRANT_MAPPABLE = 'ed000000-0000-4000-8000-000000000011'
const OLD_GRANT_UNSAFE = 'ed000000-0000-4000-8000-000000000012'
const PORTAL_MANAGER_OWNER = 'ed000000-0000-4000-8000-000000000013'
const PORTAL_MANAGER_INELIGIBLE = 'ed000000-0000-4000-8000-000000000014'
const PORTAL_MANAGER_PROPERTY = 'ed000000-0000-4000-8000-000000000015'
const PROPERTY_MANAGER_OWNER = 'ed000000-0000-4000-8000-000000000016'
const PROPERTY_MANAGER_PROPERTY = 'ed000000-0000-4000-8000-000000000017'
const PROPERTY_MANAGER_INELIGIBLE = 'ed000000-0000-4000-8000-000000000018'
const PORTAL_MANAGER_NO_CANONICAL_GRANT = 'ed000000-0000-4000-8000-000000000019'
const PORTAL_MANAGER_STAFF_ROLE = 'ed000000-0000-4000-8000-000000000020'
const LOGIN_FREE_PARTICIPANT = 'ed000000-0000-4000-8000-000000000021'
const ARCHIVED_PARTICIPANT = 'ed000000-0000-4000-8000-000000000022'
const INVALID_ACTIVE_PARTICIPATION = 'ed000000-0000-4000-8000-000000000023'
const AMBIGUOUS_LINK_PARTICIPANT = 'ed000000-0000-4000-8000-000000000024'
const AMBIGUOUS_LINK_A = 'ed000000-0000-4000-8000-000000000025'
const AMBIGUOUS_LINK_B = 'ed000000-0000-4000-8000-000000000026'
const ARCHIVED_PARTICIPANT_ASSIGNMENT = 'ed000000-0000-4000-8000-000000000027'
const AMBIGUOUS_LINK_PARTICIPATION = 'ed000000-0000-4000-8000-000000000028'
const PORTAL_MANAGER_AMBIGUOUS_LINK = 'ed000000-0000-4000-8000-000000000029'
const NOW = new Date('2026-08-26T08:00:00.000Z')
const TOMORROW = new Date('2026-08-27T08:00:00.000Z')

const USERS = {
  exact: 'people-report-exact',
  mappable: 'people-report-mappable',
  owner: 'people-report-owner',
  ineligible: 'people-report-ineligible',
  staff: 'people-report-staff',
  ambiguous: 'people-report-ambiguous',
} as const

let pool: Pool

async function clearFixture(): Promise<void> {
  for (const table of [
    'portal_responsible_managers',
    'property_responsible_managers',
    'portal_responsibilities',
    'team_memberships',
    'staff_assignments',
    'property_access_grants',
    'property_access_grant',
    'staff_participations',
    'staff_user_links',
    'staff_participants',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [ORG])
  }
}

const clearMembers = () =>
  withLastOwnerGuardDisabled(pool, async (client) => {
    await client.query('DELETE FROM member WHERE "organizationId" = $1', [ORG])
  })

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'People authority report', $1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [ORG, NOW],
  )
  for (const [index, userId] of Object.values(USERS).entries()) {
    await pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, $3, $3) ON CONFLICT (id) DO NOTHING`,
      [userId, `people-report-${index}@example.com`, NOW],
    )
  }
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Report Property', 'people-authority-report', 'UTC', $3, $3)
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG, NOW],
  )
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        created_by, created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Report Portal',
             'people-authority-report', $4, $5, $5)
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL, ORG, PROPERTY, USERS.owner, NOW],
  )
  await pool.query(
    `INSERT INTO teams
       (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Quarantined report data', $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [TEAM, ORG, PROPERTY, NOW],
  )
})

afterAll(async () => {
  await clearFixture()
  await pool.query('DELETE FROM teams WHERE id = $1', [TEAM])
  await pool.query('DELETE FROM portals WHERE id = $1', [PORTAL])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await clearMembers()
  await pool.query('DELETE FROM "user" WHERE id = ANY($1)', [Object.values(USERS)])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
  await pool.end()
})

beforeEach(async () => {
  await clearFixture()
  await clearMembers()
  const roles = [
    [USERS.exact, 'admin'],
    [USERS.mappable, 'admin'],
    [USERS.owner, 'owner'],
    [USERS.ineligible, 'admin'],
    [USERS.staff, 'member'],
    [USERS.ambiguous, 'admin'],
  ] as const
  for (const [index, [userId, role]] of roles.entries()) {
    await pool.query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [`people-report-member-${index}`, userId, ORG, role, NOW],
    )
  }

  await pool.query(
    `INSERT INTO staff_participants
       (id, organization_id, display_name, status, archived_at, archive_reason,
        revision, created_by, created_at, updated_at)
     VALUES ($1, $5, 'Exact person', 'active', NULL, NULL, 1, $6, $7, $7),
            ($2, $5, 'Login-free person', 'active', NULL, NULL, 1, $6, $7, $7),
            ($3, $5, 'Archived person', 'archived', $7, 'left', 1, $6, $7, $7),
            ($4, $5, 'Ambiguous link person', 'active', NULL, NULL, 1, $6, $7, $7)`,
    [
      PARTICIPANT,
      LOGIN_FREE_PARTICIPANT,
      ARCHIVED_PARTICIPANT,
      AMBIGUOUS_LINK_PARTICIPANT,
      ORG,
      USERS.owner,
      NOW,
    ],
  )
  await pool.query(
    `INSERT INTO staff_user_links
       (organization_id, staff_participant_id, user_id, effective_from, created_by)
     VALUES ($1, $2, $4, $5, $6),
            ($1, $3, $7, $5, $6)`,
    [
      ORG,
      PARTICIPANT,
      ARCHIVED_PARTICIPANT,
      USERS.exact,
      NOW,
      USERS.owner,
      USERS.ineligible,
    ],
  )
  await pool.query(
    `INSERT INTO staff_user_links
       (id, organization_id, staff_participant_id, user_id, effective_from,
        effective_to, created_by)
     VALUES ($1, $3, $4, $5, $7, $8, $9),
            ($2, $3, $4, $6, $7, $8, $9)`,
    [
      AMBIGUOUS_LINK_A,
      AMBIGUOUS_LINK_B,
      ORG,
      AMBIGUOUS_LINK_PARTICIPANT,
      USERS.ambiguous,
      USERS.staff,
      NOW,
      TOMORROW,
      USERS.owner,
    ],
  )
  await pool.query(
    `INSERT INTO staff_participations
       (id, organization_id, property_id, staff_participant_id, user_id,
        display_name, status, started_at, revision, created_by, created_at, updated_at)
     VALUES ($1, $4, $5, $6, NULL, 'Exact person', 'active', $8, 1, $9, $8, $8),
            ($2, $4, $5, $7, NULL, 'Archived person', 'active', $8, 1, $9, $8, $8),
            ($3, $4, $5, $10, NULL, 'Ambiguous link person', 'active', $8, 1, $9, $8, $8)`,
    [
      PARTICIPATION,
      INVALID_ACTIVE_PARTICIPATION,
      AMBIGUOUS_LINK_PARTICIPATION,
      ORG,
      PROPERTY,
      PARTICIPANT,
      ARCHIVED_PARTICIPANT,
      NOW,
      USERS.owner,
      AMBIGUOUS_LINK_PARTICIPANT,
    ],
  )
  await pool.query(
    `INSERT INTO portal_responsibilities
       (id, organization_id, property_id, portal_id, staff_participation_id,
        kind, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'primary', $6, $7)`,
    [RESPONSIBILITY, ORG, PROPERTY, PORTAL, PARTICIPATION, NOW, USERS.owner],
  )
  await pool.query(
    `INSERT INTO staff_assignments
       (id, organization_id, user_id, property_id, portal_id, created_at, updated_at)
     VALUES ($1, $4, $5, $6, $7, $8, $8),
            ($2, $4, $9, $6, NULL, $8, $8),
            ($3, $4, 'missing-people-report-user', $6, NULL, $8, $8),
            ($10, $4, $11, $6, NULL, $8, $8)`,
    [
      EXACT_ASSIGNMENT,
      MAPPABLE_ASSIGNMENT,
      ORPHAN_ASSIGNMENT,
      ORG,
      USERS.exact,
      PROPERTY,
      PORTAL,
      NOW,
      USERS.mappable,
      ARCHIVED_PARTICIPANT_ASSIGNMENT,
      USERS.ineligible,
    ],
  )
  await pool.query(
    `INSERT INTO team_memberships
       (id, organization_id, property_id, team_id, staff_participation_id,
        role, effective_from, created_by)
     VALUES ($1, $2, $3, $4, $5, 'member', $6, $7)`,
    [TEAM_MEMBERSHIP, ORG, PROPERTY, TEAM, PARTICIPATION, NOW, USERS.owner],
  )
  await pool.query(
    `INSERT INTO property_access_grants
       (id, organization_id, property_id, user_id, kind, status, granted_at, granted_by)
     VALUES ($1, $3, $4, $5, 'manage', 'active', $6, $7),
            ($2, $3, $4, $8, 'view', 'active', $6, $7)`,
    [
      OLD_GRANT_MAPPABLE,
      OLD_GRANT_UNSAFE,
      ORG,
      PROPERTY,
      USERS.mappable,
      NOW,
      USERS.owner,
      USERS.staff,
    ],
  )
  await pool.query(
    `INSERT INTO property_access_grant
       (organization_id, property_id, user_id, source, created_by, created_at)
     VALUES ($1, $2, $3, 'operator', $5, $6),
            ($1, $2, $4, 'operator', $5, $6),
            ($1, $2, $7, 'operator', $5, $6)`,
    [ORG, PROPERTY, USERS.exact, USERS.ineligible, USERS.owner, NOW, USERS.ambiguous],
  )
  await pool.query(
    `INSERT INTO portal_responsible_managers
       (id, organization_id, property_id, portal_id, user_id,
        effective_from, created_by)
     VALUES ($1, $3, $4, $5, $6, $8, $6),
            ($2, $3, $4, $5, $7, $8, $6),
            ($9, $3, $4, $5, $10, $8, $6)`,
    [
      PORTAL_MANAGER_OWNER,
      PORTAL_MANAGER_INELIGIBLE,
      ORG,
      PROPERTY,
      PORTAL,
      USERS.owner,
      USERS.ineligible,
      NOW,
      PORTAL_MANAGER_PROPERTY,
      USERS.exact,
    ],
  )
  await pool.query(
    `INSERT INTO property_responsible_managers
       (id, organization_id, property_id, user_id, effective_from, created_by)
     VALUES ($1, $4, $5, $6, $9, $6),
            ($2, $4, $5, $7, $9, $6),
            ($3, $4, $5, $8, $9, $6)`,
    [
      PROPERTY_MANAGER_OWNER,
      PROPERTY_MANAGER_PROPERTY,
      PROPERTY_MANAGER_INELIGIBLE,
      ORG,
      PROPERTY,
      USERS.owner,
      USERS.exact,
      USERS.ineligible,
      NOW,
    ],
  )
  await pool.query(
    `INSERT INTO portal_responsible_managers
       (id, organization_id, property_id, portal_id, user_id,
        effective_from, created_by)
     VALUES ($1, $4, $5, $6, $7, $9, $10),
            ($2, $4, $5, $6, $8, $9, $10),
            ($3, $4, $5, $6, $11, $9, $10)`,
    [
      PORTAL_MANAGER_NO_CANONICAL_GRANT,
      PORTAL_MANAGER_STAFF_ROLE,
      PORTAL_MANAGER_AMBIGUOUS_LINK,
      ORG,
      PROPERTY,
      PORTAL,
      USERS.mappable,
      USERS.staff,
      NOW,
      USERS.owner,
      USERS.ambiguous,
    ],
  )
})

describe('people authority reconciliation repository', () => {
  it('classifies every authority independently and produces a stable read-only report', async () => {
    const input = { organizationIds: [ORG], asOf: NOW }
    const first = await buildPeopleAuthorityReconciliationReportFromDatabase(
      getDb(),
      input,
    )
    const second = await buildPeopleAuthorityReconciliationReportFromDatabase(
      getDb(),
      input,
    )
    expect(second).toEqual(first)

    const classification = (sourceId: string, dimension: string) =>
      first.rows.find((row) => row.sourceId === sourceId && row.dimension === dimension)

    expect(classification(EXACT_ASSIGNMENT, 'participant_mapping')?.outcome).toBe('exact')
    expect(classification(EXACT_ASSIGNMENT, 'staff_attribution_mapping')).toMatchObject({
      outcome: 'conflict',
      reasonCode: 'legacy_attribution_is_primary',
    })
    expect(classification(MAPPABLE_ASSIGNMENT, 'participant_mapping')?.outcome).toBe(
      'mappable',
    )
    expect(classification(ORPHAN_ASSIGNMENT, 'participant_mapping')?.outcome).toBe(
      'orphan',
    )
    expect(
      classification(ARCHIVED_PARTICIPANT_ASSIGNMENT, 'participant_mapping'),
    ).toMatchObject({
      outcome: 'mappable',
      reasonCode: 'participant_and_participation_can_be_created',
    })
    expect(classification(LOGIN_FREE_PARTICIPANT, 'participant_integrity')).toMatchObject(
      {
        outcome: 'exact',
        userId: null,
        reasonCode: 'participant_profile_valid_without_login',
      },
    )
    expect(classification(AMBIGUOUS_LINK_A, 'login_link_integrity')).toMatchObject({
      outcome: 'conflict',
      reasonCode: 'multiple_current_links_for_participant',
    })
    expect(classification(AMBIGUOUS_LINK_B, 'login_link_integrity')).toMatchObject({
      outcome: 'conflict',
      reasonCode: 'multiple_current_links_for_participant',
    })
    expect(
      first.rows.find(
        (row) => row.source === 'staff_user_link' && row.userId === USERS.ineligible,
      ),
    ).toMatchObject({
      outcome: 'conflict',
      reasonCode: 'current_link_has_archived_participant',
    })
    expect(classification(TEAM_MEMBERSHIP, 'team_quarantine')?.outcome).toBe('unsafe')
    expect(classification(OLD_GRANT_MAPPABLE, 'access_mapping')?.outcome).toBe('mappable')
    expect(classification(OLD_GRANT_UNSAFE, 'access_mapping')).toMatchObject({
      outcome: 'unsafe',
      reasonCode: 'staff_user_access_is_deferred',
    })
    expect(
      classification('people-report-member-4', 'membership_eligibility'),
    ).toMatchObject({
      outcome: 'unsafe',
      reasonCode: 'staff_user_login_is_deferred',
    })
    expect(classification(PORTAL_MANAGER_OWNER, 'manager_eligibility')?.outcome).toBe(
      'exact',
    )
    expect(classification(PORTAL_MANAGER_PROPERTY, 'manager_eligibility')).toMatchObject({
      outcome: 'exact',
      reasonCode: 'property_manager_assignment_valid',
    })
    expect(
      classification(PORTAL_MANAGER_INELIGIBLE, 'manager_eligibility'),
    ).toMatchObject({
      outcome: 'unsafe',
      reasonCode: 'property_manager_missing_active_participation',
    })
    expect(
      classification(PORTAL_MANAGER_NO_CANONICAL_GRANT, 'manager_eligibility'),
    ).toMatchObject({
      outcome: 'unsafe',
      reasonCode: 'property_manager_missing_active_access_grant',
    })
    expect(
      classification(PORTAL_MANAGER_STAFF_ROLE, 'manager_eligibility'),
    ).toMatchObject({
      outcome: 'unsafe',
      reasonCode: 'manager_role_is_not_beta_eligible',
    })
    expect(
      classification(PORTAL_MANAGER_AMBIGUOUS_LINK, 'manager_eligibility'),
    ).toMatchObject({
      outcome: 'unsafe',
      reasonCode: 'property_manager_missing_active_participation',
    })
    expect(classification(PROPERTY_MANAGER_OWNER, 'manager_eligibility')).toMatchObject({
      source: 'property_responsible_manager',
      outcome: 'exact',
      reasonCode: 'account_admin_manager_assignment_valid',
    })
    expect(
      classification(PROPERTY_MANAGER_PROPERTY, 'manager_eligibility'),
    ).toMatchObject({
      source: 'property_responsible_manager',
      outcome: 'exact',
      reasonCode: 'property_manager_assignment_valid',
    })
    expect(
      classification(PROPERTY_MANAGER_INELIGIBLE, 'manager_eligibility'),
    ).toMatchObject({
      source: 'property_responsible_manager',
      outcome: 'unsafe',
      reasonCode: 'property_manager_missing_active_participation',
    })
    expect(first.counts.total).toBe(first.rows.length)

    const stillPresent = await pool.query(
      'SELECT id FROM staff_assignments WHERE organization_id = $1 ORDER BY id',
      [ORG],
    )
    expect(stillPresent.rows).toHaveLength(4)

    await pool.query('UPDATE properties SET deleted_at = $1 WHERE id = $2', [
      NOW,
      PROPERTY,
    ])
    try {
      const inactive = await buildPeopleAuthorityReconciliationReportFromDatabase(
        getDb(),
        input,
      )
      expect(
        inactive.rows.find(
          (row) => row.source === 'staff_participation' && row.sourceId === PARTICIPATION,
        ),
      ).toMatchObject({
        outcome: 'orphan',
        reasonCode: 'participation_property_missing_or_inactive',
      })
      expect(
        inactive.rows.find(
          (row) => row.source === 'property_access_grant' && row.userId === USERS.exact,
        ),
      ).toMatchObject({
        outcome: 'orphan',
        reasonCode: 'canonical_access_property_missing_or_inactive',
      })
      expect(
        inactive.rows.find(
          (row) =>
            row.source === 'portal_responsible_manager' &&
            row.sourceId === PORTAL_MANAGER_OWNER,
        ),
      ).toMatchObject({ outcome: 'orphan', reasonCode: 'manager_parent_missing' })
    } finally {
      await pool.query('UPDATE properties SET deleted_at = NULL WHERE id = $1', [
        PROPERTY,
      ])
    }
  })
})
