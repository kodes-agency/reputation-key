// BQC-1.7 — source-content lifecycle purge integration test (real PostgreSQL).
// Disconnect/property/org purges remove source content + replies in bounded,
// evidenced steps — and nothing else.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { createSourceContentPurge } from '../source-content-purge'

const db = getDb()
const ORG = 'org-purge-test'
const CONN_A = 'aa000000-0000-4000-8000-0000000000ca'
const CONN_B = 'bb000000-0000-4000-8000-0000000000cb'
const PROP_A = 'aa000000-0000-4000-8000-0000000000a1'
const PROP_B = 'bb000000-0000-4000-8000-0000000000b1'
const NOW = new Date('2026-07-17T12:00:00Z')

async function seedConnection(id: string, accountSuffix: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO google_connections (
      id, organization_id, google_account_id, google_email,
      encrypted_access_token, encrypted_refresh_token, token_expires_at,
      scopes, connected_by, status
    ) VALUES (
      ${id}, ${ORG}, ${'acc-' + accountSuffix}, ${'e@' + accountSuffix},
      'tok', 'rtok', now(), ARRAY['x'], 'user-1', 'active'
    )
    ON CONFLICT (id) DO NOTHING
  `)
}

async function seedReview(
  id: string,
  connectionId: string,
  propertyId: string,
  withReply: boolean,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id,
      external_location_id, google_connection_id, rating, reviewed_at, expires_at
    ) VALUES (
      ${id}, ${ORG}, ${propertyId}, 'google', ${'ext-' + id},
      'accounts/1/locations/2', ${connectionId}, 5, now(), now()
    )
    ON CONFLICT (id) DO NOTHING
  `)
  if (withReply) {
    await db.execute(sql`
      INSERT INTO replies (id, review_id, organization_id, text, status, source)
      VALUES (gen_random_uuid(), ${id}, ${ORG}, 'reply', 'published', 'internal')
      ON CONFLICT DO NOTHING
    `)
  }
}

async function count(table: string, where: string): Promise<number> {
  const r = await db.execute(
    sql.raw(`SELECT count(*)::int AS c FROM ${table} WHERE ${where}`),
  )
  return (r.rows[0] as { c: number }).c
}

describe('source content purge (BQC-1.7, integration)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Purge Org', 'purge-org', NOW()) ON CONFLICT (id) DO NOTHING`,
    )
    for (const [id, name] of [
      [PROP_A, 'prop-a'],
      [PROP_B, 'prop-b'],
    ] as const) {
      await db.execute(sql`
        INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
        VALUES (${id}, ${ORG}, ${name}, ${name}, 'UTC', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `)
    }
    await seedConnection(CONN_A, 'a')
    await seedConnection(CONN_B, 'b')
    // Connection A: 3 reviews (2 with replies); connection B: 2 reviews
    for (let i = 1; i <= 3; i++) {
      await seedReview(`aa000000-0000-4000-8000-000000000a0${i}`, CONN_A, PROP_A, i <= 2)
    }
    for (let i = 4; i <= 5; i++) {
      await seedReview(`aa000000-0000-4000-8000-000000000a0${i}`, CONN_B, PROP_B, false)
    }
    // Inbox rows for property A and B
    for (const [i, prop] of [
      ['f1', PROP_A],
      ['f2', PROP_B],
    ] as const) {
      await db.execute(sql`
        INSERT INTO inbox_items (
          id, organization_id, property_id, source_type, source_id, status, source_date
        ) VALUES (
          ${'cc000000-0000-4000-8000-0000000000' + i}, ${ORG}, ${prop}, 'review',
          ${'cc000000-0000-4000-8000-0000000000' + i}, 'open', now()
        )
        ON CONFLICT DO NOTHING
      `)
    }
  })

  afterAll(async () => {
    await db.execute(sql`DELETE FROM replies WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM inbox_items WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM google_connections WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
    await db.execute(sql`DELETE FROM retention_runs WHERE subject LIKE '%.purge.%'`)
  })

  it('forConnection removes exactly the connection’s reviews and replies, with evidence', async () => {
    const purge = createSourceContentPurge({ db, clock: () => NOW, batchSize: 2 })

    const result = await purge.forConnection(ORG as never, CONN_A)

    expect(result.rowsDeleted).toBe(3)
    expect(result.batches).toBe(2) // bounded: batchSize 2 → 2 batches for 3 rows
    expect(await count('reviews', `organization_id = '${ORG}'`)).toBe(2) // B intact
    expect(await count('replies', `organization_id = '${ORG}'`)).toBe(0) // cascaded per batch

    const evidence = await db.execute(sql`
      SELECT * FROM retention_runs WHERE subject = 'reviews.purge.connection'
      ORDER BY started_at DESC LIMIT 1
    `)
    expect(evidence.rows).toHaveLength(1)
    expect(evidence.rows[0].outcome).toBe('completed')
    expect(evidence.rows[0].rows_deleted).toBe(3)
  })

  it('inboxForProperty removes the property’s inbox rows only', async () => {
    const purge = createSourceContentPurge({ db, clock: () => NOW })

    const result = await purge.inboxForProperty(ORG as never, PROP_A as never)

    expect(result.rowsDeleted).toBe(1)
    expect(await count('inbox_items', `organization_id = '${ORG}'`)).toBe(1)
  })

  it('forOrganization removes all remaining reviews for the org', async () => {
    const purge = createSourceContentPurge({ db, clock: () => NOW })

    const result = await purge.forOrganization(ORG as never)

    expect(result.rowsDeleted).toBe(2)
    expect(await count('reviews', `organization_id = '${ORG}'`)).toBe(0)
  })
})
