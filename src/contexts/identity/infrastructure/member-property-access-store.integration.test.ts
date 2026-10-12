// Members access edits against real PostgreSQL: grants, revokes and the
// identity.member.property_access_changed fact commit together or not at all,
// and edits serialize with each other and with the operator surface.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { organizationId, userId, type UserId } from '#/shared/domain/ids'
import { isIdentityError } from '../domain/errors'
import { identityMemberPropertyAccessChanged } from '../domain/events'
import type { SetPropertyAccessCommand } from '../application/ports/member-property-access.port'
import { createMemberPropertyAccessStore } from './member-property-access-store'
import { createPostgresPolicyAdminCommandStore } from './policy-admin-command-store'

const db = getDb()
const store = createMemberPropertyAccessStore(db)
const operatorStore = createPostgresPolicyAdminCommandStore(db)

const ORG = organizationId('org-member-access')
const OTHER_ORG = organizationId('org-member-access-other')
const ADMIN = userId('user-maccess-admin')
const OTHER_ADMIN = userId('user-maccess-admin-2')
const MANAGER = userId('user-maccess-manager')
const OUTSIDER = userId('user-maccess-outsider')
const PROPERTY_A = 'd5000000-0000-4000-8000-0000000000a1'
const PROPERTY_B = 'd5000000-0000-4000-8000-0000000000b2'
const PROPERTY_C = 'd5000000-0000-4000-8000-0000000000c3'
const DELETED_PROPERTY = 'd5000000-0000-4000-8000-0000000000d4'
const FOREIGN_PROPERTY = 'd5000000-0000-4000-8000-0000000000e5'
const NOW = new Date('2026-09-30T12:00:00Z')

type ChangeInput = Readonly<{
  userId?: UserId
  grant?: ReadonlyArray<string>
  revoke?: ReadonlyArray<string>
}>

const change = (input: ChangeInput): SetPropertyAccessCommand => {
  const member = input.userId ?? MANAGER
  return {
    organizationId: ORG,
    userId: member,
    actorUserId: ADMIN,
    grantPropertyIds: input.grant ?? [],
    revokePropertyIds: input.revoke ?? [],
    now: NOW,
    buildEvent: (applied) =>
      identityMemberPropertyAccessChanged({
        organizationId: ORG,
        memberUserId: member,
        userId: ADMIN,
        grantedPropertyIds: applied.grantedPropertyIds,
        revokedPropertyIds: applied.revokedPropertyIds,
        occurredAt: NOW,
      }),
  }
}

type GrantRow = Readonly<{
  property_id: string
  source: string
  created_by: string | null
  revoke_reason: string | null
  revoked: boolean
}>

async function grantRows(): Promise<ReadonlyArray<GrantRow>> {
  const rows = await db.execute(sql`
    SELECT property_id::text AS property_id, source, created_by, revoke_reason,
           revoked_at IS NOT NULL AS revoked
    FROM property_access_grant
    WHERE organization_id = ${ORG} AND user_id = ${MANAGER}
    ORDER BY created_at, property_id
  `)
  return rows.rows as GrantRow[]
}

async function activePropertyIds(): Promise<ReadonlyArray<string>> {
  return (await grantRows())
    .filter((row) => !row.revoked)
    .map((row) => row.property_id)
    .sort()
}

async function facts(): Promise<ReadonlyArray<Record<string, unknown>>> {
  const rows = await db.execute(sql`
    SELECT payload FROM outbox_events
    WHERE organization_id = ${ORG}
      AND event_type = 'identity.member.property_access_changed'
    ORDER BY created_at
  `)
  return rows.rows.map((row) => (row as { payload: Record<string, unknown> }).payload)
}

