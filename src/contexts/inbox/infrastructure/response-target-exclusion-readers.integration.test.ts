import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { inboxItemId, organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import {
  GUEST_UPDATE_TIME,
  cleanRestatedRevisionScope,
  excludeCycle,
  seedOrdinaryItem,
  seedRestatedRevisionItem,
  seedScope,
} from '#/shared/testing/restated-revision-fixtures'
import { completeGoogleReviewTarget } from './google-review-target-completion'
import { createResponseTargetStore } from './response-target.store'

const ORG = organizationId('org-target-exclusion-readers')
const PROPERTY = propertyId('e8c20000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('e8c20000-0000-4000-8000-000000000002')

const OPEN_RESTATED = inboxItemId('e8c20000-0000-4000-8000-000000000101')
const LATE_RESTATED = inboxItemId('e8c20000-0000-4000-8000-000000000102')
const ON_TIME_RESTATED = inboxItemId('e8c20000-0000-4000-8000-000000000103')
const OPEN_SIBLING = inboxItemId('e8c20000-0000-4000-8000-000000000104')
const LATE_SIBLING = inboxItemId('e8c20000-0000-4000-8000-000000000105')
const OTHER_PROPERTY_RESTATED = inboxItemId('e8c20000-0000-4000-8000-000000000106')

const REVIEW = (suffix: number) =>
  reviewId(`e8c20000-0000-4000-8000-0000000002${suffix.toString().padStart(2, '0')}`)

const NOW = new Date('2026-10-23T12:00:00.000Z')
const SIBLING_OPEN_START = new Date('2026-10-18T09:00:00.000Z')
const SIBLING_LATE_START = new Date('2026-10-10T09:00:00.000Z')
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

const db = getDb()
let pool: Pool

const asScope = (item: typeof OPEN_RESTATED, property = PROPERTY) => ({
  organizationId: ORG,
  propertyId: property,
  itemId: item,
  cycleNumber: 2,
})

async function seedBetaShapedScope(): Promise<void> {
  await seedScope(pool, {
    organizationId: ORG,
    slug: 'target-exclusion-readers',
    at: GUEST_UPDATE_TIME,
    properties: [
      { id: PROPERTY, name: 'Excluded Property', slug: 'excluded-property' },
      { id: OTHER_PROPERTY, name: 'Other Property', slug: 'other-property' },
    ],
  })
  const restated = [
    [OPEN_RESTATED, REVIEW(1), 'open'],
    [LATE_RESTATED, REVIEW(2), 'late'],
    [ON_TIME_RESTATED, REVIEW(3), 'on_time'],
  ] as const
  for (const [itemId, review, outcome] of restated) {
    await seedRestatedRevisionItem(pool, {
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: review,
      itemId,
      outcome,
    })
  }
  await seedRestatedRevisionItem(pool, {
    organizationId: ORG,
    propertyId: OTHER_PROPERTY,
    reviewId: REVIEW(6),
    itemId: OTHER_PROPERTY_RESTATED,
    outcome: 'open',
  })
  await seedOrdinaryItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW(4),
    itemId: OPEN_SIBLING,
    startAt: SIBLING_OPEN_START,
    outcome: 'open',
  })
  await seedOrdinaryItem(pool, {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: REVIEW(5),
    itemId: LATE_SIBLING,
    startAt: SIBLING_LATE_START,
    outcome: 'late',
  })
}

async function excludeEveryRestatedCycle(): Promise<void> {
  for (const item of [OPEN_RESTATED, LATE_RESTATED, ON_TIME_RESTATED]) {
    await excludeCycle(pool, asScope(item))
  }
  await excludeCycle(pool, asScope(OTHER_PROPERTY_RESTATED, OTHER_PROPERTY))
}

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await pool.end()
  clearEventSchemas()
})

beforeEach(async () => {
  await cleanRestatedRevisionScope(pool, ORG)
  await seedBetaShapedScope()
})

