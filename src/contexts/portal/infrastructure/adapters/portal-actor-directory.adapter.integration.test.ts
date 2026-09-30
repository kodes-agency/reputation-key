// Real-schema proof for the Portal History actor directory: the organization
// fence, and that only a usable display name ever comes back.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, userId } from '#/shared/domain/ids'
import { MAX_PORTAL_ACTOR_DIRECTORY_BATCH } from '../../application/ports/portal-actor-directory.port'
import { createPortalActorDirectoryAdapter } from './portal-actor-directory.adapter'

const ORG_ID = organizationId('org-portal-directory-0000000001')
const OTHER_ORG_ID = organizationId('org-portal-directory-0000000002')
const MEMBER_USER = userId('user-portal-directory-member-001')
const BLANK_NAME_USER = userId('user-portal-directory-blank-0001')
const FOREIGN_USER = userId('user-portal-directory-foreign-01')
const AT = new Date('2026-09-20T10:00:00.000Z')

const db: Database = getDb()
let pool: Pool

const USERS = [MEMBER_USER, BLANK_NAME_USER, FOREIGN_USER] as const

async function clean(): Promise<void> {
  await executeWithLastOwnerGuardDisabled(db, [
    sql`DELETE FROM member WHERE "organizationId" IN (${ORG_ID}, ${OTHER_ORG_ID})`,
  ])
  await deleteTestOrganizations(pool, [ORG_ID, OTHER_ORG_ID])
  for (const id of USERS) {
    await pool.query('DELETE FROM "user" WHERE id = $1', [id])
  }
}

async function seed(): Promise<void> {
  for (const [id, name] of [
    [ORG_ID, 'Portal Directory Test'],
    [OTHER_ORG_ID, 'Portal Directory Other'],
  ] as const) {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $2, $1, $3)`,
      [id, name, AT],
    )
  }
  const insertUser = async (id: string, name: string) =>
    pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, $4, $4)`,
      [id, name, `${id}@example.test`, AT],
    )
  await insertUser(MEMBER_USER, 'Elena Petrova')
  await insertUser(BLANK_NAME_USER, '   ')
  await insertUser(FOREIGN_USER, 'Someone Elsewhere')
  const insertMember = async (id: string, user: string, org: string) =>
    pool.query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, 'member', $4)`,
      [id, user, org, AT],
    )
  await insertMember(`${MEMBER_USER}-m`, MEMBER_USER, ORG_ID)
  await insertMember(`${BLANK_NAME_USER}-m`, BLANK_NAME_USER, ORG_ID)
  await insertMember(`${FOREIGN_USER}-m`, FOREIGN_USER, OTHER_ORG_ID)
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 4 })
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seed()
})

describe.sequential('Portal actor directory adapter (PostgreSQL)', () => {
  it('names members of the Organization and nothing else', async () => {
    const directory = createPortalActorDirectoryAdapter(db)

    const resolved = await directory.resolveDisplayNames(ORG_ID, [
      MEMBER_USER,
      BLANK_NAME_USER,
      FOREIGN_USER,
    ])

    expect([...resolved.entries()]).toEqual([[MEMBER_USER, 'Elena Petrova']])
  })

  it('returns nothing for an Organization the user does not belong to', async () => {
    const directory = createPortalActorDirectoryAdapter(db)

    const resolved = await directory.resolveDisplayNames(OTHER_ORG_ID, [MEMBER_USER])

    expect(resolved.size).toBe(0)
  })

  it('short-circuits an empty batch', async () => {
    const directory = createPortalActorDirectoryAdapter(db)

    await expect(directory.resolveDisplayNames(ORG_ID, [])).resolves.toEqual(new Map())
  })

  it('refuses a batch beyond the bound instead of dropping names', async () => {
    const directory = createPortalActorDirectoryAdapter(db)
    const tooMany = Array.from({ length: MAX_PORTAL_ACTOR_DIRECTORY_BATCH + 1 }, (_, i) =>
      userId(`user-portal-directory-bulk-${i}`),
    )

    await expect(directory.resolveDisplayNames(ORG_ID, tooMany)).rejects.toThrow(
      /exceeds/u,
    )
  })
})
