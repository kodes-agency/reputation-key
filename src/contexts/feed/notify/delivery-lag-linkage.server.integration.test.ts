import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { readNotificationDeliveryLag } from './delivery-lag.server'

/** Generous for these small reads; the timeout suite pins the cancellation. */
const STATEMENT_TIMEOUT_MS = 10_000

// Each immediate email is linked to its durable source by outbox event id.
// Joined as `source_event.id::text = notification.event_id`, the uuid primary
// key could not serve the join: with the email⋈notification join estimated at
// one row, the planner walked the Organization's whole outbox for every email
// (loops = emails × that Organization's events) — seconds at a few hundred
// emails, past the health section's budget, so the signal degraded and every
// alert reading it went blind exactly when volume was highest.
const PLAN_ORG_PREFIX = 'notification-delivery-lag-plan-org-'
const PLAN_ORG_COUNT = 20
const PLAN_EVENTS_PER_ORG = 12_000
const PLAN_LINKED_EMAILS = 500
const PLAN_ORG = organizationId(`${PLAN_ORG_PREFIX}0`)
const PLAN_PROPERTY = propertyId('85000000-0000-4000-8000-000000000001')
const PLAN_WINDOW_END = new Date('2026-08-29T08:00:00.000Z')
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS
/**
 * Event ids that are not uuids. Each must read as unlinked — never reach the
 * `::uuid` cast, which would throw and fail the whole signal: 36 dashes and a
 * uuid-shaped id with a non-hex digit pass a loose character-class guard.
 */
const UNLINKABLE_EVENT_IDS = [
  '-'.repeat(36),
  'not-an-outbox-event-id',
  '85000000-0000-4000-8000-00000000000g',
]

type PlanNode = Readonly<{ [key: string]: unknown; Plans?: readonly PlanNode[] }>
const planNodes = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(planNodes),
]

