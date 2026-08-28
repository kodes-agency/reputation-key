import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createStaffParticipationRepository } from './staff-participation.repository'

const ORG_A = 'org-staff-participation-a'
const ORG_B = 'org-staff-participation-b'
const PROPERTY_A = 'db000000-0000-4000-8000-000000000001'
const PROPERTY_B = 'db000000-0000-4000-8000-000000000002'
const PARTICIPATION = 'db000000-0000-4000-8000-000000000011'
const PARTICIPANT = 'db000000-0000-4000-8000-000000000010'
const RETAINED_TEAM = 'db000000-0000-4000-8000-000000000012'
const RETAINED_MEMBERSHIP = 'db000000-0000-4000-8000-000000000013'
const PORTAL_A = 'db000000-0000-4000-8000-000000000021'
const PORTAL_B = 'db000000-0000-4000-8000-000000000022'
const PORTAL_C = 'db000000-0000-4000-8000-000000000023'
const START = new Date('2026-08-07T12:00:00.000Z')
const CHANGE = new Date('2026-08-08T12:00:00.000Z')

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
  await pool.query('DELETE FROM team_memberships WHERE organization_id = $1', [ORG_A])
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
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [ORG_A])
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
  await pool.query('DELETE FROM team_memberships WHERE organization_id = $1', [ORG_A])
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
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [ORG_A])
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

const participation = () => ({
  id: PARTICIPATION,
  organizationId: ORG_A,
  propertyId: PROPERTY_A,
  staffParticipantId: PARTICIPANT,
  linkedUserId: null,
  displayName: 'Alex',
  status: 'active' as const,
  startedAt: START,
  endedAt: null,
  archiveReason: null,
  revision: 1,
  createdBy: 'owner',
  updatedAt: START,
})

const participant = () => ({
  id: PARTICIPANT,
  organizationId: ORG_A,
  displayName: 'Alex',
  status: 'active' as const,
  archivedAt: null,
  archiveReason: null,
  revision: 1,
  createdBy: 'owner',
  createdAt: START,
  updatedAt: START,
})

const createFixture = (repo: ReturnType<typeof createStaffParticipationRepository>) =>
  repo.createParticipantWithParticipation({
    participant: participant(),
    participation: participation(),
  })

