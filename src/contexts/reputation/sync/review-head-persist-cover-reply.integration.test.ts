// What a persisting head check does with the cover on the Property's sync state
// and with a reply written on Google, against real PostgreSQL. Setup is shared
// with review-head-persist.integration.test.ts.

import { reviewOpeningAnchor } from '../inbox/review-opening-anchor.test-fixtures'
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { inboxItemStatusChanged } from '#/contexts/reputation/domain/inbox-events'
import type { InboxItem } from '#/contexts/reputation/domain/inbox-types'
import { createAtomicInboxCommandStore } from '#/contexts/reputation/inbox/command-store.server'
import { createReviewReplyObservationAuthority } from '#/contexts/reputation/reviews/reply-observation-authority.server'
import {
  DAY_MS,
  INBOX_ITEM,
  ORG,
  PROPERTY,
  clock,
  db,
  headCheck,
  insertFact,
  observeEarlier,
  providerReview,
  useHeadPersistDatabase,
} from './review-head-persist.test-fixtures'

useHeadPersistDatabase()

describe('the head cover a persisting check keeps (real PostgreSQL)', () => {
  const syncRow = async () =>
    (
      await db.execute(sql`
        SELECT head_covered_at, full_read_requested_at FROM review_sync_state
        WHERE property_id = ${PROPERTY} AND source = 'google'
      `)
    ).rows.at(0)
  const datedBySweep = () =>
    db.execute(sql`
      INSERT INTO review_sync_state (property_id, source, next_incremental_at)
      VALUES (${PROPERTY}, 'google', now() + interval '15 minutes')
    `)

  it('renews the cover only when the whole page was stored', async () => {
    await datedBySweep()
    await insertFact({ count: 0, average: null, listingComplete: false })

    await headCheck([providerReview('fresh')], { total: 1, average: 4 })
    expect(await syncRow()).toEqual({
      head_covered_at: null,
      full_read_requested_at: null,
    })

    await insertFact({ count: 0, average: null })
    await headCheck([providerReview('first'), providerReview('second')], {
      total: 2,
      average: 4,
      failPersistOf: 'head-persist-second',
    })
    expect(await syncRow()).toEqual({
      head_covered_at: null,
      full_read_requested_at: null,
    })

    const { result } = await headCheck(
      [providerReview('first'), providerReview('second')],
      { total: 2, average: 4 },
    )
    expect(result).toMatchObject({ persistence: { outcome: 'stored', failed: 0 } })
    expect((await syncRow())?.head_covered_at).not.toBeNull()
    expect((await syncRow())?.full_read_requested_at).toBeNull()
  })

  it('renews nothing in dark mode', async () => {
    await datedBySweep()
    await insertFact({ count: 0, average: null })

    await headCheck([providerReview('fresh')], { total: 1, average: 4, mode: 'dark' })

    expect(await syncRow()).toEqual({
      head_covered_at: null,
      full_read_requested_at: null,
    })
  })

  it('asks for a full read instead when every review on the page changed and more pages follow', async () => {
    await datedBySweep()
    await insertFact({ count: 0, average: null })

    await headCheck([providerReview('one'), providerReview('two')], {
      total: 60,
      average: 4,
      hasMore: true,
    })

    const row = await syncRow()
    expect(row?.head_covered_at).toBeNull()
    expect(row?.full_read_requested_at).not.toBeNull()
  })
})

describe('a reply written on Google, seen by a head check (real PostgreSQL)', () => {
  const buildItem = (): InboxItem => ({
    id: INBOX_ITEM,
    organizationId: ORG,
    propertyId: PROPERTY,
    sourceType: 'review',
    sourceId: '' as never,
    status: 'open',
    rating: 4,
    sourceDate: new Date(),
    platform: 'google',
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  it('closes the Inbox item through the reply observation event', async () => {
    const earlier = new Date(Date.now() - 2 * DAY_MS)
    const unanswered = providerReview('unanswered')
    const seen = await observeEarlier(unanswered, earlier)
    await insertFact({ count: 1, average: 4 })
    clock.at = new Date()
    const allowAll = async () => ({ allowed: true as const })
    const inboxStore = createAtomicInboxCommandStore(db, allowAll, () => clock.at)
    const item: InboxItem = { ...buildItem(), sourceId: seen.reviewId as never }
    await inboxStore.createItem(
      item,
      null,
      reviewOpeningAnchor(item, seen.sourceRevision),
    )

    const { result } = await headCheck(
      [
        {
          ...unanswered,
          replyText: 'Thank you for staying with us',
          replyUpdatedAt: new Date(clock.at.getTime() - 30_000),
        },
      ],
      { total: 1, average: 4 },
    )

    expect(result).toMatchObject({
      persistence: { outcome: 'stored', storedNew: 0, storedOther: 1, failed: 0 },
    })
    const events = await db.execute(sql`
      SELECT id, payload FROM outbox_events
      WHERE organization_id = ${ORG} AND event_type = 'review.reply.observed'
      ORDER BY created_at DESC
    `)
    expect(events.rows).toHaveLength(1)
    const observed = events.rows[0]?.payload as Record<string, unknown>
    expect(observed).toMatchObject({
      change: 'added',
      resolution: 'external_current_live',
    })

    // The Inbox consumer's own step, from the event the head check published.
    const authority = createReviewReplyObservationAuthority(db)
    const expectation = {
      organizationId: ORG,
      reviewId: seen.reviewId,
      propertyId: PROPERTY,
      observationRevision: Number(observed.observationRevision),
      sourceEpoch: Number(observed.sourceEpoch),
      materialReviewRevision: Number(observed.materialReviewRevision),
      change: observed.change,
      resolution: observed.resolution,
      provenance: observed.provenance,
      matchedReplyId: null,
      matchedPublicationCycle: null,
      occurredAt: new Date(String(observed.occurredAt)),
    } as never
    const applied = await authority.withExactCurrent(expectation, (permit) =>
      inboxStore.applyReplyObservedOnce({
        eventId: String(events.rows[0]?.id),
        consumerName: 'inbox.on-reply-observed',
        item,
        currentObservation: permit,
        closeFact: inboxItemStatusChanged({
          inboxItemId: INBOX_ITEM,
          organizationId: ORG,
          propertyId: PROPERTY,
          oldStatus: 'open',
          newStatus: 'closed',
          occurredAt: clock.at,
        }),
        reopenFact: inboxItemStatusChanged({
          inboxItemId: INBOX_ITEM,
          organizationId: ORG,
          propertyId: PROPERTY,
          oldStatus: 'closed',
          newStatus: 'open',
          occurredAt: clock.at,
        }),
      }),
    )
    expect(applied.status).toBe('current')
    const closed = await db.execute(sql`
      SELECT status FROM inbox_items WHERE id = ${INBOX_ITEM}
    `)
    expect(closed.rows).toEqual([{ status: 'closed' }])
  })
})
