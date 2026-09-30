// Low ratings against the real database (ADR 0046, amended 2026-09-30).
//
// How low a rating must be is stored with the answer it belongs to — per
// Property and as the person's default — and nowhere else; migration 0042
// carries each Action needed email choice over to it; and a review's rating is
// asked of Review for routing, while a feedback item is never looked up.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  createNotificationCategoryDefault,
  createNotificationPreference,
} from '../../domain/constructors-preference'
import { createNotificationPreferenceRepository } from './notification-preference.repository'
import { createReviewRatingForRouting } from '../adapters/review-rating-routing.adapter'

const ORG = 'org-notification-low-ratings'
const USER = 'user-notification-low-ratings'
const OTHER_USER = 'user-notification-low-ratings-other'
const HARBOUR = '86900000-0000-4000-8000-000000000001'
const RIVERSIDE = '86900000-0000-4000-8000-000000000002'
const REVIEW_ITEM = '86900000-0000-4000-8000-000000000011'
const FEEDBACK_ITEM = '86900000-0000-4000-8000-000000000012'
const REVIEW = '86900000-0000-4000-8000-000000000021'
const NOW = new Date('2026-09-30T09:00:00.000Z')

let pool: Pool

async function cleanUp() {
  await pool.query('DELETE FROM notification_preferences WHERE organization_id = $1', [
    ORG,
  ])
  await pool.query(
    'DELETE FROM notification_category_defaults WHERE organization_id = $1',
    [ORG],
  )
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
  await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(pool, [ORG])
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanUp()
  await pool.end()
})

beforeEach(async () => {
  await cleanUp()
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, 'Low ratings', 'notification-low-ratings', NOW())`,
    [ORG],
  )
  for (const [id, slug] of [
    [HARBOUR, 'harbour'],
    [RIVERSIDE, 'riverside'],
  ]) {
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())`,
      [id, ORG, slug, `notification-low-ratings-${slug}`],
    )
  }
})