describe.sequential('Response Target readers skip excluded cycles (PostgreSQL)', () => {
  it('drops excluded cycles out of every Google analytics bucket and keeps their siblings', async () => {
    const store = createResponseTargetStore(db)
    const before = await store.getGoogleReviewAnalytics({
      organizationId: ORG,
      propertyIds: null,
      now: NOW,
    })
    // The late sibling's reply came 60 hours after its start.
    const siblingMinutes = (60 * HOUR_MS) / MINUTE_MS

    await excludeEveryRestatedCycle()
    const after = await store.getGoogleReviewAnalytics({
      organizationId: ORG,
      propertyIds: null,
      now: NOW,
    })

    expect(before).toMatchObject({
      measuredCycleCount: 6,
      activeCount: 3,
      currentOverdueCount: 3,
      respondedOnTimeCount: 1,
      respondedLateCount: 2,
      historicalOnboardingExcludedCount: 4,
    })
    expect(after).toMatchObject({
      measuredCycleCount: 2,
      activeCount: 1,
      currentOverdueCount: 1,
      respondedOnTimeCount: 0,
      respondedLateCount: 1,
      reopenCount: 0,
      // Cycle 1 of each restated item is another cycle and keeps its own bucket.
      historicalOnboardingExcludedCount: 4,
    })
    expect(after.averageTimeToResponseMinutes).toBeCloseTo(siblingMinutes, 1)
    expect(before.averageTimeToResponseMinutes).not.toBeCloseTo(siblingMinutes, 1)
  })

  it('drops an excluded onboarding-history cycle out of the excluded counts too', async () => {
    const store = createResponseTargetStore(db)
    const scope = { organizationId: ORG, propertyIds: null, now: NOW }
    const before = await store.getGoogleReviewAnalytics(scope)

    await excludeCycle(pool, { ...asScope(OPEN_RESTATED), cycleNumber: 1 })
    const after = await store.getGoogleReviewAnalytics(scope)

    expect(before.historicalOnboardingExcludedCount).toBe(4)
    expect(after.historicalOnboardingExcludedCount).toBe(3)
    expect(after.measuredCycleCount).toBe(before.measuredCycleCount)
  })

  it('leaves an excluded cycle out of the per-Property overdue figures', async () => {
    const store = createResponseTargetStore(db)
    const scope = {
      organizationId: ORG,
      propertyIds: [PROPERTY, OTHER_PROPERTY],
      now: NOW,
    }
    const before = await store.getGoogleReviewTargetCountsByProperty(scope)

    await excludeEveryRestatedCycle()
    const after = await store.getGoogleReviewTargetCountsByProperty(scope)

    expect(before).toEqual(
      new Map([
        [PROPERTY, { activeCount: 2, overdueCount: 2 }],
        [OTHER_PROPERTY, { activeCount: 1, overdueCount: 1 }],
      ]),
    )
    expect(after).toEqual(
      new Map([
        [PROPERTY, { activeCount: 1, overdueCount: 1 }],
        [OTHER_PROPERTY, { activeCount: 0, overdueCount: 0 }],
      ]),
    )
  })

  it('reads an excluded cycle as not measured and a sibling as the live countdown it is', async () => {
    const store = createResponseTargetStore(db)
    await excludeCycle(pool, asScope(OPEN_RESTATED))
    await excludeCycle(pool, asScope(LATE_RESTATED))

    const open = await store.getCycleTarget(OPEN_RESTATED, ORG, NOW)
    const closed = await store.getCycleTarget(LATE_RESTATED, ORG, NOW)
    const unexcluded = await store.getCycleTarget(ON_TIME_RESTATED, ORG, NOW)
    const sibling = await store.getCycleTarget(OPEN_SIBLING, ORG, NOW)

    expect(open).toMatchObject({
      excludedFromReporting: true,
      evaluation: { state: 'excluded', overdue: false, elapsedMinutes: null },
    })
    expect(closed).toMatchObject({
      excludedFromReporting: true,
      evaluation: { state: 'excluded', overdue: false },
    })
    expect(unexcluded).toMatchObject({
      excludedFromReporting: false,
      evaluation: { state: 'completed' },
    })
    expect(sibling).toMatchObject({
      excludedFromReporting: false,
      evaluation: { state: 'active', overdue: true },
    })
  })

  it('still closes an excluded open cycle on a real reply, and keeps the completion out of the figures', async () => {
    const store = createResponseTargetStore(db)
    await excludeCycle(pool, asScope(OPEN_RESTATED))
    const repliedAt = new Date('2026-10-23T11:00:00.000Z')

    const completion = await db.transaction((tx) =>
      completeGoogleReviewTarget(
        tx,
        {
          inboxItemId: OPEN_RESTATED,
          organizationId: ORG,
          propertyId: PROPERTY,
          sourceType: 'review',
          sourceId: REVIEW(1),
          currentCycleNumber: 2,
          currentSourceRevision: 2,
          stateRevision: 2,
          status: 'open',
        },
        NOW,
        repliedAt,
      ),
    )
    const stored = await pool.query<{ result: string; stop_reason: string }>(
      `SELECT result, stop_reason FROM inbox_handling_cycle_response_targets
        WHERE inbox_item_id = $1 AND cycle_number = 2 AND organization_id = $2`,
      [OPEN_RESTATED, ORG],
    )
    const exclusions = await pool.query(
      `SELECT 1 FROM inbox_response_target_exclusions
        WHERE inbox_item_id = $1 AND cycle_number = 2 AND organization_id = $2`,
      [OPEN_RESTATED, ORG],
    )
    const analytics = await store.getGoogleReviewAnalytics({
      organizationId: ORG,
      propertyIds: [PROPERTY],
      now: NOW,
    })

    expect(completion).toEqual({ result: 'late', completedAt: repliedAt })
    expect(stored.rows).toEqual([{ result: 'late', stop_reason: 'confirmed_on_google' }])
    expect(exclusions.rowCount).toBe(1)
    // The three restated cycles of this Property still count except the excluded one.
    expect(analytics.respondedLateCount).toBe(2)
    expect(analytics.activeCount).toBe(1)
  })

  it('does not select the reminder slot of an excluded cycle while a sibling slot is still due', async () => {
    await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG])
    await seedRestatedRevisionItem(pool, {
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW(11),
      itemId: OPEN_RESTATED,
      outcome: 'open',
      targetPassedPending: true,
    })
    await seedOrdinaryItem(pool, {
      organizationId: ORG,
      propertyId: PROPERTY,
      reviewId: REVIEW(12),
      itemId: OPEN_SIBLING,
      startAt: SIBLING_OPEN_START,
      outcome: 'open',
      targetPassedPending: true,
    })
    const store = createResponseTargetStore(db)
    const due = async () =>
      (await store.listDueReminderCandidates({ now: NOW, limit: 100 })).filter(
        (slot) => slot.organizationId === ORG,
      )

    const before = await due()
    await excludeCycle(pool, asScope(OPEN_RESTATED))
    const after = await due()
    const excluded = await store.releaseReminderSlot({
      key: { inboxItemId: OPEN_RESTATED, cycleNumber: 2, reminderKind: 'target_passed' },
      now: NOW,
    })
    const sibling = await store.releaseReminderSlot({
      key: { inboxItemId: OPEN_SIBLING, cycleNumber: 1, reminderKind: 'target_passed' },
      now: NOW,
    })

    expect(before.map((slot) => slot.key.inboxItemId).sort()).toEqual(
      [OPEN_RESTATED, OPEN_SIBLING].sort(),
    )
    expect(after.map((slot) => slot.key.inboxItemId)).toEqual([OPEN_SIBLING])
    expect(excluded).toBe('skipped')
    expect(sibling).toBe('released')
  })
})
