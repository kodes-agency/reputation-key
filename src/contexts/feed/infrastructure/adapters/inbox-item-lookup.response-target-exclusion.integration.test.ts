import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  GUEST_UPDATE_TIME,
  cleanRestatedRevisionScope,
  excludeCycle,
  seedOrdinaryItem,
  seedRestatedRevisionItem,
  seedScope,
} from '#/shared/testing/restated-revision-fixtures'
import { createInboxItemLookupAdapter } from './inbox-item-lookup.adapter'

const ORG = organizationId('org-feed-target-exclusion')
const PROPERTY = propertyId('e8c30000-0000-4000-8000-000000000001')
const RESTATED_ITEM = inboxItemId('e8c30000-0000-4000-8000-000000000101')
const SIBLING_ITEM = inboxItemId('e8c30000-0000-4000-8000-000000000102')
const RESTATED_REVIEW = reviewId('e8c30000-0000-4000-8000-000000000201')
const SIBLING_REVIEW = reviewId('e8c30000-0000-4000-8000-000000000202')

const SIBLING_START = new Date('2026-10-18T09:00:00.000Z')
const TARGET_MS = 2880 * 60_000

const db = getDb()
let pool: Pool

const lookup = () =>
  createInboxItemLookupAdapter(db, { findPortalId: vi.fn().mockResolvedValue(null) })

const passedReminder = (
  item: typeof RESTATED_ITEM,
  cycleNumber: number,
  start: Date,
) => ({
  inboxItemId: item,
  organizationId: ORG,
  cycleNumber,
  targetKind: 'google_review_response' as const,
  reminderKind: 'target_passed' as const,
  scheduledFor: new Date(start.getTime() + TARGET_MS),
})

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
})

afterAll(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await pool.end()
})

beforeEach(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await seedScope(pool, {
    organizationId: ORG,
    slug: 'feed-target-exclusion',
    at: GUEST_UPDATE_TIME,
    properties: [{ id: PROPERTY, name: 'Feed Property', slug: 'feed-property' }],
  })
  await seedRestatedRevisionItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: RESTATED_REVIEW,
    itemId: RESTATED_ITEM,
    outcome: 'open',
  })
  await seedOrdinaryItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: SIBLING_REVIEW,
    itemId: SIBLING_ITEM,
    startAt: SIBLING_START,
    outcome: 'open',
  })
})

describe.sequential(
  'Feed reads skip a Response Target left out of reporting (PostgreSQL)',
  () => {
    it('measures no waiting time for an excluded cycle and keeps measuring its sibling', async () => {
      const before = await lookup().findWaitingSince(RESTATED_ITEM, ORG)
      await excludeCycle(pool, {
        organizationId: ORG,
        propertyId: PROPERTY,
        itemId: RESTATED_ITEM,
        cycleNumber: 2,
      })
      const after = await lookup().findWaitingSince(RESTATED_ITEM, ORG)
      const sibling = await lookup().findWaitingSince(SIBLING_ITEM, ORG)

      expect(before).toEqual(GUEST_UPDATE_TIME)
      expect(after).toBeNull()
      expect(sibling).toEqual(SIBLING_START)
    })

    it('treats a delivered reminder of an excluded cycle as obsolete and still admits the sibling', async () => {
      const restated = passedReminder(RESTATED_ITEM, 2, GUEST_UPDATE_TIME)
      const sibling = passedReminder(SIBLING_ITEM, 1, SIBLING_START)

      const before = await lookup().findResponseTargetReminderNotificationFacts(restated)
      await excludeCycle(pool, {
        organizationId: ORG,
        propertyId: PROPERTY,
        itemId: RESTATED_ITEM,
        cycleNumber: 2,
      })
      const after = await lookup().findResponseTargetReminderNotificationFacts(restated)
      const admitted = await lookup().findResponseTargetReminderNotificationFacts(sibling)

      expect(before).toMatchObject({ currentCycleNumber: 2, status: 'open' })
      expect(after).toBeNull()
      expect(admitted).toMatchObject({ currentCycleNumber: 1, status: 'open' })
    })
  },
)
