import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'

const expectedConsumers = EVENT_FAMILY_ROWS.flatMap(({ eventType, consumers }) =>
  consumers.map(({ name }) => sql`(${eventType}, ${name})`),
)

// Only static catalogue values are inlined into the retention registry. Queue
// acceptance and exhausted retries cannot settle a missing consumer receipt.
export const SETTLED_OUTBOX_EVENTS_WHERE = new PgDialect().sqlToQuery(
  sql`published_at IS NOT NULL AND recovery_fenced_at IS NULL
    AND NOT EXISTS (
      WITH expected(event_type, consumer_name) AS (
        VALUES ${sql.join(expectedConsumers, sql`, `)}
      )
      SELECT 1 FROM expected
      WHERE expected.event_type = outbox_events.event_type
        AND NOT EXISTS (
          SELECT 1 FROM event_consumer_receipts AS receipt
          WHERE receipt.event_id = outbox_events.id
            AND receipt.consumer_name = expected.consumer_name
        )
    )`.inlineParams(),
).sql
