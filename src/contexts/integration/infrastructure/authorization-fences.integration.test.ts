import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db/index'
import type { Database } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { fetchPermissionVersion } from '#/shared/db/role-definitions'
import { versionedEntryIsFresh } from '#/shared/auth/tenant-resolver'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import { resetEnv } from '#/shared/config/env'
import {
  grantPropertyAccess,
  hasActiveGrant,
  revokePropertyAccess,
} from '#/contexts/identity/infrastructure/repositories/property-access-grant.repository'
import { createGoogleContentAuthorizationCheck } from './google-content-authorization-check'
import { createActiveMemberAuthResolver } from './active-member-auth.adapter'

const db = getDb()
const ORG = 'org-authorization-fences'
const OWNER = 'user-authorization-fences-owner'
const MANAGER = 'user-authorization-fences-manager'
const CAPABILITY = 'property.import_gbp_v2' as const
const CONNECTION_ID = '00000000-0000-4000-8000-000000000a18'
const resolveActive = createActiveMemberAuthResolver(db)
const check = createGoogleContentAuthorizationCheck({
  clock: () => new Date(),
  hasActivePropertyGrant: hasActiveGrant,
})

let propertyId: string
let savedControl: Record<string, unknown>

const openControl = () =>
  db.execute(sql`
  UPDATE capability_execution_control
  SET denied = false, denied_at = NULL, drained_at = NULL, cleanup_drained_at = NULL
  WHERE capability = ${CAPABILITY}::google_content_capability
`)
const closeControl = () =>
  db.execute(sql`
  UPDATE capability_execution_control SET denied = true, denied_at = now()
  WHERE capability = ${CAPABILITY}::google_content_capability
`)

const exchangeInput = (userId: string) => ({
  capability: CAPABILITY,
  scope: {
    organizationId: ORG,
    propertyId: null,
    connectionId: CONNECTION_ID,
    initiatorUserId: userId,
  },
  operationKey: 'oauth.token.exchange',
})

const decide = (userId: string) => check(db, exchangeInput(userId))

const installStore = (env: Record<string, string | undefined> = {}) => {
  resetCapabilityPolicyStore()
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore(env))
}

async function cleanUp(): Promise<void> {
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM properties WHERE organization_id = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${OWNER}, ${MANAGER})`,
    sql`DELETE FROM permission_version WHERE organization_id = ${ORG}`,
  ])
  await deleteTestOrganizations(db, [ORG])
}

beforeAll(async () => {
  await cleanUp()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'Authorization Fences', ${ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified")
    VALUES
      (${OWNER}, 'Owner', 'authorization-fences-owner@example.com', false),
      (${MANAGER}, 'Manager', 'authorization-fences-manager@example.com', false)
  `)
  const property = await db.execute(sql`
    INSERT INTO properties (organization_id, name, slug, timezone)
    VALUES (${ORG}, 'Fence Property', 'fence-property', 'UTC')
    RETURNING id
  `)
  propertyId = (property.rows[0] as { id: string }).id

  const control = await db.execute(sql`
    SELECT * FROM capability_execution_control
    WHERE capability = ${CAPABILITY}::google_content_capability
  `)
  savedControl = control.rows[0] as typeof savedControl
  await openControl()
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
  ])
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
    VALUES
      ('member-fences-owner', ${OWNER}, ${ORG}, 'owner', now()),
      ('member-fences-manager', ${MANAGER}, ${ORG}, 'admin', now())
  `)
  installStore()
})

afterEach(() => {
  delete process.env.RESTORE_MODE
  resetCapabilityPolicyStore()
  resetEnv()
})

afterAll(async () => {
  await db.execute(sql`
    UPDATE capability_execution_control
    SET denied = ${savedControl.denied}, denied_at = ${savedControl.denied_at},
        drained_at = ${savedControl.drained_at},
        cleanup_drained_at = ${savedControl.cleanup_drained_at}
    WHERE capability = ${CAPABILITY}::google_content_capability
  `)
  await cleanUp()
})

describe('built-in authority is a fixed set', () => {
  const REQUEST_ONLY_FOR_OWNER = ['member.create', 'organization.update', 'policy.admin']

  it('gives the owner the organization scope on every permission it holds', async () => {
    const owner = await resolveActive(ORG, OWNER)

    expect(owner?.role).toBe('AccountAdmin')
    for (const permission of REQUEST_ONLY_FOR_OWNER) {
      expect(owner?.effectivePermissions?.has(permission as never)).toBe(true)
    }
    expect(new Set(owner?.scopeByPermission?.values())).toEqual(new Set(['organization']))
    expect([...(owner?.scopeByPermission?.keys() ?? [])].sort()).toEqual(
      [...(owner?.effectivePermissions ?? [])].sort(),
    )
  })

  it('gives the PropertyManager the assigned-properties scope and none of the owner-only permissions', async () => {
    const manager = await resolveActive(ORG, MANAGER)

    expect(manager?.role).toBe('PropertyManager')
    for (const permission of REQUEST_ONLY_FOR_OWNER) {
      expect(manager?.effectivePermissions?.has(permission as never)).toBe(false)
    }
    expect(manager?.effectivePermissions?.has('integration.manage')).toBe(false)
    expect(new Set(manager?.scopeByPermission?.values())).toEqual(
      new Set(['assigned-properties']),
    )
  })

  it('gives a staff login the assigned-properties scope and fewer permissions than a PropertyManager', async () => {
    const manager = await resolveActive(ORG, MANAGER)
    await db.execute(
      sql`UPDATE member SET role = 'member' WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
    )
    const staff = await resolveActive(ORG, MANAGER)

    expect(staff?.role).toBe('Member')
    expect(new Set(staff?.scopeByPermission?.values())).toEqual(
      new Set(['assigned-properties']),
    )
    expect(staff?.effectivePermissions?.size).toBeLessThan(
      manager?.effectivePermissions?.size ?? 0,
    )
  })
})

