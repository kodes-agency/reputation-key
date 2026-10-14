// ReviewServingStats daily series (rating trend, review volume) are bucketed by
// the PROPERTY's calendar day, the same calendar the window is opened in
// (`resolvePropertyPeriod` -> `shiftPropertyLocalDays`) and the one Portal
// Results use (S14-03). A review written at 18:30 on 10 Oct in Los Angeles is
// 01:30 UTC on 11 Oct; bucketed by the UTC day it lands a day after the guest
// wrote it, and the week and month buckets built from the series inherit it.
// Real PostgreSQL.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { createServingStats } from '../serving-stats'

const ORG = organizationId('org-serving-stats-days-1111111111111')
const LOS_ANGELES = propertyId('2b100000-0000-4000-8000-000000000001')
const SOFIA = propertyId('2b100000-0000-4000-8000-000000000002')

const WINDOW_START = new Date('2026-10-01T00:00:00.000Z')
const WINDOW_END = new Date('2026-10-31T00:00:00.000Z')

let pool: Pool
const db = getDb()
const stats = createServingStats({
  db,
  clock: () => new Date('2026-10-14T12:00:00.000Z'),
})

async function insertReview(
  id: string,
  property: string,
  reviewedAt: string,
  rating: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO reviews (
      id, organization_id, property_id, platform, external_id,
      external_location_id, reviewer_name, rating, text, reviewed_at,
      expires_at, content_expires_at, first_fetched_at, last_fetched_at,
      source_epoch, source_revision, analysis_sequence,
      ai_source_byte_length, ai_source_digest
    ) VALUES (
      ${id}, ${ORG}, ${property}, 'google', ${`ext-${id.slice(-4)}`},
      ${GOOGLE_LOCATION_PRIMARY_RESOURCE}, 'Jane', ${rating}, 'Stay', ${reviewedAt}::timestamptz,
      now(), now() + interval '10 days', now(), now(), 0, 0, 0, 1, ${'0'.repeat(64)}
    )
  `)
}

async function seedProperty(id: string, slug: string, timezone: string): Promise<void> {
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`,
    [id, ORG, `Days ${slug}`, slug, timezone],
  )
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Serving Stats Days Org', 'serving-stats-days-org', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  )
  await seedProperty(LOS_ANGELES, 'serving-days-la', 'America/Los_Angeles')
  await seedProperty(SOFIA, 'serving-days-sofia', 'Europe/Sofia')
})

afterAll(async () => {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [ORG])
})

describe('ReviewServingStats daily series by Property calendar day', () => {
  it('buckets a Los Angeles evening review under the day the guest wrote it', async () => {
    // 18:30 on 10 Oct in Los Angeles (UTC-7) is 01:30 UTC on 11 Oct.
    await insertReview(
      '2b100000-0000-4000-8000-0000000000a1',
      LOS_ANGELES,
      '2026-10-11T01:30:00Z',
      4,
    )

    const volume = await stats.getReviewVolume(ORG, LOS_ANGELES, WINDOW_START, WINDOW_END)
    const trend = await stats.getRatingTrend(ORG, LOS_ANGELES, WINDOW_START, WINDOW_END)

    expect(volume).toEqual([{ date: '2026-10-10', count: 1 }])
    expect(trend).toEqual([{ date: '2026-10-10', avgRating: 4 }])
  })

  it('buckets a Sofia night review under the day the guest wrote it', async () => {
    // 01:30 on 11 Oct in Sofia (UTC+3) is 22:30 UTC on 10 Oct.
    await insertReview(
      '2b100000-0000-4000-8000-0000000000a2',
      SOFIA,
      '2026-10-10T22:30:00Z',
      5,
    )

    const volume = await stats.getReviewVolume(ORG, SOFIA, WINDOW_START, WINDOW_END)

    expect(volume).toEqual([{ date: '2026-10-11', count: 1 }])
  })

  it('splits one UTC day into the two Property days it spans', async () => {
    await insertReview(
      '2b100000-0000-4000-8000-0000000000a3',
      LOS_ANGELES,
      '2026-10-11T01:30:00Z',
      5,
    )
    await insertReview(
      '2b100000-0000-4000-8000-0000000000a4',
      LOS_ANGELES,
      '2026-10-11T20:00:00Z',
      3,
    )

    const volume = await stats.getReviewVolume(ORG, LOS_ANGELES, WINDOW_START, WINDOW_END)

    expect(volume).toEqual([
      { date: '2026-10-10', count: 1 },
      { date: '2026-10-11', count: 1 },
    ])
  })

  it('reads another Property of the Organization in its own calendar', async () => {
    await insertReview(
      '2b100000-0000-4000-8000-0000000000a5',
      LOS_ANGELES,
      '2026-10-11T01:30:00Z',
      4,
    )

    const volume = await stats.getReviewVolume(ORG, SOFIA, WINDOW_START, WINDOW_END)

    expect(volume).toEqual([])
  })
})
