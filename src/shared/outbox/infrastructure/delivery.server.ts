import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createWorkItems } from '#/shared/jobs/work-items.server'
import type { Clock } from '#/shared/domain/clock'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { workItems as workItemRows } from '#/shared/db/schema/work-items.schema'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  OUTBOX_DELIVERY_KIND,
  OUTBOX_DELIVERY_MAX_ATTEMPTS,
  deliveryRetryDelayMs,
} from '../dispatch-job-options'
import type { Tx } from '../commit'
import type { DurableConsumerExpectation } from './outbox-repository'

export type DeliveryWork = Readonly<{
  id: string
  organizationId: string
  subjectId: string
  eventType: string
}>

type PendingEvent = Readonly<{ id: string; organizationId: string; eventType: string }>

/**
 * Keyset position in the published backlog: publication time truncated to the
 * millisecond, then id. A JS Date carries milliseconds only, so a cursor on the
 * stored microseconds would hand the same row back forever.
 */
export type AwaitingReceiptsCursor = Readonly<{ publishedAt: Date; id: string }>

export type AwaitingReceiptsPage = Readonly<{
  scheduled: readonly DeliveryWork[]
  /** Null once the page reached the end of the published backlog. */
  next: AwaitingReceiptsCursor | null
}>

/** Enough to finish a batch around one concurrent worker; an empty look ends sooner. */
const ADMISSION_PASSES = 3

const publishedMs = sql`date_trunc('milliseconds', o.published_at)`

const consumerExpectations = EVENT_FAMILY_ROWS.flatMap(({ eventType, consumers }) =>
  consumers.map(({ name }) => ({ eventType, consumerName: name })),
)