describe.sequential('immediate-email source linkage at volume (real PostgreSQL)', () => {
  // Written inside one held transaction and rolled back: 240k outbox rows are
  // never committed, and the ANALYZE that gives the planner production-like
  // statistics is rolled back with them.
  let fixture: HeldTransaction | undefined
  const statements: Array<Readonly<{ query: string; params: unknown[] }>> = []

  beforeAll(async () => {
    fixture = await holdTransaction({
      logger: { logQuery: (query, params) => statements.push({ query, params }) },
    })
    const { client } = fixture
    await client.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Delivery Lag Plan Property', 'notification-delivery-lag-plan', 'UTC')`,
      [PLAN_PROPERTY, PLAN_ORG],
    )
    // Thirty days of unrelated outbox history for each of twenty Organizations.
    await client.query(
      `INSERT INTO outbox_events (
         event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id, created_at, published_at
       )
       SELECT 'ops.delivery-lag-plan.filler', 1, '{}'::jsonb,
         $1::text || (n % $2::int)::text, NULL, 'ops', 'delivery-lag-plan-filler',
         $3::timestamptz - (n / $2::int) * ($4::int * INTERVAL '1 millisecond'),
         $3::timestamptz - (n / $2::int) * ($4::int * INTERVAL '1 millisecond')
       FROM generate_series(0, $5::int - 1) AS n`,
      [
        PLAN_ORG_PREFIX,
        PLAN_ORG_COUNT,
        PLAN_WINDOW_END,
        (30 * DAY_MS) / PLAN_EVENTS_PER_ORG,
        PLAN_ORG_COUNT * PLAN_EVENTS_PER_ORG,
      ],
    )
    // One Organization's urgent notices, each emailed immediately and linked
    // to its routed source fact.
    await client.query(
      `WITH source AS (
         INSERT INTO outbox_events (
           event_type, event_version, payload, organization_id, property_id,
           source_context, source_aggregate_id, created_at, published_at
         )
         SELECT 'review.reply.publish_failed', 1, '{}'::jsonb, $1::text, $2::text,
           'review', 'delivery-lag-plan-source-' || n,
           $3::timestamptz - n * INTERVAL '1 minute',
           $3::timestamptz - n * INTERVAL '1 minute'
         FROM generate_series(1, $4::int) AS n
         RETURNING id::text AS event_id, created_at
       ),
       notice AS (
         INSERT INTO notifications (
           user_id, organization_id, property_id, type, category, priority, status,
           resource_type, resource_id, event_id, title, payload, created_at, updated_at
         )
         SELECT 'delivery-lag-plan-user', $1::text, $5::uuid, 'reply.publish_failed',
           'urgent_operational', 'urgent', 'unread', 'inbox_item', gen_random_uuid()::text,
           source.event_id, 'Linked at volume', '{}'::jsonb, source.created_at, source.created_at
         FROM source
         RETURNING id, created_at
       )
       INSERT INTO notification_email_queue (
         notification_id, user_id, organization_id, property_id, category, cadence,
         status, priority, idempotency_key, created_at, updated_at
       )
       SELECT notice.id, 'delivery-lag-plan-user', $1::text, $5::uuid, 'urgent_operational',
         'immediate', 'pending', 'urgent', 'delivery-lag-plan-' || notice.id,
         notice.created_at, notice.created_at
       FROM notice`,
      [PLAN_ORG, PLAN_PROPERTY, PLAN_WINDOW_END, PLAN_LINKED_EMAILS, PLAN_PROPERTY],
    )
    await client.query(
      `WITH notice AS (
         INSERT INTO notifications (
           user_id, organization_id, property_id, type, category, priority, status,
           resource_type, resource_id, event_id, title, payload, created_at, updated_at
         )
         SELECT 'delivery-lag-plan-user', $1::text, $2::uuid, 'reply.publish_failed',
           'urgent_operational', 'urgent', 'unread', 'inbox_item', gen_random_uuid()::text,
           unlinkable.event_id, 'Unlinkable event id', '{}'::jsonb,
           $3::timestamptz - INTERVAL '1 hour', $3::timestamptz - INTERVAL '1 hour'
         FROM unnest($4::text[]) AS unlinkable(event_id)
         RETURNING id, created_at
       )
       INSERT INTO notification_email_queue (
         notification_id, user_id, organization_id, property_id, category, cadence,
         status, priority, idempotency_key, created_at, updated_at
       )
       SELECT notice.id, 'delivery-lag-plan-user', $1::text, $2::uuid, 'urgent_operational',
         'immediate', 'pending', 'urgent', 'delivery-lag-plan-unlinkable-' || notice.id,
         notice.created_at, notice.created_at
       FROM notice`,
      [PLAN_ORG, PLAN_PROPERTY, PLAN_WINDOW_END, UNLINKABLE_EVENT_IDS],
    )
    await client.query('ANALYZE outbox_events, notifications, notification_email_queue')
  }, 120_000)

  afterAll(async () => {
    await fixture?.rollBack()
  })

  it("links each email to its source by the outbox primary key, not a walk of its Organization's outbox", async () => {
    const repo = (window: Parameters<typeof readNotificationDeliveryLag>[2]) =>
      readNotificationDeliveryLag(fixture!.db, () => true, window)
    statements.length = 0

    const report = await repo({
      recordedAtOrAfter: new Date(PLAN_WINDOW_END.getTime() - DAY_MS),
      recordedBefore: PLAN_WINDOW_END,
      scanLimit: 1000,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
    })

    // Every linked email found its source; each unlinkable id is unlinked.
    expect(report.immediateEmailAcceptance).toMatchObject({
      awaitingProviderAcceptance: PLAN_LINKED_EMAILS + UNLINKABLE_EVENT_IDS.length,
      oldestAwaitingSourceRecordedAt: new Date(
        PLAN_WINDOW_END.getTime() - PLAN_LINKED_EMAILS * MINUTE_MS,
      ),
      sourceUnlinked: UNLINKABLE_EVENT_IDS.length,
      saturated: false,
    })
    const linkage = statements.find(({ query }) => query.includes('source_event'))
    expect(linkage).toBeDefined()
    const explained = await fixture!.client.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
      `EXPLAIN (FORMAT JSON) ${linkage!.query}`,
      linkage!.params,
    )
    const sourceScans = planNodes(explained.rows[0]!['QUERY PLAN'][0].Plan).filter(
      (node) => node.Alias === 'source_event',
    )
    expect(sourceScans.map((node) => node['Index Name'] ?? node['Node Type'])).toEqual([
      'outbox_events_pkey',
    ])
  }, 60_000)
})

