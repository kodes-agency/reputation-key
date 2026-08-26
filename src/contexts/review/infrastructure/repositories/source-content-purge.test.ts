// REV-01 source-content erasure against real PostgreSQL.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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
const CONTENT_EXPIRES_AT = new Date('2026-08-16T12:00:00Z')

async function reset(): Promise<void> {
  await db.execute(sql`DELETE FROM replies WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM review_source_contents WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM reviews WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM inbox_items WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM google_connections WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ORG}`)
  await db.execute(sql`DELETE FROM retention_runs WHERE subject LIKE '%.purge.%'`)
  await db.execute(sql`DELETE FROM organization WHERE id = ${ORG}`)
}

async function seedConnection(id: string, accountSuffix: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO google_connections (
      id, organization_id, google_subject,
      encrypted_access_token, encrypted_refresh_token, token_expires_at,
      scopes, connected_by, status
    ) VALUES (
      ${id}, ${ORG}, ${'subject-' + accountSuffix},
      'tok', 'rtok', now(), ARRAY['x'], 'user-1', 'active'
    )
  `)
}

async function seedReview(
  id: string,
  connectionId: string,
  property: string,
  withReply: boolean,
): Promise<void> {
  const externalId = `ext-${id}`
  await db.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id,
      external_location_id, google_connection_id, reviewer_name, rating, text,
      reviewed_at, expires_at, first_fetched_at, last_fetched_at,
      content_expires_at, content_hash, source_epoch, source_revision,
      analysis_sequence, ai_source_byte_length, ai_source_digest
    ) VALUES (
      ${id}, ${ORG}, ${property}, 'google', ${externalId},
      ${GOOGLE_LOCATION_PRIMARY_RESOURCE}, ${connectionId}, 'Provider guest', 5,
      'Provider-controlled text', ${NOW}, ${CONTENT_EXPIRES_AT}, ${NOW}, ${NOW},
      ${CONTENT_EXPIRES_AT}, 'source-hash', 0, 1, 0, 32, ${'0'.repeat(64)}
    )
  `)
  await db.execute(sql`
    INSERT INTO review_source_contents (
      review_id, organization_id, property_id, platform, external_id,
      external_location_id, google_connection_id, reviewer_name, rating, text,
      reviewed_at, first_fetched_at, last_fetched_at, content_expires_at,
      content_hash, source_epoch, source_revision, ai_source_byte_length,
      ai_source_digest
    ) VALUES (
      ${id}, ${ORG}, ${property}, 'google', ${externalId},
      ${GOOGLE_LOCATION_PRIMARY_RESOURCE}, ${connectionId}, 'Provider guest', 5,
      'Provider-controlled text', ${NOW}, ${NOW}, ${NOW}, ${CONTENT_EXPIRES_AT},
      'source-hash', 0, 1, 32, ${'0'.repeat(64)}
    )
  `)
  if (withReply) {
    await db.execute(sql`
      INSERT INTO replies (id, review_id, organization_id, text, status, source)
      VALUES (gen_random_uuid(), ${id}, ${ORG}, 'Manager reply', 'published', 'internal')
    `)
  }
}