export function createOutboxDelivery(db: Database, clock: Clock) {
  const workItems = createWorkItems(db, clock)

  // The per-second poll reads unpublished facts only, so its cost follows the
  // new-fact backlog rather than every stored fact. Rank eligible rows by
  // tenant before locking, without a candidate LIMIT: a held tenant cannot hide
  // another tenant outside a locked first page.
  const lockPending = async (tx: Tx, limit: number) =>
    (
      await tx.execute<PendingEvent>(sql`
        WITH ranked AS (
          SELECT o.id, row_number() OVER (
            PARTITION BY o.organization_id ORDER BY o.created_at, o.id
          ) AS turn
          FROM outbox_events o
          WHERE o.published_at IS NULL
            AND o.recovery_fenced_at IS NULL
            AND (o.lease_expires_at IS NULL OR o.lease_expires_at <= ${clock()})
            AND NOT EXISTS (
              SELECT 1 FROM work_items w WHERE w.organization_id = o.organization_id
                AND w.kind = ${OUTBOX_DELIVERY_KIND} AND w.idempotency_key = o.id::text
            )
        )
        SELECT o.id, o.organization_id AS "organizationId", o.event_type AS "eventType"
        FROM outbox_events o JOIN ranked r ON r.id = o.id
        ORDER BY r.turn, o.created_at, o.id
        FOR UPDATE OF o SKIP LOCKED LIMIT ${limit}
      `)
    ).rows

  // One keyset page of every published fact, whatever its state, so the
  // cursor always advances. The publication index bounds the rows a page
  // sorts: from the cursor's millisecond (truncation never moves a time later)
  // to the end of the millisecond holding the page-size-th fact published
  // after it. That window holds at least a full page past the cursor, so a
  // short page means the backlog ended.
  const readPublishedPage = async (
    tx: Tx,
    after: AwaitingReceiptsCursor | null,
    pageSize: number,
  ) => {
    // The first page starts at -infinity so the planner reads it as a range on
    // the publication index, as it does every later page, rather than as an
    // IS NOT NULL filter it may price as a scan of most of the table.
    const from = (at: Date | undefined) =>
      at ? sql`o.published_at >= ${at}` : sql`o.published_at >= '-infinity'::timestamptz`
    const nextMillisecond = after ? new Date(after.publishedAt.getTime() + 1) : undefined
    return (
      await tx.execute<{ id: string; publishedAtMs: number }>(sql`
        WITH bound AS (
          SELECT o.published_at AS at FROM outbox_events o
          WHERE ${from(nextMillisecond)}
          ORDER BY o.published_at OFFSET ${pageSize - 1} LIMIT 1
        )
        SELECT o.id,
          (EXTRACT(EPOCH FROM ${publishedMs}) * 1000)::float8 AS "publishedAtMs"
        FROM outbox_events o
        WHERE ${from(after?.publishedAt)}
          AND o.published_at < coalesce(
            (SELECT date_trunc('milliseconds', at) + interval '1 millisecond' FROM bound),
            'infinity'::timestamptz
          )
          ${
            after === null
              ? sql``
              : sql`AND (${publishedMs}, o.id) > (${after.publishedAt}::timestamptz, ${after.id}::uuid)`
          }
        ORDER BY ${publishedMs}, o.id
        LIMIT ${pageSize}
      `)
    ).rows
  }

  // A published fact without delivery work still owed a catalogued receipt.
  // A fact that has delivery work is the ledger's to retry, and is never
  // back-filled to a consumer added to the catalogue after it was admitted.
  const lockAwaitingReceipts = async (tx: Tx, expected: SQL, ids: readonly string[]) =>
    (
      await tx.execute<PendingEvent>(sql`
        WITH expected(event_type, consumer_name) AS (${expected})
        SELECT o.id, o.organization_id AS "organizationId", o.event_type AS "eventType"
        FROM outbox_events o
        WHERE o.id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
          AND o.published_at IS NOT NULL
          AND o.recovery_fenced_at IS NULL
          AND (o.lease_expires_at IS NULL OR o.lease_expires_at <= ${clock()})
          AND NOT EXISTS (
            SELECT 1 FROM work_items w WHERE w.organization_id = o.organization_id
              AND w.kind = ${OUTBOX_DELIVERY_KIND} AND w.idempotency_key = o.id::text
          )
          AND EXISTS (
            SELECT 1 FROM expected e WHERE e.event_type = o.event_type
              AND NOT EXISTS (SELECT 1 FROM event_consumer_receipts r
                WHERE r.event_id = o.id AND r.consumer_name = e.consumer_name)
          )
        ORDER BY ${publishedMs}, o.id
        FOR UPDATE OF o SKIP LOCKED
      `)
    ).rows

  const admittedElsewhere = async (tx: Tx, events: readonly PendingEvent[]) =>
    new Set(
      (
        await tx
          .select({ eventId: workItemRows.idempotencyKey })
          .from(workItemRows)
          .where(
            and(
              eq(workItemRows.kind, OUTBOX_DELIVERY_KIND),
              inArray(
                workItemRows.idempotencyKey,
                events.map((event) => event.id),
              ),
            ),
          )
      ).map((row) => row.eventId),
    )

  const admit = async (tx: Tx, event: PendingEvent): Promise<DeliveryWork> => {
    const work = await workItems.schedule(
      {
        organizationId: event.organizationId,
        subjectId: event.id,
        kind: OUTBOX_DELIVERY_KIND,
        idempotencyKey: event.id,
        dueAt: clock(),
        recovery: 'retry',
        maxAttempts: OUTBOX_DELIVERY_MAX_ATTEMPTS,
      },
      tx,
    )
    await tx
      .update(outboxEvents)
      .set({
        publishedAt: sql`coalesce(${outboxEvents.publishedAt}, ${clock()})`,
        leaseOwner: null,
        leasedAt: null,
        leaseExpiresAt: null,
      })
      .where(eq(outboxEvents.id, event.id))
    return { ...event, id: work.id, subjectId: event.id }
  }

  return {
    workItems,
    readQuarantineMetrics: () => workItems.readQuarantineMetrics(OUTBOX_DELIVERY_KIND),
    retryAt: (attempt: number) =>
      new Date(clock().getTime() + deliveryRetryDelayMs(attempt)),
    async schedulePending(limit: number): Promise<readonly DeliveryWork[]> {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000)
        throw new Error('Invalid outbox delivery batch size')
      return db.transaction(async (tx) => {
        const scheduled: DeliveryWork[] = []
        // A worker that commits before this statement locks its rows releases
        // them while this statement's snapshot still sees them unadmitted. Each
        // pass re-checks admission in a fresh statement, skips what another
        // worker took, and looks again for the rest of the batch.
        for (let pass = 0; pass < ADMISSION_PASSES && scheduled.length < limit; pass++) {
          const candidates = await lockPending(tx, limit - scheduled.length)
          if (candidates.length === 0) break
          const taken = await admittedElsewhere(tx, candidates)
          for (const event of candidates) {
            if (!taken.has(event.id)) scheduled.push(await admit(tx, event))
          }
          if (taken.size === 0) break
        }
        return scheduled
      })
    },
    /**
     * Admits the published facts in one page of the backlog that still miss an
     * expected receipt and have no delivery work. A row another transaction
     * holds is skipped; the next pass over the backlog sees it again.
     */
    async scheduleAwaitingReceipts(
      after: AwaitingReceiptsCursor | null,
      pageSize: number,
      expectations: readonly DurableConsumerExpectation[] = consumerExpectations,
    ): Promise<AwaitingReceiptsPage> {
      if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 10_000)
        throw new Error('Invalid outbox receipt sweep page size')
      return db.transaction(async (tx) => {
        const page = await readPublishedPage(tx, after, pageSize)
        const last = page.at(-1)
        const next =
          page.length === pageSize && last
            ? { publishedAt: new Date(last.publishedAtMs), id: last.id }
            : null
        if (page.length === 0 || expectations.length === 0) return { scheduled: [], next }
        const expected = sql`VALUES ${sql.join(
          expectations.map(
            ({ eventType, consumerName }) => sql`(${eventType}, ${consumerName})`,
          ),
          sql`, `,
        )}`
        const candidates = await lockAwaitingReceipts(
          tx,
          expected,
          page.map(({ id }) => id),
        )
        if (candidates.length === 0) return { scheduled: [], next }
        const taken = await admittedElsewhere(tx, candidates)
        const scheduled: DeliveryWork[] = []
        for (const event of candidates) {
          if (!taken.has(event.id)) scheduled.push(await admit(tx, event))
        }
        return { scheduled, next }
      })
    },
    async readEvent(organizationId: string, eventId: string) {
      const [event] = await db
        .select({
          id: outboxEvents.id,
          eventType: outboxEvents.eventType,
          eventVersion: outboxEvents.eventVersion,
          payload: outboxEvents.payload,
          organizationId: outboxEvents.organizationId,
          propertyId: outboxEvents.propertyId,
          sourceContext: outboxEvents.sourceContext,
          sourceAggregateId: outboxEvents.sourceAggregateId,
          recordedAt: outboxEvents.createdAt,
        })
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.organizationId, organizationId),
            eq(outboxEvents.id, eventId),
            isNull(outboxEvents.recoveryFencedAt),
          ),
        )
        .limit(1)
      return event
    },
  }
}
