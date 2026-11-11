/**
 * Receipt-name prefixes a queued `insert-notification` delivery wrote: one when
 * Redis accepted the job, one when PostgreSQL materialized it. The health reads
 * still honour them while such jobs drain.
 */
export const notificationDeliveryReceiptPrefixes = {
  enqueue: 'notification.enqueue:',
  materialized: 'notification.materialized:',
} as const
