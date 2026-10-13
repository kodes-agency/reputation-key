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
/** A second Organization holding the same Google location. */
const OTHER_PROPERTY_ID = '00000000-0000-4000-8000-000000000071'
const OTHER_CONNECTION_ID = googleConnectionId('00000000-0000-4000-8000-000000000072')
const OTHER_ORGANIZATION_ID = organizationId('org-gbp-push-receipt-test-other')
const ORGANIZATION_IDS = [ORGANIZATION_ID, OTHER_ORGANIZATION_ID]
const AT = new Date('2026-08-27T08:00:00.000Z')
const REFERENCE_REF = `v1.${Buffer.alloc(32, 7).toString('base64url')}`

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

function otherEvent(referenceRef: string | null) {
  return integrationGoogleReviewPushAccepted({
    organizationId: OTHER_ORGANIZATION_ID,
    propertyId: OTHER_PROPERTY_ID,
    connectionId: OTHER_CONNECTION_ID,
    sourceEpoch: 9,
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
    await lease.pool.query(
      `DELETE FROM idempotency_receipts WHERE scope = 'gbp_webhook'
         AND payload->>'topic' = $1`,
      [TOPIC],
    )
    await lease.pool.query('DELETE FROM outbox_events WHERE organization_id = ANY($1)', [
      ORGANIZATION_IDS,
    ])
  })

  afterAll(async () => {
    await lease?.pool.query(
      `DELETE FROM idempotency_receipts WHERE scope = 'gbp_webhook'
         AND payload->>'topic' = $1`,
      [TOPIC],
    )
    await lease?.pool.query('DELETE FROM outbox_events WHERE organization_id = ANY($1)', [
      ORGANIZATION_IDS,
    ])
    await lease?.release()
  })

  it('commits one receipt and one handoff fact for duplicate Pub/Sub delivery', async () => {
    const store = createGbpReviewPushReceiptStore(getDb())
    const accepted = event(REFERENCE_REF)
    const input = {
      topic: TOPIC,
      messageId: 'message-duplicate-1',
      receivedAt: AT,
      acceptedAt: AT,
      notificationKind: 'NEW_REVIEW',
    }
    const delivery = {
      resolvedPropertyId: PROPERTY_ID,
      outcome: 'accepted_targeted' as const,
    }

    await expect(
      store.record({ ...input, deliveries: [{ ...delivery, event: accepted }] }),
    ).resolves.toEqual({ status: 'recorded' })
    await expect(
      store.record({ ...input, deliveries: [{ ...delivery, event: event(null) }] }),
    ).resolves.toEqual({ status: 'duplicate' })

    const receipt = await lease.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM idempotency_receipts
       WHERE scope = 'gbp_webhook'
         AND payload->>'provider' = $1
         AND payload->>'topic' = $2
         AND payload->>'messageId' = $3`,
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
        deliveries: [
          {
            resolvedPropertyId: PROPERTY_ID,
            outcome: 'accepted_targeted',
            event: invalid,
          },
        ],
      }),
    ).rejects.toThrow('failed schema allowlist')

    const receipt = await lease.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM idempotency_receipts
       WHERE scope = 'gbp_webhook'
         AND payload->>'provider' = $1
         AND payload->>'topic' = $2
         AND payload->>'messageId' = $3`,
      ['google', TOPIC, 'message-invalid-event'],
    )
    expect(receipt.rows[0]?.count).toBe('0')
  })

  const receiptRows = async (messageId: string) => {
    const result = await lease.pool.query<{
      key: string
      property_id: string | null
      outcome: string
    }>(
      `SELECT key, payload->>'resolvedPropertyId' AS property_id,
              payload->>'outcome' AS outcome
       FROM idempotency_receipts
       WHERE scope = 'gbp_webhook'
         AND payload->>'topic' = $1
         AND payload->>'messageId' = $2
       ORDER BY payload->>'resolvedPropertyId'`,
      [TOPIC, messageId],
    )
    return result.rows
  }

  const handoffFacts = async (eventIds: readonly string[]) => {
    const result = await lease.pool.query<{ organization_id: string }>(
      `SELECT organization_id FROM outbox_events
       WHERE id = ANY($1::uuid[]) ORDER BY organization_id`,
      [eventIds],
    )
    return result.rows.map((row) => row.organization_id)
  }

  it('commits a receipt row and a handoff fact for each Property one message is for', async () => {
    const store = createGbpReviewPushReceiptStore(getDb())
    const first = event(REFERENCE_REF)
    const second = otherEvent(null)
    const input = {
      topic: TOPIC,
      messageId: 'message-two-properties',
      receivedAt: AT,
      acceptedAt: AT,
      notificationKind: 'NEW_REVIEW',
      deliveries: [
        {
          resolvedPropertyId: PROPERTY_ID,
          outcome: 'accepted_targeted',
          event: first,
        },
        {
          resolvedPropertyId: OTHER_PROPERTY_ID,
          outcome: 'accepted_reconciliation',
          event: second,
        },
      ],
    } as const

    await expect(store.record(input)).resolves.toEqual({ status: 'recorded' })
    // Redelivery is decided by the message's own row, for every delivery at once.
    await expect(store.record(input)).resolves.toEqual({ status: 'duplicate' })

    // Each row names exactly one Property: an Organization purge deletes by it.
    expect(await receiptRows(input.messageId)).toEqual([
      {
        key: JSON.stringify(['google', TOPIC, input.messageId]),
        property_id: PROPERTY_ID,
        outcome: 'accepted_targeted',
      },
      {
        key: JSON.stringify(['google', TOPIC, input.messageId, OTHER_PROPERTY_ID]),
        property_id: OTHER_PROPERTY_ID,
        outcome: 'accepted_reconciliation',
      },
    ])
    expect(await handoffFacts([first.eventId, second.eventId])).toEqual([
      ORGANIZATION_ID,
      OTHER_ORGANIZATION_ID,
    ])
  })

  it('commits nothing for any Property when one handoff fact is invalid', async () => {
    const store = createGbpReviewPushReceiptStore(getDb())
    const valid = event(REFERENCE_REF)
    const invalid = {
      ...otherEvent(null),
      referenceRef: 'accounts/provider/content',
    } as unknown as ReturnType<typeof otherEvent>

    await expect(
      store.record({
        topic: TOPIC,
        messageId: 'message-two-properties-invalid',
        receivedAt: AT,
        acceptedAt: AT,
        notificationKind: 'NEW_REVIEW',
        deliveries: [
          {
            resolvedPropertyId: PROPERTY_ID,
            outcome: 'accepted_targeted',
            event: valid,
          },
          {
            resolvedPropertyId: OTHER_PROPERTY_ID,
            outcome: 'accepted_targeted',
            event: invalid,
          },
        ],
      }),
    ).rejects.toThrow('failed schema allowlist')

    expect(await receiptRows('message-two-properties-invalid')).toEqual([])
    expect(await handoffFacts([valid.eventId])).toEqual([])
  })
})
