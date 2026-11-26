/**
 * OperationsSnapshot degraded-section markers (operations-snapshot.ts). The
 * health section degrades per signal (HEALTH_SIGNALS in health-metrics.ts).
 */
export const SNAPSHOT_SECTIONS = [
  'health.outbox',
  'health.quarantine',
  'health.reviews',
  'health.sync',
  'health.syncPush',
  'health.replyPublication',
  'health.notificationEmail',
  'health.notificationDeliveryLag',
  'queues',
  'workers.heartbeat',
  'runtime',
  'jobs',
  'guest.observationLoss',
] as const

export type SnapshotSection = (typeof SNAPSHOT_SECTIONS)[number]
