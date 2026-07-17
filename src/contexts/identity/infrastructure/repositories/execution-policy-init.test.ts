// BQC-2.4 — ExecutionPolicy composition wiring proof (real PostgreSQL).
//
// initPersistedCapabilityPolicyStore installs BOTH policies: the composite
// capability store (BQC-2.2) and the ExecutionPolicy (BQC-2.4) with the
// identity-owned grant/consent/audit deps. Proves the production seam:
// org-wide allows, assigned-scope without grant denies, grant allows, and
// every decision lands in policy_decision_audit content-free.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import type { CapabilityPolicyEnv } from '#/shared/auth/beta-capabilities'
import {
  requireExecutionAllowed,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import { initPersistedCapabilityPolicyStore } from '../policy-store-init'
import { grantPropertyAccess } from './property-access-grant.repository'
import { organizationId, userId, propertyId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'

const db = getDb()
const ORG = 'org-exec-init'
const ADMIN = 'user-exec-admin'
const PM = 'user-exec-pm'
const PROP = 'd4000000-0000-4000-8000-000000000099'

const adminCtx: AuthContext = {
  userId: userId(ADMIN),
  organizationId: organizationId(ORG),
  role: 'AccountAdmin',
  effectivePermissions: new Set<Permission>(['property.read']),
  scopeByPermission: new Map([['property.read', 'organization' as const]]),
}

const pmCtx: AuthContext = {
  userId: userId(PM),
  organizationId: organizationId(ORG),
  role: 'PropertyManager',
  effectivePermissions: new Set<Permission>(['property.read']),
  scopeByPermission: new Map([['property.read', 'assigned-properties' as const]]),
}

beforeAll(async () => {
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${PM})`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Exec Init Org', ${ORG}, now())`,
  )
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      (${ADMIN}, 'Exec Admin', 'user-exec-admin@example.com', false),
      (${PM}, 'Exec PM', 'user-exec-pm@example.com', false)
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone)
    VALUES (${PROP}, ${ORG}, 'exec-prop', 'exec-prop', 'UTC')
  `)
  resetCapabilityPolicyStore()
  resetExecutionPolicy()
  initPersistedCapabilityPolicyStore({ db, env: {} as CapabilityPolicyEnv })
})

afterAll(async () => {
  resetExecutionPolicy()
  resetCapabilityPolicyStore()
  await db.execute(sql`DELETE FROM policy_decision_audit WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${PM})`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
})

describe('ExecutionPolicy composition wiring (BQC-2.4)', () => {
  it('org-wide allows; assigned-scope without grant denies; grant allows; audit written', async () => {
    // AccountAdmin — org scope passes without grants.
    await expect(
      requireExecutionAllowed({
        actor: adminCtx,
        action: 'property.read',
        propertyId: propertyId(PROP),
      }),
    ).resolves.toBeUndefined()

    // PropertyManager without a grant — deny with the stable reason.
    await expect(
      requireExecutionAllowed({
        actor: pmCtx,
        action: 'property.read',
        propertyId: propertyId(PROP),
      }),
    ).rejects.toMatchObject({ _tag: 'AuthError', code: 'scope_denied', status: 403 })

    // Grant access — the next decision allows (policy_version-keyed cache).
    await grantPropertyAccess(db, {
      organizationId: ORG,
      propertyId: PROP,
      userId: PM,
      source: 'operator',
    })
    await expect(
      requireExecutionAllowed({
        actor: pmCtx,
        action: 'property.read',
        propertyId: propertyId(PROP),
      }),
    ).resolves.toBeUndefined()

    // Content-free audit rows exist for the decisions (fire-and-forget — poll briefly).
    let rows: Array<Record<string, unknown>> = []
    for (let i = 0; i < 20 && rows.length < 3; i++) {
      const result = await db.execute(
        sql`SELECT actor_id, action, decision, reason, execution_kind, policy_version
            FROM policy_decision_audit WHERE organization_id = ${ORG} ORDER BY occurred_at`,
      )
      rows = result.rows as Array<Record<string, unknown>>
      if (rows.length >= 3) break
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const decisions = rows.map((r) => [r.actor_id, r.decision, r.reason])
    expect(decisions).toContainEqual([ADMIN, 'allow', 'allowed'])
    expect(decisions).toContainEqual([PM, 'deny', 'scope_denied'])
    expect(decisions).toContainEqual([PM, 'allow', 'allowed'])
    for (const r of rows) {
      expect(r.execution_kind).toBe('interactive')
      expect(r.policy_version).toBe('bqc-2.4')
    }
  })
})