describe.sequential('Low ratings thresholds (real PostgreSQL)', () => {
  it('keeps a threshold per Property and as the default, and resolves each channel', async () => {
    const repo = createNotificationPreferenceRepository(getDb())
    const own = createNotificationPreference(
      {
        id: notificationPreferenceId(randomUUID()),
        userId: userId(USER),
        organizationId: organizationId(ORG),
        propertyId: propertyId(HARBOUR),
        category: 'low_ratings',
        channel: 'email',
        enabled: true,
        cadence: 'immediate',
        maxRating: 1,
      },
      () => NOW,
    )
    const personal = createNotificationCategoryDefault(
      {
        userId: userId(USER),
        organizationId: organizationId(ORG),
        category: 'low_ratings',
        channel: 'email',
        enabled: true,
        cadence: 'immediate',
        maxRating: 4,
      },
      () => NOW,
    )
    if (own.isErr() || personal.isErr()) throw new Error('fixture refused')
    await repo.upsert(own.value)
    await repo.saveCategoryDefault(personal.value, RIVERSIDE)

    const at = (property: string, channel: 'in_app' | 'email') =>
      repo.resolveForDelivery(USER, ORG, property, 'low_ratings', channel)
    await expect(at(HARBOUR, 'email')).resolves.toMatchObject({ maxRating: 1 })
    await expect(at(RIVERSIDE, 'email')).resolves.toMatchObject({ maxRating: 4 })
    // Nothing chosen in the app: 3 stars or lower.
    await expect(at(HARBOUR, 'in_app')).resolves.toEqual({
      enabled: true,
      cadence: 'immediate',
      maxRating: 3,
    })
  })

  it.each([
    ['a Low ratings row without a threshold', 'low_ratings', null],
    ['a threshold above 4 stars', 'low_ratings', 5],
    ['a threshold on another category', 'arrivals', 2],
  ])('refuses %s', async (_label, category, maxRating) => {
    await expect(
      pool.query(
        `INSERT INTO notification_preferences
           (user_id, organization_id, property_id, category, channel, enabled, cadence, max_rating)
         VALUES ($1, $2, $3, $4, 'email', true, 'immediate', $5)`,
        [USER, ORG, HARBOUR, category, maxRating],
      ),
    ).rejects.toMatchObject({
      constraint: expect.stringMatching(
        /^notification_preferences_max_rating_(scope|range)$/,
      ),
    })
  })

  // The carry-over statements of migration 0042, run as written, in a
  // transaction that is rolled back so no other suite sees their rows.
  it('carries each Action needed email choice over to Low ratings at 3 stars or lower', async () => {
    const migration = readFileSync(
      join(process.cwd(), 'drizzle', '0042_notification_low_ratings.sql'),
      'utf8',
    )
    const carryOver = migration
      .split('--> statement-breakpoint')
      .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
      .filter((statement) => statement.startsWith('INSERT'))
    expect(carryOver).toHaveLength(2)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO notification_preferences
           (user_id, organization_id, property_id, category, channel, enabled, cadence)
         VALUES ($1, $2, $3, 'urgent_operational', 'email', false, 'immediate'),
                ($1, $2, $4, 'urgent_operational', 'email', true, 'daily')`,
        [USER, ORG, HARBOUR, RIVERSIDE],
      )
      await client.query(
        `INSERT INTO notification_category_defaults
           (user_id, organization_id, category, channel, enabled, cadence)
         VALUES ($1, $2, 'urgent_operational', 'email', true, 'immediate')`,
        [OTHER_USER, ORG],
      )
      for (const statement of carryOver) await client.query(statement)
      // Idempotent: a second run keeps what the first wrote.
      for (const statement of carryOver) await client.query(statement)

      const properties = await client.query(
        `SELECT property_id, enabled, cadence, max_rating FROM notification_preferences
          WHERE organization_id = $1 AND category = 'low_ratings' ORDER BY property_id`,
        [ORG],
      )
      expect(properties.rows).toEqual([
        { property_id: HARBOUR, enabled: false, cadence: 'immediate', max_rating: 3 },
        { property_id: RIVERSIDE, enabled: true, cadence: 'daily', max_rating: 3 },
      ])
      const defaults = await client.query(
        `SELECT user_id, channel, enabled, max_rating FROM notification_category_defaults
          WHERE organization_id = $1 AND category = 'low_ratings'`,
        [ORG],
      )
      expect(defaults.rows).toEqual([
        { user_id: OTHER_USER, channel: 'email', enabled: true, max_rating: 3 },
      ])
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })

  it("asks Review for a review item's rating, and never looks one up for feedback", async () => {
    for (const [id, sourceType, sourceId] of [
      [REVIEW_ITEM, 'review', REVIEW],
      [FEEDBACK_ITEM, 'feedback', randomUUID()],
    ]) {
      await pool.query(
        `INSERT INTO inbox_items
           (id, organization_id, property_id, source_type, source_id, source_date,
            platform, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW(), NOW())`,
        [
          id,
          ORG,
          HARBOUR,
          sourceType,
          sourceId,
          sourceType === 'review' ? 'google' : 'portal',
        ],
      )
    }
    const getEligibleRatingById = vi.fn(async () => 2)
    const ratingFor = createReviewRatingForRouting(getDb(), { getEligibleRatingById })

    await expect(
      ratingFor({ organizationId: organizationId(ORG), inboxItemId: REVIEW_ITEM }),
    ).resolves.toBe(2)
    expect(getEligibleRatingById).toHaveBeenCalledWith(REVIEW, ORG)

    getEligibleRatingById.mockClear()
    await expect(
      ratingFor({ organizationId: organizationId(ORG), inboxItemId: FEEDBACK_ITEM }),
    ).resolves.toBeNull()
    // Another Organization's reader never reaches this one's item either.
    await expect(
      ratingFor({
        organizationId: organizationId('org-elsewhere'),
        inboxItemId: REVIEW_ITEM,
      }),
    ).resolves.toBeNull()
    expect(getEligibleRatingById).not.toHaveBeenCalled()
  })
})