async function clearFixtures() {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM outbox_events WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
    sql`DELETE FROM property_access_grant WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
    sql`DELETE FROM properties WHERE organization_id IN (${ORG}, ${OTHER_ORG})`,
    sql`DELETE FROM member WHERE "organizationId" IN (${ORG}, ${OTHER_ORG})`,
    sql`DELETE FROM "user" WHERE id IN (${ADMIN}, ${OTHER_ADMIN}, ${MANAGER}, ${OUTSIDER})`,
  ])
  await deleteTestOrganizations(db, [ORG, OTHER_ORG])
}

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await clearFixtures()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt") VALUES
      (${ORG}, 'Member Access Org', ${ORG}, now()),
      (${OTHER_ORG}, 'Other Org', ${OTHER_ORG}, now())
  `)
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      (${ADMIN}, 'Admin', 'user-maccess-admin@example.com', true),
      (${OTHER_ADMIN}, 'Admin Two', 'user-maccess-admin-2@example.com', true),
      (${MANAGER}, 'Manager', 'user-maccess-manager@example.com', true),
      (${OUTSIDER}, 'Outsider', 'user-maccess-outsider@example.com', true)
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES
      ('m-maccess-1', ${ADMIN}, ${ORG}, 'owner', now()),
      ('m-maccess-2', ${OTHER_ADMIN}, ${ORG}, 'owner', now()),
      ('m-maccess-3', ${MANAGER}, ${ORG}, 'admin', now()),
      ('m-maccess-4', ${OUTSIDER}, ${OTHER_ORG}, 'admin', now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, deleted_at) VALUES
      (${PROPERTY_A}, ${ORG}, 'maccess-a', 'maccess-a', 'UTC', NULL),
      (${PROPERTY_B}, ${ORG}, 'maccess-b', 'maccess-b', 'UTC', NULL),
      (${PROPERTY_C}, ${ORG}, 'maccess-c', 'maccess-c', 'UTC', NULL),
      (${DELETED_PROPERTY}, ${ORG}, 'maccess-d', 'maccess-d', 'UTC', now()),
      (${FOREIGN_PROPERTY}, ${OTHER_ORG}, 'maccess-e', 'maccess-e', 'UTC', NULL)
  `)
})

beforeEach(async () => {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
})

afterAll(async () => {
  await clearFixtures()
  clearEventSchemas()
})

describe('member Property access store', () => {
  it('commits grants, revokes and exactly one fact together', async () => {
    await store.setPropertyAccess(change({ grant: [PROPERTY_A] }))

    const applied = await store.setPropertyAccess(
      change({ grant: [PROPERTY_C, PROPERTY_B], revoke: [PROPERTY_A] }),
    )

    expect(applied).toEqual({
      grantedPropertyIds: [PROPERTY_B, PROPERTY_C],
      revokedPropertyIds: [PROPERTY_A],
    })
    expect(await activePropertyIds()).toEqual([PROPERTY_B, PROPERTY_C])
    expect(await grantRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property_id: PROPERTY_A,
          source: 'operator',
          created_by: ADMIN,
          revoke_reason: 'member_access_edit',
          revoked: true,
        }),
        expect.objectContaining({
          property_id: PROPERTY_B,
          source: 'operator',
          created_by: ADMIN,
          revoked: false,
        }),
      ]),
    )
    expect(await facts()).toEqual([
      expect.objectContaining({
        organizationId: ORG,
        memberUserId: MANAGER,
        userId: ADMIN,
        grantedPropertyIds: [PROPERTY_A],
        revokedPropertyIds: [],
      }),
      expect.objectContaining({
        memberUserId: MANAGER,
        grantedPropertyIds: [PROPERTY_B, PROPERTY_C],
        revokedPropertyIds: [PROPERTY_A],
      }),
    ])
  })

  it.each([
    ['another Organization', FOREIGN_PROPERTY],
    ['a deleted Property', DELETED_PROPERTY],
  ])('rolls the whole change back for a Property of %s', async (_label, stale) => {
    await store.setPropertyAccess(change({ grant: [PROPERTY_A] }))

    await expect(
      store.setPropertyAccess(
        change({ grant: [PROPERTY_B, stale], revoke: [PROPERTY_A] }),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'validation_error',
    )

    expect(await activePropertyIds()).toEqual([PROPERTY_A])
    expect(await facts()).toHaveLength(1)
  })

  it('writes no fact for a repeat that changes nothing', async () => {
    await store.setPropertyAccess(change({ grant: [PROPERTY_A] }))

    const repeat = await store.setPropertyAccess(
      change({ grant: [PROPERTY_A], revoke: [PROPERTY_B] }),
    )

    expect(repeat).toEqual({ grantedPropertyIds: [], revokedPropertyIds: [] })
    expect(await facts()).toHaveLength(1)
  })

  it.each([
    ['an AccountAdmin', OTHER_ADMIN],
    ['a member of another Organization', OUTSIDER],
  ])('refuses %s as the target', async (_label, target) => {
    await expect(
      store.setPropertyAccess(change({ userId: target, grant: [PROPERTY_A] })),
    ).rejects.toSatisfy(
      (error: unknown) => isIdentityError(error) && error.code === 'forbidden',
    )
    const rows = await db.execute(sql`
      SELECT 1 FROM property_access_grant WHERE organization_id = ${ORG} AND user_id = ${target}
    `)
    expect(rows.rows).toHaveLength(0)
    expect(await facts()).toHaveLength(0)
  })

  it('retires a lapsed grant as superseded and grants again', async () => {
    await db.execute(sql`
      INSERT INTO property_access_grant
        (organization_id, property_id, user_id, source, created_by, expires_at)
      VALUES (${ORG}, ${PROPERTY_A}, ${MANAGER}, 'operator', ${ADMIN}, ${new Date(NOW.getTime() - 60_000)})
    `)

    const applied = await store.setPropertyAccess(change({ grant: [PROPERTY_A] }))

    expect(applied.grantedPropertyIds).toEqual([PROPERTY_A])
    expect((await grantRows()).map((row) => [row.revoke_reason, row.revoked])).toEqual([
      ['superseded', true],
      [null, false],
    ])
  })

  it('converges on one active grant when two edits race', async () => {
    const outcomes = await Promise.all([
      store.setPropertyAccess(change({ grant: [PROPERTY_A, PROPERTY_B] })),
      store.setPropertyAccess(change({ grant: [PROPERTY_B, PROPERTY_A] })),
    ])

    expect(outcomes.flatMap((outcome) => outcome.grantedPropertyIds).sort()).toEqual([
      PROPERTY_A,
      PROPERTY_B,
    ])
    expect(await activePropertyIds()).toEqual([PROPERTY_A, PROPERTY_B])
    expect((await grantRows()).filter((row) => row.revoked)).toEqual([])
  })

  it('serializes with an operator grant on the same Property', async () => {
    await Promise.all([
      store.setPropertyAccess(change({ grant: [PROPERTY_A] })),
      operatorStore.grantPropertyAccess({
        organizationId: ORG,
        propertyId: PROPERTY_A,
        userId: MANAGER,
        source: 'operator',
        createdBy: OTHER_ADMIN,
      }),
    ])

    expect(await activePropertyIds()).toEqual([PROPERTY_A])
    expect(await grantRows()).toHaveLength(1)
  })

  it("lists each member's active grants on live Properties", async () => {
    await store.setPropertyAccess(change({ grant: [PROPERTY_A, PROPERTY_B] }))
    await db.execute(sql`
      INSERT INTO property_access_grant
        (organization_id, property_id, user_id, source, created_by, expires_at)
      VALUES
        (${ORG}, ${PROPERTY_C}, ${MANAGER}, 'operator', ${ADMIN}, ${new Date(NOW.getTime() - 60_000)}),
        (${ORG}, ${DELETED_PROPERTY}, ${MANAGER}, 'operator', ${ADMIN}, NULL)
    `)

    await expect(store.listActiveByOrganization(ORG, NOW)).resolves.toEqual([
      { userId: MANAGER, propertyIds: [PROPERTY_A, PROPERTY_B] },
    ])
  })
})