// A fact two consumers handle (the notice, and the settle of an earlier one) is
// owed a receipt from each. The report counts it once per route still missing
// its receipt, so a half-handled fact is counted once and an unhandled one
// twice. Written inside one held transaction and rolled back, in a window no
// other suite writes into.
const ROUTES_ORG = organizationId('notification-delivery-lag-routes-org')
const ROUTES_WINDOW_START = new Date('2018-05-12T05:00:00.000Z')
const ROUTES_WINDOW_END = new Date('2018-05-12T06:00:00.000Z')
const ROUTES_RECORDED = new Date('2018-05-12T05:10:00.000Z')
const TWO_CONSUMER_EVENT_TYPE = 'review.reply.approved'
const NOTICE_CONSUMER = 'notification.on-review-reply-approved'
const SETTLE_CONSUMER = 'notification.settle-on-review-reply-approved'

describe.sequential(
  'delivery lag source facts handled by two consumers (real PostgreSQL)',
  () => {
    let fixture: HeldTransaction | undefined

    beforeAll(async () => {
      fixture = await holdTransaction()
    })

    afterEach(async () => {
      // Receipts go with their fact (ON DELETE CASCADE).
      await fixture?.client.query(
        'DELETE FROM outbox_events WHERE organization_id = $1',
        [ROUTES_ORG],
      )
    })

    afterAll(async () => {
      await fixture?.rollBack()
    })

    /** A review reply approval fact, whose route has two consumers. */
    async function seedApproval(): Promise<string> {
      const inserted = await fixture!.client.query<{ id: string }>(
        `INSERT INTO outbox_events (
         event_type, event_version, payload, organization_id, property_id,
         source_context, source_aggregate_id, created_at, published_at
       ) VALUES ($1, 1, '{}'::jsonb, $2, NULL, 'review', 'routes-approval', $3, $3)
       RETURNING id::text AS id`,
        [TWO_CONSUMER_EVENT_TYPE, ROUTES_ORG, ROUTES_RECORDED],
      )
      return inserted.rows[0]!.id
    }

    const readSourceFacts = () =>
      readNotificationDeliveryLag(fixture!.db, () => true, {
        recordedAtOrAfter: ROUTES_WINDOW_START,
        recordedBefore: ROUTES_WINDOW_END,
        scanLimit: 10,
        statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      })

    it('counts a fact once for each of its routes that has no receipt', async () => {
      await seedApproval()

      const report = await readSourceFacts()

      expect(report.sourceReceiptPending).toBe(2)
      expect(report.sourceReceiptPendingByEventType).toEqual({
        [TWO_CONSUMER_EVENT_TYPE]: 2,
      })
      expect(report.oldestSourceRecordedAt).toEqual(ROUTES_RECORDED)
    })

    it('counts a fact once while one of its two routes has no receipt', async () => {
      const eventId = await seedApproval()
      await fixture!.client.query(
        `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
       VALUES ($1, $2, 'applied')`,
        [eventId, NOTICE_CONSUMER],
      )

      const report = await readSourceFacts()

      expect(report.sourceReceiptPending).toBe(1)
      expect(report.sourceReceiptPendingByEventType).toEqual({
        [TWO_CONSUMER_EVENT_TYPE]: 1,
      })
    })

    it('leaves out a fact once both of its routes have their receipts', async () => {
      const eventId = await seedApproval()
      await fixture!.client.query(
        `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
       VALUES ($1, $2, 'applied'), ($1, $3, 'applied')`,
        [eventId, NOTICE_CONSUMER, SETTLE_CONSUMER],
      )

      const report = await readSourceFacts()

      expect(report.sourceReceiptPending).toBe(0)
      expect(report.sourceReceiptPendingByEventType).toEqual({})
    })
  },
)