async function seed(): Promise<void> {
  await db.execute(
    sql`INSERT INTO organization (id, name, slug, "createdAt") VALUES (${ORG}, 'Purge Org', 'purge-org', ${NOW})`,
  )
  for (const [id, name] of [
    [PROP_A, 'prop-a'],
    [PROP_B, 'prop-b'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
      VALUES (${id}, ${ORG}, ${name}, ${name}, 'UTC', ${NOW}, ${NOW})
    `)
  }
  await seedConnection(CONN_A, 'a')
  await seedConnection(CONN_B, 'b')
  for (let i = 1; i <= 3; i++) {
    await seedReview(`aa000000-0000-4000-8000-000000000a0${i}`, CONN_A, PROP_A, i <= 2)
  }
  for (let i = 4; i <= 5; i++) {
    await seedReview(`aa000000-0000-4000-8000-000000000a0${i}`, CONN_B, PROP_B, false)
  }
  for (const [i, property] of [
    ['f1', PROP_A],
    ['f2', PROP_B],
  ] as const) {
    await db.execute(sql`
      INSERT INTO inbox_items (
        id, organization_id, property_id, source_type, source_id, status, source_date
      ) VALUES (
        ${'cc000000-0000-4000-8000-0000000000' + i}, ${ORG}, ${property}, 'review',
        ${'cc000000-0000-4000-8000-0000000000' + i}, 'open', ${NOW}
      )
    `)
  }
}

async function count(table: string, where: string): Promise<number> {
  const result = await db.execute(
    sql.raw(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`),
  )
  return Number(result.rows[0]!.count)
}

describe('source content purge (real PostgreSQL)', () => {
  beforeEach(async () => {
    await reset()
    await seed()
  })

  afterAll(reset)

  it('scrubs one connection in bounded batches and preserves Reviews and Replies', async () => {
    const purge = createSourceContentPurge({ db, clock: () => NOW, batchSize: 2 })

    const result = await purge.forConnection(ORG as never, CONN_A)

    expect(result).toEqual({
      subject: 'reviews.purge.connection',
      batches: 2,
      rowsDeleted: 0,
      rowsRedacted: 3,
    })
    expect(await count('reviews', `organization_id = '${ORG}'`)).toBe(5)
    expect(await count('replies', `organization_id = '${ORG}'`)).toBe(2)
    expect(
      await count(
        'reviews',
        `organization_id = '${ORG}' AND property_id = '${PROP_A}' AND source_content_state = 'source_expired' AND text IS NULL AND rating IS NULL`,
      ),
    ).toBe(3)
    expect(await count('review_source_contents', `organization_id = '${ORG}'`)).toBe(2)

    const evidence = await db.execute(sql`
      SELECT rows_deleted, rows_redacted, outcome
      FROM retention_runs
      WHERE subject = 'reviews.purge.connection'
      ORDER BY started_at DESC LIMIT 1
    `)
    expect(evidence.rows[0]).toMatchObject({
      rows_deleted: 0,
      rows_redacted: 3,
      outcome: 'completed',
    })
  })

  it('scrubs a Property without deleting its stable Reviews or Replies', async () => {
    const purge = createSourceContentPurge({ db, clock: () => NOW, batchSize: 2 })

    const result = await purge.forProperty(ORG as never, PROP_A as never)

    expect(result).toMatchObject({ rowsDeleted: 0, rowsRedacted: 3, batches: 2 })
    expect(await count('reviews', `organization_id = '${ORG}'`)).toBe(5)
    expect(await count('replies', `organization_id = '${ORG}'`)).toBe(2)
    expect(await count('review_source_contents', `property_id = '${PROP_A}'`)).toBe(0)
  })

  it('scrubs every active Review in an Organization and is idempotent', async () => {
    const purge = createSourceContentPurge({ db, clock: () => NOW, batchSize: 2 })

    const first = await purge.forOrganization(ORG as never)
    const replay = await purge.forOrganization(ORG as never)

    expect(first).toMatchObject({ rowsDeleted: 0, rowsRedacted: 5, batches: 3 })
    expect(replay).toMatchObject({ rowsDeleted: 0, rowsRedacted: 0, batches: 0 })
    expect(await count('reviews', `organization_id = '${ORG}'`)).toBe(5)
    expect(await count('replies', `organization_id = '${ORG}'`)).toBe(2)
    expect(await count('review_source_contents', `organization_id = '${ORG}'`)).toBe(0)
  })

  it('deletes only the Property Inbox companion rows', async () => {
    const purge = createSourceContentPurge({ db, clock: () => NOW })

    const result = await purge.inboxForProperty(ORG as never, PROP_A as never)

    expect(result).toMatchObject({ rowsDeleted: 1, rowsRedacted: 0 })
    expect(await count('inbox_items', `organization_id = '${ORG}'`)).toBe(1)
    expect(await count('reviews', `organization_id = '${ORG}'`)).toBe(5)
  })
})
