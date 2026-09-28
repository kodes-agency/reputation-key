// Whether an import's review facts have all reached the Inbox, read from the
// outbox receipts the Inbox consumers write. The import summary waits on it
// before it counts what still needs a reply.
import { describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId } from '#/shared/domain/ids'
import type { Database } from '#/shared/db'
import { createInboxItemLookupAdapter } from './inbox-item-lookup.adapter'

const ORG_A = organizationId('b7200000-0000-4000-8000-000000000001')
const ORG_B = organizationId('b7200000-0000-4000-8000-000000000002')
const PROPERTY = 'b7200000-0000-4000-8000-000000000010'
const OTHER_PROPERTY = 'b7200000-0000-4000-8000-000000000011'
const FINISHED_AT = new Date('2026-09-28T10:00:00.000Z')
const BEFORE = new Date(FINISHED_AT.getTime() - 5_000)

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  // Receipts leave with their outbox row (ON DELETE CASCADE).
  tables: ['outbox_events'],
})

const adapter = () =>
  createInboxItemLookupAdapter(drizzle(getPool()) as unknown as Database, {
    findPortalId: vi.fn().mockResolvedValue(null),
  })

const seedFact = async (
  eventType: string,
  at: Date,
  options: Readonly<{ property?: string; receipt?: string }> = {},
) => {
  const {
    rows: [row],
  } = await getPool().query<{ id: string }>(
    `INSERT INTO outbox_events
       (event_type, payload, organization_id, property_id, source_context,
        source_aggregate_id, created_at)
     VALUES ($1, '{}'::jsonb, $2, $3, 'review', 'review-1', $4)
     RETURNING id`,
    [eventType, ORG_A, options.property ?? PROPERTY, at],
  )
  if (options.receipt) {
    await getPool().query(
      `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
       VALUES ($1, $2, 'applied')`,
      [row!.id, options.receipt],
    )
  }
}

const pending = () => adapter().hasPendingReviewProjections(PROPERTY, ORG_A, FINISHED_AT)

describe('createInboxItemLookupAdapter.hasPendingReviewProjections', () => {
  it('waits for a review the Inbox has not projected yet', async () => {
    await seedFact('review.created', BEFORE)

    await expect(pending()).resolves.toBe(true)
  })

  it('waits for a reply observation still retrying to close its item', async () => {
    await seedFact('review.created', BEFORE, { receipt: 'inbox.on-review-created' })
    await seedFact('review.reply.observed', BEFORE)

    await expect(pending()).resolves.toBe(true)
  })

  it('is settled once every earlier review fact carries its Inbox receipt', async () => {
    await seedFact('review.created', BEFORE, { receipt: 'inbox.on-review-created' })
    await seedFact('review.updated', BEFORE, { receipt: 'inbox.on-review-updated' })
    await seedFact('review.reply.observed', BEFORE, {
      receipt: 'inbox.on-reply-observed',
    })

    await expect(pending()).resolves.toBe(false)
  })

  it('ignores later facts, other Properties, other consumers and stuck history', async () => {
    await seedFact('review.created', new Date(FINISHED_AT.getTime() + 1_000))
    await seedFact('review.created', BEFORE, { property: OTHER_PROPERTY })
    await seedFact('review.created', BEFORE, { receipt: 'ai.on-review-created' })
    await seedFact('review.created', new Date(FINISHED_AT.getTime() - 2 * 3_600_000))

    // Only the fact another consumer settled is this Property's, and the
    // Inbox has not settled it.
    await expect(pending()).resolves.toBe(true)
    await getPool().query(
      `DELETE FROM outbox_events WHERE organization_id = $1
          AND id IN (SELECT event_id FROM event_consumer_receipts
                      WHERE consumer_name = 'ai.on-review-created')`,
      [ORG_A],
    )
    await expect(pending()).resolves.toBe(false)
  })
})
