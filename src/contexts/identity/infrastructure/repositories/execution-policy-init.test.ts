// BQC-2.4 — ExecutionPolicy composition wiring proof (real PostgreSQL).
//
// buildCapabilityPolicyHandle builds both policies with process-static capability
// configuration and the identity-owned live grant and consent dependencies.
// Proves the production seam: org-wide allows, assigned scope without a grant
// denies, and a committed grant allows.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import type { CapabilityPolicyEnv } from '#/shared/auth/beta-capabilities'
import {
  requireExecutionAllowed,
  resetExecutionPolicy,
} from '#/shared/auth/execution-policy'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { buildCapabilityPolicyHandle } from '../policy-store-init'
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
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${PM})`)
  await deleteTestOrganizations(db, [ORG])
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
  // ARC-03-T8: the handle no longer installs itself — the process
  // installation is the explicit bind, which is what production entry points
  // now do too.
  bindProcessPolicies(
    buildCapabilityPolicyHandle({
      db,
      env: {} as CapabilityPolicyEnv,
      clock: () => new Date(),
      logger: { warn: () => {} },
    }),
  )
})

afterAll(async () => {
  releaseProcessPolicies()
  resetExecutionPolicy()
  resetCapabilityPolicyStore()
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${PM})`)
  await deleteTestOrganizations(db, [ORG])
})

describe('ExecutionPolicy composition wiring (BQC-2.4)', () => {
  it('org-wide allows; assigned-scope without grant denies; grant allows', async () => {
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

    // Grant access — the next live decision observes it.
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
  })
})