describe('property grant freshness', () => {
  const grant = (userId = MANAGER) =>
    grantPropertyAccess(db, {
      organizationId: ORG,
      propertyId,
      userId,
      source: 'operator',
      createdBy: 'op-test',
    })
  const holdsGrant = (at = new Date()) =>
    hasActiveGrant(db, { organizationId: ORG, propertyId, userId: MANAGER, at })

  it('moves the permission version when a grant is added and when it is revoked', async () => {
    const start = await fetchPermissionVersion(db, ORG)

    await grant()
    const afterGrant = await fetchPermissionVersion(db, ORG)
    await revokePropertyAccess(db, { organizationId: ORG, propertyId, userId: MANAGER })
    const afterRevoke = await fetchPermissionVersion(db, ORG)

    expect(afterGrant).toBeGreaterThan(start)
    expect(afterRevoke).toBeGreaterThan(afterGrant)
    expect(versionedEntryIsFresh(afterGrant, afterRevoke)).toBe(false)
  })

  it('stops honouring a grant on the next read once it is revoked', async () => {
    await grant()
    expect(await holdsGrant()).toBe(true)

    await revokePropertyAccess(db, { organizationId: ORG, propertyId, userId: MANAGER })

    expect(await holdsGrant()).toBe(false)
  })

  it('does not honour an expired grant, and honours it before it expires', async () => {
    const expiresAt = new Date(Date.now() + 60_000)
    await grantPropertyAccess(db, {
      organizationId: ORG,
      propertyId,
      userId: MANAGER,
      source: 'operator',
      expiresAt,
    })

    expect(await holdsGrant(new Date(expiresAt.getTime() - 1))).toBe(true)
    expect(await holdsGrant(new Date(expiresAt.getTime() + 1))).toBe(false)
  })

  it('does not take a grant from one user as access for another', async () => {
    await grant(OWNER)

    expect(await holdsGrant()).toBe(false)
  })
})

