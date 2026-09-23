// Feed notification surface — the durable notification routes as SQL.
//
// One `(event_type, consumer_name)` pair per BETA_NOTIFICATION_TRIGGER_MATRIX
// row, for a `WITH routes(event_type, consumer_name) AS (VALUES ...)` clause.
// The delivery-lag report and the delivery repair both join receipts to it, so
// they agree on what a notification delivery is.

import { sql } from 'drizzle-orm'
import { BETA_NOTIFICATION_TRIGGER_MATRIX } from '../../application/beta-notification-trigger-matrix'

export const notificationRouteValues = sql.join(
  BETA_NOTIFICATION_TRIGGER_MATRIX.map(
    (row) => sql`(${row.eventType}::text, ${row.consumerName}::text)`,
  ),
  sql`, `,
)
