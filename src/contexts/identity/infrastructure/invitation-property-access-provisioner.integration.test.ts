// Invitation Property-access provisioning against real PostgreSQL (I3, A8):
// grants record who sent the invitation, a stale selection cannot suppress a
// valid sibling, and failures are reported instead of vanishing.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { createInvitationPropertyAccessProvisioner } from './invitation-property-access-provisioner'

const db = getDb()
const ORG = 'org-invite-provisioner'
const INVITER = 'user-invprov-inviter'
const INVITEE = 'user-invprov-invitee'
const PROPERTY_A = 'd4000000-0000-4000-8000-0000000000a1'
const PROPERTY_B = 'd4000000-0000-4000-8000-0000000000b2'
/** A well-formed id no Property of this Organization has. */
const STALE_PROPERTY = 'd4000000-0000-4000-8000-0000000000ff'
const NOW = new Date('2026-09-30T12:00:00Z')

const logger = { warn: vi.fn(), error: vi.fn() }
const provision = createInvitationPropertyAccessProvisioner({
  db,
  clock: () => NOW,
  logger,
})

type GrantRow = Readonly<{ property_id: string; source: string; created_by: string }>

async function activeGrants(): Promise<ReadonlyArray<GrantRow>> {
  const rows = await db.execute(sql`
    SELECT property_id, source, created_by FROM property_access_grant
    WHERE organization_id = ${ORG} AND user_id = ${INVITEE} AND revoked_at IS NULL
    ORDER BY property_id
  `)
  return rows.rows as GrantRow[]
}

async function clearFixtures() {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`,
    sql`DELETE FROM properties WHERE organization_id = ${ORG}`,
    sql`DELETE FROM member WHERE "organizationId" = ${ORG}`,
    sql`DELETE FROM "user" WHERE id IN (${INVITER}, ${INVITEE})`,
  ])
  await deleteTestOrganizations(db, [ORG])
}

beforeAll(async () => {
  await clearFixtures()
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Provisioner Org', ${ORG}, now())`,
  )
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, "emailVerified") VALUES
      (${INVITER}, 'Inviter', 'user-invprov-inviter@example.com', true),
      (${INVITEE}, 'Invitee', 'user-invprov-invitee@example.com', true)
  `)
  await db.execute(sql`
    INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES
      ('m-invprov-1', ${INVITER}, ${ORG}, 'owner', now()),
      ('m-invprov-2', ${INVITEE}, ${ORG}, 'admin', now())
  `)
  await db.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone) VALUES
      (${PROPERTY_A}, ${ORG}, 'invprov-a', 'invprov-a', 'UTC'),
      (${PROPERTY_B}, ${ORG}, 'invprov-b', 'invprov-b', 'UTC')
  `)
})

beforeEach(async () => {
  logger.warn.mockClear()
  logger.error.mockClear()
  await db.execute(sql`DELETE FROM property_access_grant WHERE organization_id = ${ORG}`)
})

afterAll(clearFixtures)

describe('invitation Property-access provisioning', () => {
  it('records the inviter as the creator of every invitation grant', async () => {
    const result = await provision({
      organizationId: ORG,
      userId: INVITEE,
      propertyIds: [PROPERTY_A, PROPERTY_B],
      inviterId: INVITER,
    })

    expect(result).toEqual({ failedPropertyIds: [] })
    expect(await activeGrants()).toEqual([
      { property_id: PROPERTY_A, source: 'invitation', created_by: INVITER },
      { property_id: PROPERTY_B, source: 'invitation', created_by: INVITER },
    ])
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("records 'invitation' as the creator when the inviter is unknown", async () => {
    await provision({ organizationId: ORG, userId: INVITEE, propertyIds: [PROPERTY_A] })

    expect(await activeGrants()).toEqual([
      { property_id: PROPERTY_A, source: 'invitation', created_by: 'invitation' },
    ])
  })

  it('grants the valid siblings of a stale Property and reports it once', async () => {
    const result = await provision({
      organizationId: ORG,
      userId: INVITEE,
      propertyIds: [PROPERTY_A, STALE_PROPERTY, PROPERTY_B],
      inviterId: INVITER,
    })

    expect(result).toEqual({ failedPropertyIds: [STALE_PROPERTY] })
    expect((await activeGrants()).map((grant) => grant.property_id)).toEqual([
      PROPERTY_A,
      PROPERTY_B,
    ])
    expect(logger.error).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(
      { organizationId: ORG, userId: INVITEE, failedPropertyIds: [STALE_PROPERTY] },
      expect.any(String),
    )
  })

  it('converges on one active grant when acceptance is provisioned again', async () => {
    const input = {
      organizationId: ORG,
      userId: INVITEE,
      propertyIds: [PROPERTY_A],
      inviterId: INVITER,
    }

    await provision(input)
    const repeat = await provision(input)

    expect(repeat).toEqual({ failedPropertyIds: [] })
    expect(await activeGrants()).toHaveLength(1)
    expect(logger.error).not.toHaveBeenCalled()
  })
})
