import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { Database } from '#/shared/db'
import * as schema from '#/shared/db/schema'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createAttentionSignalsAdapter } from './attention-signals.adapter'

const NOW = new Date('2026-08-25T12:00:00.000Z')
const ORGANIZATION = organizationId('org-attention-union-test')
const PROPERTY = propertyId('a1000000-0000-4000-8000-000000000001')
const REVIEW_ONE = 'a2000000-0000-4000-8000-000000000001'
const REVIEW_TWO = 'a2000000-0000-4000-8000-000000000002'
let pool: Pool
let db: Database

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  db = drizzle(pool, { schema }) as unknown as Database
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Attention union test', 'attention-union-test', now())
     ON CONFLICT (id) DO NOTHING`,
    [ORGANIZATION],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Attention Property', 'attention-property', 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [PROPERTY, ORGANIZATION],
  )
})

beforeEach(async () => {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORGANIZATION])
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORGANIZATION])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORGANIZATION])

  for (const [id, externalId] of [
    [REVIEW_ONE, 'attention-review-one'],
    [REVIEW_TWO, 'attention-review-two'],
  ] as const) {
    await pool.query(
      `INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, rating, reviewed_at, expires_at, content_expires_at,
         source_epoch, source_revision, analysis_sequence,
         ai_source_byte_length, ai_source_digest
       ) VALUES (
         $1, $2, $3, 'google', $4, 'locations/attention', 4,
         '2026-08-20T00:00:00Z', '2026-09-25T00:00:00Z',
         '2026-09-25T00:00:00Z', 0, 0, 0, 1, repeat('0', 64)
       )`,
      [id, ORGANIZATION, PROPERTY, externalId],
    )
  }

  for (const item of [
    {
      id: 'a3000000-0000-4000-8000-000000000001',
      sourceType: 'review',
      sourceId: REVIEW_ONE,
      status: 'open',
      escalated: true,
    },
    {
      id: 'a3000000-0000-4000-8000-000000000002',
      sourceType: 'feedback',
      sourceId: 'a4000000-0000-4000-8000-000000000001',
      status: 'open',
      escalated: true,
    },
    {
      id: 'a3000000-0000-4000-8000-000000000003',
      sourceType: 'feedback',
      sourceId: 'a4000000-0000-4000-8000-000000000002',
      status: 'closed',
      escalated: true,
    },
    {
      id: 'a3000000-0000-4000-8000-000000000004',
      sourceType: 'feedback',
      sourceId: 'a4000000-0000-4000-8000-000000000003',
      status: 'closed',
      escalated: false,
    },
  ] as const) {
    await pool.query(
      `INSERT INTO inbox_items (
         id, organization_id, property_id, source_type, source_id,
         status, is_escalated, escalated_at, source_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '2026-08-20T00:00:00Z')`,
      [
        item.id,
        ORGANIZATION,
        PROPERTY,
        item.sourceType,
        item.sourceId,
        item.status,
        item.escalated,
        item.escalated ? NOW : null,
      ],
    )
  }
})

afterAll(async () => {
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORGANIZATION])
  await pool.query('DELETE FROM replies WHERE organization_id = $1', [ORGANIZATION])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORGANIZATION])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORGANIZATION])
  await pool.query('DELETE FROM organization WHERE id = $1', [ORGANIZATION])
  await pool.end()
})

describe('attention signal work-set union', () => {
  it('counts each work anchor once while preserving the overlapping signals', async () => {
    const adapter = createAttentionSignalsAdapter(db, () => NOW)

    await expect(adapter.getAttentionCounts(ORGANIZATION, PROPERTY, 48)).resolves.toEqual(
      {
        unanswered: 2,
        itemsToTriage: 2,
        escalated: 3,
        goalsBehindPace: 0,
        attentionWork: 4,
      },
    )
  })
})
