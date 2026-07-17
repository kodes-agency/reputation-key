// BQC-2.2 — content-free policy decision audit integration test (real PostgreSQL).
//
// The decision audit records that a decision happened — actor kind, action,
// capability, execution kind, allow/deny + stable reason, policy version,
// correlation id — and nothing else. No payloads, no content (ADR 0030
// content-free posture applied to authorization evidence).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { writePolicyDecision } from './policy-decision-audit.repository'

const db = getDb()
const ORG = 'org-audit'

beforeAll(async () => {
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Audit Org', ${ORG}, now())`,
  )
})

afterAll(async () => {
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('policy decision audit (BQC-2.2)', () => {
  it('persists a content-free decision record', async () => {
    await writePolicyDecision(db, {
      actorType: 'user',
      actorId: 'user-audit-1',
      organizationId: ORG,
      propertyId: null,
      action: 'property.create',
      capability: 'property.create',
      executionKind: 'interactive',
      decision: 'deny',
      reason: 'org_suspended',
      policyVersion: 'bqc-2.2',
      correlationId: 'corr-audit-1',
    })

    const rows = await db.execute(
      sql`SELECT * FROM policy_decision_audit WHERE organization_id = ${ORG}`,
    )
    expect(rows.rows).toHaveLength(1)
    const row = rows.rows[0] as Record<string, unknown>
    expect(row.actor_type).toBe('user')
    expect(row.action).toBe('property.create')
    expect(row.decision).toBe('deny')
    expect(row.reason).toBe('org_suspended')
    expect(row.policy_version).toBe('bqc-2.2')
    expect(row.correlation_id).toBe('corr-audit-1')
    expect(row.occurred_at).toBeTruthy()

    // Content-free: the table carries identifiers and enums only.
    expect(Object.keys(row).sort()).toEqual(
      [
        'id',
        'occurred_at',
        'actor_type',
        'actor_id',
        'organization_id',
        'property_id',
        'action',
        'capability',
        'execution_kind',
        'decision',
        'reason',
        'policy_version',
        'correlation_id',
      ].sort(),
    )
  })

  it('rejects invalid enum values (actor/execution/decision)', async () => {
    await expect(
      writePolicyDecision(db, {
        actorType: 'robot',
        actorId: null,
        organizationId: ORG,
        propertyId: null,
        action: 'property.create',
        capability: 'property.create',
        executionKind: 'interactive',
        decision: 'deny',
        reason: 'org_suspended',
        policyVersion: 'bqc-2.2',
        correlationId: null,
      }),
    ).rejects.toThrow()
  })
})