describe('staff participation repository', () => {
  it('creates a participant without a login and isolates tenant reads', async () => {
    const repo = createStaffParticipationRepository(getDb())
    const first = await createFixture(repo)

    expect(first.linkedUserId).toBeNull()
    await expect(repo.findById(ORG_B, first.id)).resolves.toBeNull()
    await expect(repo.list(ORG_A, { activeOnly: true })).resolves.toHaveLength(1)
  })

  it('resolves a login link only while its effective interval contains now', async () => {
    const repo = createStaffParticipationRepository(getDb())
    await createFixture(repo)
    const { rows } = await pool.query<{ now: Date }>('SELECT NOW() AS now')
    const now = new Date(rows[0].now)
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

    await expect(repo.findById(ORG_A, PARTICIPATION)).resolves.toMatchObject({
      linkedUserId: 'current-linked-user',
    })
    await expect(
      repo.findActiveByUser(ORG_A, PROPERTY_A, 'current-linked-user'),
    ).resolves.toMatchObject({ id: PARTICIPATION })
    await expect(
      repo.findActiveByUser(ORG_A, PROPERTY_A, 'future-linked-user'),
    ).resolves.toBeNull()

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
    await expect(
      repo.findActiveByUser(ORG_A, PROPERTY_A, 'current-linked-user'),
    ).resolves.toBeNull()
    await expect(repo.findById(ORG_A, PARTICIPATION)).resolves.toMatchObject({
      linkedUserId: null,
    })
    await pool.query('DELETE FROM staff_user_links WHERE id = $1', [ambiguousLink])

    await pool.query(`UPDATE staff_participations SET started_at = $1 WHERE id = $2`, [
      new Date(now.getTime() + hour / 2),
      PARTICIPATION,
    ])
    await expect(
      repo.findActiveByUser(ORG_A, PROPERTY_A, 'current-linked-user'),
    ).resolves.toBeNull()
    await expect(repo.list(ORG_A, { activeOnly: true })).resolves.toEqual([])
    await pool.query(`UPDATE staff_participations SET started_at = $1 WHERE id = $2`, [
      new Date(now.getTime() - hour),
      PARTICIPATION,
    ])

    await pool.query(
      `UPDATE staff_participants
       SET status = 'archived', archived_at = NOW(), archive_reason = 'data_repair'
       WHERE organization_id = $1 AND id = $2`,
      [ORG_A, PARTICIPANT],
    )
    await expect(
      repo.findActiveByUser(ORG_A, PROPERTY_A, 'current-linked-user'),
    ).resolves.toBeNull()
    await expect(repo.list(ORG_A, { activeOnly: true })).resolves.toEqual([])
  })

  it('persists an idempotent responsibility set and rejects a cross-property portal', async () => {
    const repo = createStaffParticipationRepository(getDb())
    await createFixture(repo)
    const input = {
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [{ portalId: PORTAL_A, kind: 'primary' as const }],
      actorId: 'owner',
      at: START,
      expectedRevision: 1,
    }
    const first = await repo.replaceResponsibilities(input)
    const repeated = await repo.replaceResponsibilities({
      ...input,
      expectedRevision: first.revision,
    })

    expect(repeated).toEqual(first)
    await expect(
      repo.replaceResponsibilities({
        ...input,
        selections: [{ portalId: PORTAL_B, kind: 'primary' }],
        at: CHANGE,
        expectedRevision: repeated.revision,
      }),
    ).rejects.toMatchObject({ _tag: 'StaffError', code: 'invalid_input' })
    await expect(repo.listActiveResponsibilities(ORG_A, PARTICIPATION)).resolves.toEqual(
      first.responsibilities,
    )
  })

  it('preserves unchanged responsibility intervals during a partial edit', async () => {
    const repo = createStaffParticipationRepository(getDb())
    await createFixture(repo)
    const initial = await repo.replaceResponsibilities({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [{ portalId: PORTAL_A, kind: 'primary' }],
      actorId: 'owner',
      at: START,
      expectedRevision: 1,
    })
    const [original] = initial.responsibilities

    const changed = await repo.replaceResponsibilities({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [
        { portalId: PORTAL_A, kind: 'primary' },
        { portalId: PORTAL_C, kind: 'supporting' },
      ],
      actorId: 'manager',
      at: CHANGE,
      expectedRevision: initial.revision,
    })

    expect(
      changed.responsibilities.find((row) => row.portalId === PORTAL_A),
    ).toMatchObject({
      id: original.id,
      effectiveFrom: START,
      createdBy: 'owner',
    })
    expect(
      changed.responsibilities.find((row) => row.portalId === PORTAL_C),
    ).toMatchObject({
      effectiveFrom: CHANGE,
      createdBy: 'manager',
    })

    const unchangedHistory = await pool.query(
      `SELECT effective_from, effective_to
       FROM portal_responsibilities
       WHERE staff_participation_id = $1 AND portal_id = $2`,
      [PARTICIPATION, PORTAL_A],
    )
    expect(unchangedHistory.rows).toHaveLength(1)
    expect(new Date(unchangedHistory.rows[0].effective_from)).toEqual(START)
    expect(unchangedHistory.rows[0].effective_to).toBeNull()
  })

  it('rejects stale responsibility and archive commands without partial changes', async () => {
    const repo = createStaffParticipationRepository(getDb())
    await createFixture(repo)
    const updated = await repo.replaceResponsibilities({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [{ portalId: PORTAL_A, kind: 'primary' }],
      actorId: 'owner',
      at: START,
      expectedRevision: 1,
    })
    expect(updated.revision).toBe(2)

    await expect(
      repo.replaceResponsibilities({
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        staffParticipationId: PARTICIPATION,
        selections: [{ portalId: PORTAL_C, kind: 'primary' }],
        actorId: 'manager',
        at: CHANGE,
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ _tag: 'StaffError', code: 'revision_conflict' })
    await expect(
      repo.archive(ORG_A, PARTICIPATION, CHANGE, 'left_property', 1),
    ).rejects.toMatchObject({ _tag: 'StaffError', code: 'revision_conflict' })

    await expect(repo.findById(ORG_A, PARTICIPATION)).resolves.toMatchObject({
      status: 'active',
      revision: 2,
    })
    await expect(repo.listActiveResponsibilities(ORG_A, PARTICIPATION)).resolves.toEqual([
      expect.objectContaining({ portalId: PORTAL_A, kind: 'primary' }),
    ])
  })

  it('archives participation and closes responsibility history transactionally', async () => {
    const repo = createStaffParticipationRepository(getDb())
    await createFixture(repo)
    await pool.query(
      `INSERT INTO teams
         (id, organization_id, property_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Retained Team', $4, $4)`,
      [RETAINED_TEAM, ORG_A, PROPERTY_A, START],
    )
    await pool.query(
      `INSERT INTO team_memberships
         (id, organization_id, property_id, team_id, staff_participation_id,
          role, effective_from, created_by)
       VALUES ($1, $2, $3, $4, $5, 'member', $6, 'legacy-import')`,
      [RETAINED_MEMBERSHIP, ORG_A, PROPERTY_A, RETAINED_TEAM, PARTICIPATION, START],
    )
    await repo.replaceResponsibilities({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      staffParticipationId: PARTICIPATION,
      selections: [{ portalId: PORTAL_A, kind: 'primary' }],
      actorId: 'owner',
      at: START,
      expectedRevision: 1,
    })

    const archived = await repo.archive(ORG_A, PARTICIPATION, CHANGE, 'left_property', 2)

    expect(archived).toMatchObject({
      status: 'archived',
      endedAt: CHANGE,
      archiveReason: 'left_property',
      revision: 3,
    })
    await expect(repo.listActiveResponsibilities(ORG_A, PARTICIPATION)).resolves.toEqual(
      [],
    )
    const history = await pool.query(
      `SELECT effective_to, end_reason FROM portal_responsibilities WHERE staff_participation_id = $1`,
      [PARTICIPATION],
    )
    expect(new Date(history.rows[0].effective_to)).toEqual(CHANGE)
    expect(history.rows[0].end_reason).toBe('participation_archived')
    const retainedMembership = await pool.query(
      `SELECT effective_to, end_reason
       FROM team_memberships
       WHERE id = $1`,
      [RETAINED_MEMBERSHIP],
    )
    expect(retainedMembership.rows).toEqual([{ effective_to: null, end_reason: null }])
  })
})
