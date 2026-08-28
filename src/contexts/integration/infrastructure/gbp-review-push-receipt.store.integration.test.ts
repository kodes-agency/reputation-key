import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { getDb } from '#/shared/db'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { integrationGoogleReviewPushAccepted } from '../domain/events'
import { createGbpReviewPushReceiptStore } from './gbp-review-push-receipt.store'

const TOPIC = 'projects/repkey-test/topics/gbp-push-receipt-test'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000061'
const CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000062')
const ORGANIZATION_ID = organizationId('org-gbp-push-receipt-test')
const AT = new Date('2026-08-27T08:00:00.000Z')

function event(referenceRef: string | null) {
  return integrationGoogleReviewPushAccepted({
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    connectionId: CONNECTION_ID,
    sourceEpoch: 4,
    referenceRef,
    notificationKind: 'NEW_REVIEW',
    occurredAt: AT,
  })
}

describe('PostgreSQL GBP review push receipt store', () => {
  let lease: TestLease

  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    await lease.pool.query('DELETE FROM inbound_webhook_receipts WHERE topic = $1', [
      TOPIC,
    ])
    await lease.pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
      ORGANIZATION_ID,
    ])
  })

  afterAll(async () => {
    await lease?.pool.query('DELETE FROM inbound_webhook_receipts WHERE topic = $1', [
      TOPIC,
    ])
    await lease?.pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
      ORGANIZATION_ID,
    ])
    await lease?.release()
  })

  it('commits one receipt and one handoff fact for duplicate Pub/Sub delivery', async () => {
    const store = createGbpReviewPushReceiptStore(getDb())
    const accepted = event(`v1.${Buffer.alloc(32, 7).toString('base64url')}`)
    const input = {
      topic: TOPIC,
      messageId: 'message-duplicate-1',
      receivedAt: AT,
      acceptedAt: AT,
      notificationKind: 'NEW_REVIEW',
      resolvedPropertyId: PROPERTY_ID,
      outcome: 'accepted_targeted' as const,
      event: accepted,
    }

    await expect(store.record(input)).resolves.toEqual({ status: 'recorded' })
    await expect(store.record({ ...input, event: event(null) })).resolves.toEqual({
      status: 'duplicate',
    })

    const receipt = await lease.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM inbound_webhook_receipts WHERE provider = $1 AND topic = $2 AND message_id = $3',
      ['google', TOPIC, input.messageId],
    )
    const outbox = await lease.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM outbox_events WHERE id = $1',
      [accepted.eventId],
    )
    expect(receipt.rows[0]?.count).toBe('1')
    expect(outbox.rows[0]?.count).toBe('1')
  })

  it('rolls the receipt back when the identifier-only event is invalid', async () => {
    const store = createGbpReviewPushReceiptStore(getDb())
    const invalid = {
      ...event(null),
      referenceRef: 'accounts/provider/content',
    } as unknown as ReturnType<typeof event>

    await expect(
      store.record({
        topic: TOPIC,
        messageId: 'message-invalid-event',
        receivedAt: AT,
        acceptedAt: AT,
        notificationKind: 'NEW_REVIEW',
        resolvedPropertyId: PROPERTY_ID,
        outcome: 'accepted_targeted',
        event: invalid,
      }),
    ).rejects.toThrow('failed schema allowlist')

    const receipt = await lease.pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM inbound_webhook_receipts WHERE provider = $1 AND topic = $2 AND message_id = $3',
      ['google', TOPIC, 'message-invalid-event'],
    )
    expect(receipt.rows[0]?.count).toBe('0')
  })
})
