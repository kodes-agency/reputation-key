// Invitation read model on the real better-auth tables (Postgres): the preview
// join (Organization, inviter, account existence) and the Members list (one
// Organization, open rows only, newest first).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { invitationId, organizationId } from '#/shared/domain/ids'
import { createInvitationReadModel } from './invitation-read-model'

const ORG_ID = organizationId('org-invread-0000-0000-0000-000000000001')
const OTHER_ORG_ID = organizationId('org-invread-0000-0000-0000-000000000002')
const INVITER_ID = 'user-invread-inviter-00000000001'
const EXISTING_ID = 'user-invread-existing-0000000001'
const EXPIRES = new Date('2026-10-07T12:00:00.000Z')

let pool: Pool
const readModel = createInvitationReadModel(getDb())

async function insertInvitation(
  row: Readonly<{
    id: string
    organizationId?: string
    email: string
    role?: string
    status?: string
    propertyIds?: string | null
    createdAt: string
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO invitation
       (id, "organizationId", email, role, status, "expiresAt", "inviterId", "propertyIds", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.id,
      row.organizationId ?? ORG_ID,
      row.email,
      row.role ?? 'admin',
      row.status ?? 'pending',
      EXPIRES,
      INVITER_ID,
      row.propertyIds ?? null,
      new Date(row.createdAt),
    ],
  )
}

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM invitation WHERE "organizationId" LIKE 'org-invread-%'`)
  await deleteTestOrganizations(pool, [ORG_ID, OTHER_ORG_ID])
  await pool.query(`DELETE FROM "user" WHERE id LIKE 'user-invread-%'`)
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanup()
  await pool.end()
})

beforeEach(async () => {
  await cleanup()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Riverside Hotels', 'invread-riverside', NOW()),
            ($2, 'Other Group', 'invread-other', NOW())`,
    [ORG_ID, OTHER_ORG_ID],
  )
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, 'Ada Admin', 'invread-inviter@test.com', true, NOW(), NOW()),
            ($2, 'Existing Person', 'Invread-Existing@Test.com', true, NOW(), NOW())`,
    [INVITER_ID, EXISTING_ID],
  )
})

describe.sequential('invitation read model (integration)', () => {
  it('previews an invitation with its Organization, inviter and Properties', async () => {
    await insertInvitation({
      id: 'inv-invread-preview',
      email: 'invread-new@test.com',
      propertyIds: '["prop-a","prop-b"]',
      createdAt: '2026-09-30T10:00:00.000Z',
    })

    await expect(
      readModel.findForPreview(invitationId('inv-invread-preview')),
    ).resolves.toEqual({
      id: 'inv-invread-preview',
      organizationId: ORG_ID,
      organizationName: 'Riverside Hotels',
      email: 'invread-new@test.com',
      role: 'admin',
      status: 'pending',
      expiresAt: EXPIRES,
      inviterName: 'Ada Admin',
      propertyIds: ['prop-a', 'prop-b'],
      accountExists: false,
    })
  })

  it('knows an address already has an account, whatever its case', async () => {
    await insertInvitation({
      id: 'inv-invread-existing',
      email: 'invread-existing@test.com',
      createdAt: '2026-09-30T10:00:00.000Z',
    })

    await expect(
      readModel.findForPreview(invitationId('inv-invread-existing')),
    ).resolves.toMatchObject({ accountExists: true })
  })

  it('returns null for an unknown invitation', async () => {
    await expect(
      readModel.findForPreview(invitationId('inv-invread-missing')),
    ).resolves.toBeNull()
  })

  it("lists one Organization's open invitations, newest first", async () => {
    await insertInvitation({
      id: 'inv-invread-older',
      email: 'invread-a@test.com',
      createdAt: '2026-09-28T10:00:00.000Z',
    })
    await insertInvitation({
      id: 'inv-invread-newer',
      email: 'invread-b@test.com',
      status: 'expired',
      propertyIds: '["prop-a"]',
      createdAt: '2026-09-30T10:00:00.000Z',
    })
    await insertInvitation({
      id: 'inv-invread-accepted',
      email: 'invread-c@test.com',
      status: 'accepted',
      createdAt: '2026-09-29T10:00:00.000Z',
    })
    await insertInvitation({
      id: 'inv-invread-canceled',
      email: 'invread-d@test.com',
      status: 'canceled',
      createdAt: '2026-09-29T11:00:00.000Z',
    })
    await insertInvitation({
      id: 'inv-invread-foreign',
      organizationId: OTHER_ORG_ID,
      email: 'invread-e@test.com',
      createdAt: '2026-09-30T11:00:00.000Z',
    })

    await expect(readModel.listOpenForOrganization(ORG_ID)).resolves.toEqual([
      {
        id: 'inv-invread-newer',
        email: 'invread-b@test.com',
        role: 'admin',
        status: 'expired',
        expiresAt: EXPIRES,
        createdAt: new Date('2026-09-30T10:00:00.000Z'),
        inviterName: 'Ada Admin',
        propertyIds: ['prop-a'],
      },
      {
        id: 'inv-invread-older',
        email: 'invread-a@test.com',
        role: 'admin',
        status: 'pending',
        expiresAt: EXPIRES,
        createdAt: new Date('2026-09-28T10:00:00.000Z'),
        inviterName: 'Ada Admin',
        propertyIds: [],
      },
    ])
  })
})
