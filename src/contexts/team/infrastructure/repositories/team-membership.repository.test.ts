import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { organizationId, teamId } from '#/shared/domain/ids'
import { createTeamMembershipRepository } from './team-membership.repository'
import { getDb } from '#/shared/db'

const ORG = organizationId('org-team-membership-integration')
// A second, fully populated tenant. Every read and command below is
// tenant-scoped, and the scoping lives ONLY in the repository's
// `organizationId` conjuncts — team ids and participation ids are not
// tenant-qualified on their own, so a dropped conjunct silently serves one
// tenant another tenant's roster.
const ORG_OTHER = organizationId('org-team-membership-other-tenant')
const PROPERTY = 'da000000-0000-4000-8000-000000000001'
const PROPERTY_OTHER = 'da000000-0000-4000-8000-000000000002'
const TEAM_A = teamId('da000000-0000-4000-8000-000000000011')
const TEAM_B = teamId('da000000-0000-4000-8000-000000000012')
const TEAM_OTHER = teamId('da000000-0000-4000-8000-000000000013')
const PARTICIPATION_A = 'da000000-0000-4000-8000-000000000021'
const PARTICIPATION_B = 'da000000-0000-4000-8000-000000000022'
const PARTICIPATION_OTHER = 'da000000-0000-4000-8000-000000000023'
const START = new Date('2026-08-07T12:00:00.000Z')
const CHANGE = new Date('2026-08-08T12:00:00.000Z')

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  for (const [org, name] of [
    [ORG, 'Membership Integration'],
    [ORG_OTHER, 'Membership Other Tenant'],
  ] as const) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, $2, $1, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [org, name],
    )
  }
  for (const [property, org, slug] of [
    [PROPERTY, ORG, 'team-membership-integration'],
    [PROPERTY_OTHER, ORG_OTHER, 'team-membership-other-tenant'],
  ] as const) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, 'Membership Property', $3, 'UTC', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [property, org, slug],
    )
  }
})

afterAll(async () => {
  const orgs = [ORG, ORG_OTHER]
  await pool.query('DELETE FROM team_memberships WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = ANY($1)', [
    orgs,
  ])
  await pool.query('DELETE FROM teams WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM properties WHERE id = ANY($1)', [
    [PROPERTY, PROPERTY_OTHER],
  ])
  await pool.query('DELETE FROM organization WHERE id = ANY($1)', [orgs])
  await pool.end()
})

