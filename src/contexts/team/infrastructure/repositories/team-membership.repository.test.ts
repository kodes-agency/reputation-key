import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { organizationId, teamId } from '#/shared/domain/ids'
import { createTeamMembershipRepository } from './team-membership.repository'
import { getDb } from '#/shared/db'

const ORG = organizationId('org-team-membership-integration')
const PROPERTY = 'da000000-0000-4000-8000-000000000001'
const TEAM_A = teamId('da000000-0000-4000-8000-000000000011')
const TEAM_B = teamId('da000000-0000-4000-8000-000000000012')
const PARTICIPATION_A = 'da000000-0000-4000-8000-000000000021'
const PARTICIPATION_B = 'da000000-0000-4000-8000-000000000022'
const START = new Date('2026-08-07T12:00:00.000Z')
const CHANGE = new Date('2026-08-08T12:00:00.000Z')

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Membership Integration', $2, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG, ORG],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Membership Property', 'team-membership-integration', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM team_memberships WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM team_memberships WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [ORG])
  await pool.query(
    `INSERT INTO teams (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $3, $4, 'Team A', NOW(), NOW()),
            ($2, $3, $4, 'Team B', NOW(), NOW())`,
    [TEAM_A, TEAM_B, ORG, PROPERTY],
  )
  await pool.query(
    `INSERT INTO staff_participations
      (id, organization_id, property_id, user_id, display_name, status, started_at, created_by, created_at, updated_at)
     VALUES ($1, $3, $4, 'user-a', 'Alex', 'active', $5, 'owner', NOW(), NOW()),
            ($2, $3, $4, 'user-b', 'Blair', 'active', $5, 'owner', NOW(), NOW())`,
    [PARTICIPATION_A, PARTICIPATION_B, ORG, PROPERTY, START],
  )
})

describe('team membership repository', () => {
  it('adds a member idempotently and rejects an active membership in another team', async () => {
    const repo = createTeamMembershipRepository(getDb())
    const first = await repo.addMember({
      organizationId: ORG,
      teamId: TEAM_A,
      staffParticipationId: PARTICIPATION_A,
      actorId: 'owner',
      at: START,
    })
    const repeated = await repo.addMember({
      organizationId: ORG,
      teamId: TEAM_A,
      staffParticipationId: PARTICIPATION_A,
      actorId: 'owner',
      at: START,
    })
    if (!first.ok) throw new Error(first.code)

    expect(repeated).toEqual({ ok: true, membership: first.membership })
    await expect(
      repo.addMember({
        organizationId: ORG,
        teamId: TEAM_B,
        staffParticipationId: PARTICIPATION_A,
        actorId: 'owner',
        at: CHANGE,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'already_on_another_team' })
  })

  it('replaces the lead atomically while preserving membership intervals', async () => {
    const repo = createTeamMembershipRepository(getDb())
    await repo.addMember({
      organizationId: ORG,
      teamId: TEAM_A,
      staffParticipationId: PARTICIPATION_A,
      actorId: 'owner',
      at: START,
    })
    await repo.setLead({
      organizationId: ORG,
      teamId: TEAM_A,
      staffParticipationId: PARTICIPATION_A,
      actorId: 'owner',
      at: START,
    })
    await repo.addMember({
      organizationId: ORG,
      teamId: TEAM_A,
      staffParticipationId: PARTICIPATION_B,
      actorId: 'owner',
      at: START,
    })
    const replacement = await repo.setLead({
      organizationId: ORG,
      teamId: TEAM_A,
      staffParticipationId: PARTICIPATION_B,
      actorId: 'owner',
      at: CHANGE,
    })

    expect(replacement.ok).toBe(true)
    const views = await repo.listByTeam(ORG, TEAM_A)
    expect(views.filter((row) => row.role === 'lead')).toHaveLength(1)
    expect(views.find((row) => row.role === 'lead')?.staffParticipationId).toBe(
      PARTICIPATION_B,
    )

    const history = await pool.query(
      `SELECT staff_participation_id, effective_from, effective_to
       FROM team_memberships
       WHERE organization_id = $1 AND team_id = $2
       ORDER BY effective_from`,
      [ORG, TEAM_A],
    )
    expect(history.rows).toHaveLength(4)
    expect(history.rows.filter((row) => row.effective_to === null)).toHaveLength(2)
    expect(
      history.rows.filter(
        (row) =>
          row.staff_participation_id === PARTICIPATION_A && row.effective_to !== null,
      ),
    ).toHaveLength(1)
    expect(
      history.rows.filter(
        (row) =>
          row.staff_participation_id === PARTICIPATION_B && row.effective_to !== null,
      ),
    ).toHaveLength(1)
  })

  it('closes every active membership at the archive boundary', async () => {
    const repo = createTeamMembershipRepository(getDb())
    await repo.addMember({
      organizationId: ORG,
      teamId: TEAM_A,
      staffParticipationId: PARTICIPATION_A,
      actorId: 'owner',
      at: START,
    })

    await expect(repo.closeForTeam(ORG, TEAM_A, CHANGE, 'team_archived')).resolves.toBe(1)
    await expect(repo.listByTeam(ORG, TEAM_A)).resolves.toEqual([])
    const row = await pool.query(
      `SELECT effective_to, end_reason FROM team_memberships WHERE team_id = $1`,
      [TEAM_A],
    )
    expect(new Date(row.rows[0].effective_to)).toEqual(CHANGE)
    expect(row.rows[0].end_reason).toBe('team_archived')
  })
})
