// Real-schema proof for the bounded actor directory (IBX-01-T6). The whole
// value of this adapter is the organization fence and what it refuses to
// return, so it is tested against `member`/`user` rather than a stub.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { executeWithLastOwnerGuardDisabled } from '#/shared/db/disable-guard-triggers'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, userId } from '#/shared/domain/ids'
import { isInboxError } from '../../domain/errors'
import { MAX_INBOX_ACTOR_DIRECTORY_BATCH } from '../../application/ports/inbox-actor-directory.port'
import { createInboxActorDirectoryAdapter } from './inbox-actor-directory.adapter'

const ORG_ID = organizationId('org-inbox-directory-00000000001')
const OTHER_ORG_ID = organizationId('org-inbox-directory-00000000002')
const MEMBER_USER = userId('user-inbox-directory-member-0001')
const BLANK_NAME_USER = userId('user-inbox-directory-blank-0001')
const FOREIGN_USER = userId('user-inbox-directory-foreign-01')
const AT = new Date('2026-08-20T10:00:00.000Z')

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
    [ORG_ID, 'Directory Test'],
    [OTHER_ORG_ID, 'Directory Other'],
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
  await insertUser(MEMBER_USER, 'Ada Lovelace')
  // A member whose profile name is blank: absent from the result, never an
  // empty label and never the email.
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
  const client = await pool.connect()
  client.release()
})

afterAll(async () => {
  await clean()
  await pool.end()
})

beforeEach(async () => {
  await clean()
  await seed()
})

describe.sequential('Inbox actor directory adapter (PostgreSQL)', () => {
  it('resolves a bounded batch within one Organization and nothing outside it', async () => {
    const directory = createInboxActorDirectoryAdapter(db)

    const resolved = await directory.resolveDisplayNames(ORG_ID, [
      MEMBER_USER,
      BLANK_NAME_USER,
      FOREIGN_USER,
    ])

    expect(resolved.get(MEMBER_USER)).toBe('Ada Lovelace')
    // Outside the Organization: absent, so the caller renders "Unknown user".
    expect(resolved.has(FOREIGN_USER)).toBe(false)
    // Blank profile name: absent rather than an empty label.
    expect(resolved.has(BLANK_NAME_USER)).toBe(false)
    // No email or raw id ever becomes a display name.
    expect([...resolved.values()]).toEqual(['Ada Lovelace'])
  })

  it('returns nothing for an Organization the user does not belong to', async () => {
    const directory = createInboxActorDirectoryAdapter(db)

    const resolved = await directory.resolveDisplayNames(OTHER_ORG_ID, [MEMBER_USER])

    expect(resolved.size).toBe(0)
  })

  it('short-circuits an empty batch without querying', async () => {
    const directory = createInboxActorDirectoryAdapter(db)

    await expect(directory.resolveDisplayNames(ORG_ID, [])).resolves.toEqual(new Map())
  })

  it('refuses an unbounded batch instead of silently dropping names', async () => {
    const directory = createInboxActorDirectoryAdapter(db)
    const tooMany = Array.from(
      { length: MAX_INBOX_ACTOR_DIRECTORY_BATCH + 1 },
      (_unused, index) => userId(`user-overflow-${index}`),
    )

    await expect(directory.resolveDisplayNames(ORG_ID, tooMany)).rejects.toSatisfy(
      (error) => isInboxError(error) && error.code === 'invalid_input',
    )
  })

  it('deduplicates so a repeated author does not count against the batch cap', async () => {
    const directory = createInboxActorDirectoryAdapter(db)
    const repeated = Array.from(
      { length: MAX_INBOX_ACTOR_DIRECTORY_BATCH + 10 },
      () => MEMBER_USER,
    )

    const resolved = await directory.resolveDisplayNames(ORG_ID, repeated)

    expect(resolved.get(MEMBER_USER)).toBe('Ada Lovelace')
  })
})