beforeEach(async () => {
  const orgs = [ORG, ORG_OTHER]
  await pool.query('DELETE FROM team_memberships WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = ANY($1)', [
    orgs,
  ])
  await pool.query('DELETE FROM teams WHERE organization_id = ANY($1)', [orgs])
  await pool.query(
    `INSERT INTO teams (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $3, $4, 'Team A', NOW(), NOW()),
            ($2, $3, $4, 'Team B', NOW(), NOW())`,
    [TEAM_A, TEAM_B, ORG, PROPERTY],
  )
  await pool.query(
    `INSERT INTO teams (id, organization_id, property_id, name, created_at, updated_at)
     VALUES ($1, $2, $3, 'Team Other', NOW(), NOW())`,
    [TEAM_OTHER, ORG_OTHER, PROPERTY_OTHER],
  )
  await pool.query(
    `INSERT INTO staff_participations
      (id, organization_id, property_id, user_id, display_name, status, started_at, created_by, created_at, updated_at)
     VALUES ($1, $3, $4, 'user-a', 'Alex', 'active', $5, 'owner', NOW(), NOW()),
            ($2, $3, $4, 'user-b', 'Blair', 'active', $5, 'owner', NOW(), NOW())`,
    [PARTICIPATION_A, PARTICIPATION_B, ORG, PROPERTY, START],
  )
  // Same user_id ('user-a') on purpose: a per-user lookup that lost its
  // tenant conjunct would otherwise still look correct.
  await pool.query(
    `INSERT INTO staff_participations
      (id, organization_id, property_id, user_id, display_name, status, started_at, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, 'user-a', 'Casey', 'active', $4, 'owner', NOW(), NOW())`,
    [PARTICIPATION_OTHER, ORG_OTHER, PROPERTY_OTHER, START],
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

// ── Tenant isolation ─────────────────────────────────────────────────
// NON-NEGOTIABLE. Before this block the whole file passed with every one of
// the repository's 17 `eq(*.organizationId, …)` conjuncts deleted, because
// only one organization existed in the fixture. Each test here seeds a REAL
// active membership in the other tenant first, then proves the caller's
// tenant cannot observe or mutate it.
describe('team membership repository — tenant isolation', () => {
  // Both tenants hold an active membership after this runs, so no assertion
  // below can pass vacuously.
  async function seedBothTenants() {
    const repo = createTeamMembershipRepository(getDb())
    const mine = await repo.addMember({
      organizationId: ORG,
      teamId: TEAM_A,
      staffParticipationId: PARTICIPATION_A,
      actorId: 'owner',
      at: START,
    })
    const theirs = await repo.addMember({
      organizationId: ORG_OTHER,
      teamId: TEAM_OTHER,
      staffParticipationId: PARTICIPATION_OTHER,
      actorId: 'owner',
      at: START,
    })
    if (!mine.ok) throw new Error(`fixture: own membership ${mine.code}`)
    if (!theirs.ok) throw new Error(`fixture: other-tenant membership ${theirs.code}`)
    // Scoped to THIS file's two orgs. The integration project shares one
    // database with the e2e seed and every other integration file, so an
    // unscoped read asserts on the whole table and fails on rows it does not
    // own. The precheck still proves non-vacuity: both tenants must have an
    // active membership before any isolation assertion runs.
    const { rows } = await pool.query(
      `SELECT organization_id FROM team_memberships
       WHERE effective_to IS NULL AND organization_id = ANY($1)
       ORDER BY organization_id`,
      [[ORG, ORG_OTHER]],
    )
    expect(rows.map((r) => r.organization_id)).toEqual([ORG, ORG_OTHER])
    return { repo, mine: mine.membership, theirs: theirs.membership }
  }

  it('listByTeam never returns the other tenant memberships', async () => {
    const { repo, mine, theirs } = await seedBothTenants()

    await expect(repo.listByTeam(ORG, TEAM_A)).resolves.toMatchObject([{ id: mine.id }])
    await expect(repo.listByTeam(ORG_OTHER, TEAM_OTHER)).resolves.toMatchObject([
      { id: theirs.id },
    ])
    // Asking for the other tenant's team id from inside this tenant yields
    // nothing — the team id alone must not be a capability.
    await expect(repo.listByTeam(ORG, TEAM_OTHER)).resolves.toEqual([])
    await expect(repo.listByTeam(ORG_OTHER, TEAM_A)).resolves.toEqual([])
  })

  it('listActiveByUser scopes a shared user id to the calling tenant', async () => {
    const { repo, mine, theirs } = await seedBothTenants()

    // 'user-a' is an active participant in BOTH tenants (different
    // participation rows), so an unscoped read returns two memberships.
    await expect(repo.listActiveByUser(ORG, 'user-a')).resolves.toMatchObject([
      { id: mine.id },
    ])
    await expect(repo.listActiveByUser(ORG_OTHER, 'user-a')).resolves.toMatchObject([
      { id: theirs.id },
    ])
  })

  it('findActiveRoleForUser does not resolve a role across tenants', async () => {
    const { repo } = await seedBothTenants()

    await expect(repo.findActiveRoleForUser(ORG, TEAM_A, 'user-a')).resolves.toBe(
      'member',
    )
    await expect(
      repo.findActiveRoleForUser(ORG_OTHER, TEAM_A, 'user-a'),
    ).resolves.toBeNull()
    await expect(
      repo.findActiveRoleForUser(ORG, TEAM_OTHER, 'user-a'),
    ).resolves.toBeNull()
  })

  it('listAvailableForTeam does not offer the other tenant staff', async () => {
    await seedBothTenants()
    const repo = createTeamMembershipRepository(getDb())

    // PARTICIPATION_B is the only unassigned active participant in ORG.
    await expect(repo.listAvailableForTeam(ORG, TEAM_B)).resolves.toMatchObject([
      { id: PARTICIPATION_B },
    ])
    // ORG cannot enumerate a team it does not own, even though that team has
    // an active participant available.
    await expect(repo.listAvailableForTeam(ORG, TEAM_OTHER)).resolves.toEqual([])
    await expect(repo.listAvailableForTeam(ORG_OTHER, TEAM_A)).resolves.toEqual([])
  })

  it('addMember refuses a team belonging to another tenant', async () => {
    await seedBothTenants()
    const repo = createTeamMembershipRepository(getDb())

    await expect(
      repo.addMember({
        organizationId: ORG,
        teamId: TEAM_OTHER,
        staffParticipationId: PARTICIPATION_B,
        actorId: 'owner',
        at: CHANGE,
      }),
    ).resolves.toEqual({ ok: false, code: 'team_not_found' })

    await expect(
      repo.addMember({
        organizationId: ORG,
        teamId: TEAM_A,
        staffParticipationId: PARTICIPATION_OTHER,
        actorId: 'owner',
        at: CHANGE,
      }),
    ).resolves.toEqual({ ok: false, code: 'participation_not_found' })
  })

  it('removeMember and setLead cannot reach across tenants', async () => {
    const { repo, theirs } = await seedBothTenants()

    await expect(
      repo.removeMember({
        organizationId: ORG,
        teamId: TEAM_OTHER,
        staffParticipationId: PARTICIPATION_OTHER,
        reason: 'cross_tenant_attempt',
        at: CHANGE,
      }),
    ).resolves.toEqual({ ok: false, code: 'membership_not_found' })

    await expect(
      repo.setLead({
        organizationId: ORG,
        teamId: TEAM_OTHER,
        staffParticipationId: PARTICIPATION_OTHER,
        actorId: 'owner',
        at: CHANGE,
      }),
    ).resolves.toEqual({ ok: false, code: 'membership_not_found' })

    // The other tenant's membership is untouched: still active, still a member.
    const { rows } = await pool.query(
      `SELECT role, effective_to FROM team_memberships WHERE id = $1`,
      [theirs.id],
    )
    expect(rows).toEqual([{ role: 'member', effective_to: null }])
  })

  it('clearLead cannot demote the other tenant lead', async () => {
    const { repo } = await seedBothTenants()
    await expect(
      repo.setLead({
        organizationId: ORG_OTHER,
        teamId: TEAM_OTHER,
        staffParticipationId: PARTICIPATION_OTHER,
        actorId: 'owner',
        at: START,
      }),
    ).resolves.toMatchObject({ ok: true })

    await expect(
      repo.clearLead({
        organizationId: ORG,
        teamId: TEAM_OTHER,
        reason: 'cross_tenant_attempt',
        actorId: 'owner',
        at: CHANGE,
      }),
    ).resolves.toEqual({ ok: true, membership: null })

    const { rows } = await pool.query(
      `SELECT role FROM team_memberships
       WHERE organization_id = $1 AND team_id = $2 AND effective_to IS NULL`,
      [ORG_OTHER, TEAM_OTHER],
    )
    expect(rows).toEqual([{ role: 'lead' }])
  })

  it('closeForTeam cannot archive the other tenant memberships', async () => {
    const { repo, theirs } = await seedBothTenants()

    await expect(
      repo.closeForTeam(ORG, TEAM_OTHER, CHANGE, 'team_archived'),
    ).resolves.toBe(0)

    const { rows } = await pool.query(
      `SELECT effective_to, end_reason FROM team_memberships WHERE id = $1`,
      [theirs.id],
    )
    expect(rows).toEqual([{ effective_to: null, end_reason: null }])

    // ...and the tenant's own archive still works, so this is scoping, not
    // a broken command.
    await expect(repo.closeForTeam(ORG, TEAM_A, CHANGE, 'team_archived')).resolves.toBe(1)
  })
})
