// BQC-2.5 — delayed/system policy contract wiring proof (real PostgreSQL).
//
// The contract's money rule: an external-effect action performs a strong
// policy read immediately before deciding, so a suspension written NOW
// denies NOW — not after the 5s polling bound. Proves the composition seam
// (initDelayedExecutionPolicy via initPersistedCapabilityPolicyStore) and
// the content-free audit trail for delayed decisions.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import type { CapabilityPolicyEnv } from '#/shared/auth/beta-capabilities'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import {
  getDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { initPersistedCapabilityPolicyStore } from '../policy-store-init'
import { setOrganizationPolicy } from './policy-state.repository'

const db = getDb()
const ORG = 'org-delayed-init'
const PROP = 'd4000000-0000-4000-8000-000000000077'

beforeAll(async () => {
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Delayed Org', ${ORG}, now())`,
  )
  resetCapabilityPolicyStore()
  resetDelayedExecutionPolicy()
  initPersistedCapabilityPolicyStore({ db, env: {} as CapabilityPolicyEnv })
})

afterAll(async () => {
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization_policy WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('delayed policy contract wiring (BQC-2.5)', () => {
  it('suspension denies immediately via the strong read; audit rows written', async () => {
    const policy = getDelayedExecutionPolicy()
    const base = {
      principal: { kind: 'system', id: 'worker:default' } as const,
      action: 'system:review.sync',
      organizationId: ORG,
      propertyId: PROP,
      executionKind: 'worker' as const,
      policyVersionAtEnqueue: 'bqc-2.4',
    }

    // Current policy allows (capability core, no suspension).
    const before = await policy.decide({ ...base, now: new Date() })
    expect(before.outcome).toBe('allow')
    expect(before.freshRead).toBe(true)

    // Suspend the org — the very next decision denies NOW (strong read),
    // without waiting for the 5s polling bound.
    await setOrganizationPolicy(db, { organizationId: ORG, suspendedAt: new Date() })
    const after = await policy.decide({ ...base, now: new Date() })
    expect(after.outcome).toBe('deny')
    expect(after.reason).toBe('org_suspended')
    expect(after.allowed).toBe(false)

    // Content-free audit rows exist for both decisions.
    let rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < 20 && rows.length < 2; i++) {
      const result = await db.execute(
        sql`SELECT actor_type, action, execution_kind, decision, reason, policy_version
            FROM policy_decision_audit WHERE organization_id = ${ORG} ORDER BY occurred_at`,
      )
      rows = result.rows as Array<Record<string, unknown>>
      if (rows.length >= 2) break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]).toMatchObject({
      actor_type: 'system',
      action: 'system:review.sync',
      execution_kind: 'worker',
      decision: 'allow',
      reason: 'allowed',
      policy_version: 'bqc-2.4',
    })
    expect(rows[rows.length - 1]).toMatchObject({
      decision: 'deny',
      reason: 'org_suspended',
    })
  })
})
