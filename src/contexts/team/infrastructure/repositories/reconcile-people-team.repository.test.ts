import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createPeopleCutoverEvidence } from '#/shared/release/people-cutover-evidence'
import { createStaffParticipationRepository } from '#/contexts/staff/infrastructure/repositories/staff-participation.repository'
import {
  applyPeopleReconciliation,
  buildPeopleReconcileReport,
  verifyPeopleCutoverPromotionReadiness,
  verifyPeopleReconciliationParity,
} from './reconcile-people-team.repository'

const ORG = 'org-people-reconcile-integration'
const PROPERTY = 'de000000-0000-4000-8000-000000000001'
const PORTAL = 'de000000-0000-4000-8000-000000000002'
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
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, 'People Reconcile Portal',
             'people-reconcile-portal', 'published', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PORTAL, ORG, PROPERTY, PROPERTY],
  )
})

afterAll(async () => {
  await pool.query('DELETE FROM portal_responsibilities WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query('DELETE FROM team_memberships WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_participations WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_user_links WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_participants WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_assignments WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM portals WHERE id = $1', [PORTAL])
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
  await pool.query('DELETE FROM staff_user_links WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM staff_participants WHERE organization_id = $1', [ORG])
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
      `SELECT sp.user_id, sul.user_id AS linked_user_id,
              participant.display_name, tm.team_id, tm.role
       FROM staff_participations sp
       JOIN staff_participants participant
         ON participant.organization_id = sp.organization_id
        AND participant.id = sp.staff_participant_id
       JOIN staff_user_links sul
         ON sul.organization_id = participant.organization_id
        AND sul.staff_participant_id = participant.id
        AND sul.effective_to IS NULL
       JOIN team_memberships tm ON tm.staff_participation_id = sp.id
       WHERE sp.organization_id = $1 AND sp.status = 'active'
         AND tm.effective_to IS NULL`,
      [ORG],
    )
    expect(rows.rows).toEqual([
      {
        user_id: null,
        linked_user_id: USER,
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

    const parity = await verifyPeopleReconciliationParity(getDb(), scope)
    expect(parity.exact).toBe(false)
    expect(parity.issueRows).toEqual([
      expect.objectContaining({ kind: 'user_missing', sourceId: BAD_ASSIGNMENT }),
    ])
  })

  it('proves a legacy portal assignment reaches the new reader and gates promotion', async () => {
    await pool.query(
      `INSERT INTO staff_assignments
         (id, organization_id, user_id, property_id, team_id, portal_id,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
      [ASSIGNMENT, ORG, USER, PROPERTY, TEAM, PORTAL, START],
    )
    const db = getDb()
    const scope = { organizationIds: [ORG] }

    const before = await verifyPeopleReconciliationParity(db, scope)
    expect(before.exact).toBe(false)
    expect(before.issueRows.map((row) => row.kind)).toEqual([
      'missing_participation',
      'missing_team_membership',
      'missing_portal_responsibility',
    ])

    const report = await buildPeopleReconcileReport(db, scope)
    await applyPeopleReconciliation(db, report, { createdBy: 'ops:test', scope })

    const after = await verifyPeopleReconciliationParity(db, scope)
    expect(after).toMatchObject({
      exact: true,
      counts: {
        legacyAssignments: 1,
        expectedParticipations: 1,
        matchedParticipations: 1,
        expectedMemberships: 1,
        matchedMemberships: 1,
        expectedResponsibilities: 1,
        matchedResponsibilities: 1,
        anomalies: 0,
        missingMappings: 0,
      },
      issueRows: [],
    })

    const reader = createStaffParticipationRepository(db)
    const participation = await reader.findActiveByUser(
      organizationId(ORG),
      propertyId(PROPERTY),
      userId(USER),
    )
    expect(participation).not.toBeNull()
    const responsibilities = await reader.listActiveResponsibilities(
      organizationId(ORG),
      participation!.id,
    )
    expect(responsibilities).toEqual([
      expect.objectContaining({ portalId: PORTAL, kind: 'supporting' }),
    ])

    const evidence = createPeopleCutoverEvidence({
      checkedAt: after.checkedAt,
      scope: after.scope,
      fingerprintSha256: after.fingerprintSha256,
      counts: after.counts,
      operator: { id: 'ops:test', correlationId: 'corr-people-test' },
    })
    const withoutAudit = await verifyPeopleCutoverPromotionReadiness(db, evidence, scope)
    expect(withoutAudit).toMatchObject({
      ready: false,
      failures: [expect.stringMatching(/audited operator decision/i)],
    })

    await pool.query(
      `INSERT INTO policy_decision_audit
         (actor_type, actor_id, action, execution_kind, decision, reason,
          policy_version, correlation_id, occurred_at)
       VALUES ('operator', 'ops:test', 'system:ops', 'operator', 'allow',
               'people cutover', 'test', 'corr-people-test', $1)`,
      [new Date(after.checkedAt.getTime() - 1_000)],
    )
    const ready = await verifyPeopleCutoverPromotionReadiness(db, evidence, scope)
    expect(ready).toMatchObject({ ready: true, failures: [] })

    await pool.query('DELETE FROM portal_responsibilities WHERE organization_id = $1', [
      ORG,
    ])
    const drifted = await verifyPeopleCutoverPromotionReadiness(db, evidence, scope)
    expect(drifted.ready).toBe(false)
    expect(drifted.failures.join('\n')).toMatch(/missing_portal_responsibility/i)

    await pool.query(
      `DELETE FROM policy_decision_audit WHERE correlation_id = 'corr-people-test'`,
    )
  })
})
