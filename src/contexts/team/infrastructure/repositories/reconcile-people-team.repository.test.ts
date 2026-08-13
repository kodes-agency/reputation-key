import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import {
  applyPeopleReconciliation,
  buildPeopleReconcileReport,
} from './reconcile-people-team.repository'

const ORG = 'org-people-reconcile-integration'
const PROPERTY = 'de000000-0000-4000-8000-000000000001'
const TEAM = 'de000000-0000-4000-8000-000000000011'
const USER = 'user-people-reconcile'
const ASSIGNMENT = 'de000000-0000-4000-8000-000000000021'
const BAD_ASSIGNMENT = 'de000000-0000-4000-8000-000000000022'
const START = new Date('2026-08-01T10:00:00.000Z')

let pool: Pool

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'People Reconcile Integration', $1, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'People Reconcile Property', 'people-reconcile-integration', 'UTC', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORG],
  )
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Reconcile User', 'people-reconcile@example.com', true, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [USER],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM portal_responsibilities WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM team_memberships WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_assignments WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE id = $1', [PROPERTY])
  await pool.query('DELETE FROM "user" WHERE id = $1', [USER])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORG])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM portal_responsibilities WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM team_memberships WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_assignments WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [ORG])
  await pool.query(
    `INSERT INTO teams
       (id, organization_id, property_id, name, team_lead_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'Reconcile Team', $4, $5, $5)`,
    [TEAM, ORG, PROPERTY, USER, START],
  )
})

describe('people/team reconciliation', () => {
  it('reports anomalies, converts only clean rows, and converges on rerun', async () => {
    await pool.query(
      `INSERT INTO staff_assignments
         (id, organization_id, user_id, property_id, team_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6),
              ($7, $2, 'missing-user', $4, NULL, $6, $6)`,
      [ASSIGNMENT, ORG, USER, PROPERTY, TEAM, START, BAD_ASSIGNMENT],
    )

    const scope = { organizationIds: [ORG] }
    const report = await buildPeopleReconcileReport(getDb(), scope)

    expect(report.organizations).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        activeAssignments: 2,
        participationCandidates: 1,
        membershipCandidates: 1,
        anomalies: 1,
      }),
    ])
    expect(report.anomalyRows).toEqual([
      expect.objectContaining({ kind: 'user_missing', sourceId: BAD_ASSIGNMENT }),
    ])

    const first = await applyPeopleReconciliation(getDb(), report, {
      createdBy: 'ops:test',
      scope,
    })
    expect(first).toMatchObject({
      participationsCreated: 1,
      membershipsCreated: 1,
      leadsPromoted: 1,
    })

    const rows = await pool.query(
      `SELECT sp.user_id, sp.display_name, tm.team_id, tm.role
       FROM staff_participations sp
       JOIN team_memberships tm ON tm.staff_participation_id = sp.id
       WHERE sp.organization_id = $1 AND sp.status = 'active'
         AND tm.effective_to IS NULL`,
      [ORG],
    )
    expect(rows.rows).toEqual([
      {
        user_id: USER,
        display_name: 'Reconcile User',
        team_id: TEAM,
        role: 'lead',
      },
    ])

    const second = await applyPeopleReconciliation(getDb(), report, {
      createdBy: 'ops:test',
      scope,
    })
    expect(second).toEqual({
      participationsCreated: 0,
      membershipsCreated: 0,
      leadsPromoted: 0,
      responsibilitiesCreated: 0,
      groupMembershipsCreated: 0,
    })
  })
})