describe('access revocation races', () => {
  it('does not see a removal until it commits, then refuses on the very next call', async () => {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM member WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
      )
      return createActiveMemberAuthResolver(tx as unknown as Database)(ORG, MANAGER)
    })

    expect(outcome).toBeNull()
    expect(await resolveActive(ORG, MANAGER)).toBeNull()
  })

  it('serves the old authority to a call that read before an uncommitted removal, and refuses after', async () => {
    let releaseRemoval: () => void = () => undefined
    const removalMayCommit = new Promise<void>((resolve) => {
      releaseRemoval = resolve
    })
    let removalStarted: () => void = () => undefined
    const removalHasWritten = new Promise<void>((resolve) => {
      removalStarted = resolve
    })

    const removal = db.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM member WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
      )
      removalStarted()
      await removalMayCommit
    })
    await removalHasWritten

    const duringRemoval = await resolveActive(ORG, MANAGER)
    releaseRemoval()
    await removal
    const afterRemoval = await resolveActive(ORG, MANAGER)

    expect(duringRemoval?.role).toBe('PropertyManager')
    expect(afterRemoval).toBeNull()
  })

  it('refuses every call that starts after concurrent removals and demotions settle', async () => {
    const settle = Promise.all([
      db.execute(
        sql`DELETE FROM member WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
      ),
      executeWithLastOwnerGuardDisabled(db, [
        sql`UPDATE member SET role = 'member' WHERE "organizationId" = ${ORG} AND "userId" = ${OWNER}`,
      ]),
      resolveActive(ORG, MANAGER),
      resolveActive(ORG, OWNER),
    ])
    await settle

    const [manager, owner] = await Promise.all([
      resolveActive(ORG, MANAGER),
      resolveActive(ORG, OWNER),
    ])
    expect(manager).toBeNull()
    expect(owner?.role).toBe('Member')
    expect(owner?.effectivePermissions?.has('organization.update')).toBe(false)
  })

  it('stamps a version a cached context cannot match after a concurrent demotion', async () => {
    const stamped = await fetchPermissionVersion(db, ORG)

    await Promise.all([
      db.execute(
        sql`UPDATE member SET role = 'member' WHERE "organizationId" = ${ORG} AND "userId" = ${MANAGER}`,
      ),
      grantPropertyAccess(db, {
        organizationId: ORG,
        propertyId,
        userId: MANAGER,
        source: 'operator',
      }),
    ])

    expect(versionedEntryIsFresh(stamped, await fetchPermissionVersion(db, ORG))).toBe(
      false,
    )
  })
})

describe('Google content authorization on PostgreSQL', () => {
  it('allows an owner to start an OAuth exchange', async () => {
    await expect(decide(OWNER)).resolves.toMatchObject({
      allowed: true,
      vector: { principalKind: 'user', role: 'AccountAdmin' },
    })
  })

  it('refuses a PropertyManager, whose scope is not the organization', async () => {
    await expect(decide(MANAGER)).resolves.toMatchObject({ allowed: false })
  })

  it('refuses a removed member on the very next decision', async () => {
    await expect(decide(OWNER)).resolves.toMatchObject({ allowed: true })

    await executeWithLastOwnerGuardDisabled(db, [
      sql`DELETE FROM member WHERE "organizationId" = ${ORG} AND "userId" = ${OWNER}`,
    ])

    await expect(decide(OWNER)).resolves.toMatchObject({ allowed: false })
  })

  it('refuses a demoted owner on the very next decision', async () => {
    await expect(decide(OWNER)).resolves.toMatchObject({ allowed: true })

    await executeWithLastOwnerGuardDisabled(db, [
      sql`UPDATE member SET role = 'admin' WHERE "organizationId" = ${ORG} AND "userId" = ${OWNER}`,
    ])

    await expect(decide(OWNER)).resolves.toMatchObject({ allowed: false })
  })

  it('refuses a member whose role is not built in', async () => {
    await executeWithLastOwnerGuardDisabled(db, [
      sql`UPDATE member SET role = 'content-manager' WHERE "organizationId" = ${ORG} AND "userId" = ${OWNER}`,
    ])

    await expect(decide(OWNER)).resolves.toMatchObject({
      allowed: false,
      code: 'authorization_unavailable',
    })
  })

  it('refuses every decision for an organization named in BETA_SUSPENDED_ORGS', async () => {
    installStore({ BETA_SUSPENDED_ORGS: `other-org, ${ORG}` })

    await expect(decide(OWNER)).resolves.toMatchObject({ allowed: false })
  })

  it('keeps deciding for an organization that is not suspended', async () => {
    installStore({ BETA_SUSPENDED_ORGS: 'other-org' })

    await expect(decide(OWNER)).resolves.toMatchObject({ allowed: true })
  })

  it('refuses every decision while the process is in isolated restore mode', async () => {
    process.env.RESTORE_MODE = 'isolated'

    await expect(decide(OWNER)).resolves.toMatchObject({ allowed: false })

    delete process.env.RESTORE_MODE
    await expect(decide(OWNER)).resolves.toMatchObject({ allowed: true })
  })

  it('refuses while the capability is switched off in the execution control', async () => {
    await closeControl()
    try {
      await expect(decide(OWNER)).resolves.toMatchObject({ allowed: false })
    } finally {
      await openControl()
    }
  })
})
