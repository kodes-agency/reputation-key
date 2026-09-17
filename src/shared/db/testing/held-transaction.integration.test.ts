import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { getEnv } from '#/shared/config/env'
import { holdTransaction } from './held-transaction'

const INSERT_ORGANIZATION = `INSERT INTO organization (id, name, slug, "createdAt")
  VALUES ($1, 'Held transaction test', $2, now())`

function organizationFixture() {
  const id = `org-held-transaction-${randomUUID()}`
  return { id, slug: `held-transaction-${randomUUID()}` }
}

/** Counts the rows on a second connection, so only committed rows are seen. */
async function countCommittedOrganizations(ids: readonly string[]) {
  const observer = new Client({ connectionString: getEnv().DATABASE_URL })
  await observer.connect()
  try {
    const result = await observer.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM organization WHERE id = ANY($1)',
      [ids],
    )
    return result.rows[0]!.count
  } finally {
    await observer.end()
  }
}

describe('holdTransaction', () => {
  it('commits nothing when the code under test commits its own transaction', async () => {
    const fixture = organizationFixture()
    const subject = organizationFixture()
    const held = await holdTransaction()
    try {
      await held.client.query(INSERT_ORGANIZATION, [fixture.id, fixture.slug])
      await held.db.transaction(async (tx) => {
        await tx.execute(
          sql`INSERT INTO organization (id, name, slug, "createdAt")
              VALUES (${subject.id}, 'Held transaction test', ${subject.slug}, now())`,
        )
      })

      const visible = await held.client.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM organization WHERE id = ANY($1)',
        [[fixture.id, subject.id]],
      )
      expect(visible.rows[0]!.count).toBe(2)
      expect(await countCommittedOrganizations([fixture.id, subject.id])).toBe(0)
    } finally {
      await held.rollBack()
    }

    expect(await countCommittedOrganizations([fixture.id, subject.id])).toBe(0)
  })

  it('keeps the fixture when the transaction of the code under test fails', async () => {
    const fixture = organizationFixture()
    const subject = organizationFixture()
    const held = await holdTransaction()
    try {
      await held.client.query(INSERT_ORGANIZATION, [fixture.id, fixture.slug])
      await expect(
        held.db.transaction(async (tx) => {
          await tx.execute(
            sql`INSERT INTO organization (id, name, slug, "createdAt")
                VALUES (${subject.id}, 'Held transaction test', ${subject.slug}, now())`,
          )
          throw new Error('subject failed')
        }),
      ).rejects.toThrow('subject failed')

      const visible = await held.client.query<{ id: string }>(
        'SELECT id FROM organization WHERE id = ANY($1)',
        [[fixture.id, subject.id]],
      )
      expect(visible.rows.map((row) => row.id)).toEqual([fixture.id])
    } finally {
      await held.rollBack()
    }
  })
})
