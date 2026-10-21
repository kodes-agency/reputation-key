// The sync.* metrics (Google sync freshness, webhook dedupe, provider health,
// push health and reconciliation age), registered in METRIC_DEFINITIONS
// (metrics-schema.ts), which type-checks each entry where it spreads them in.
// This module imports nothing, so the registry can take it without a cycle.

export const SYNC_METRIC_DEFINITIONS = [
  {
    name: 'sync.due_for_incremental',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['sync.dueForIncrementalCount'],
    emitted: true,
    description: 'Properties past their next incremental sync time.',
  },
  {
    name: 'sync.oldest_due_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['sync.oldestDueAgeMs'],
    emitted: true,
    description:
      'Age of the OLDEST past-due next_incremental_at — discovery-sweep lag, for Properties the sweep selects and from the later of the poll time and the day the Property qualified again. A count of due properties cannot distinguish a sweep mid-run from a dead sweep; this can. Null/absent when nothing is overdue.',
  },
  {
    name: 'sync.failed',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['sync.failedSyncCount'],
    emitted: true,
    description: 'Syncs in error whose retry is due.',
  },
  {
    name: 'sync.gbp_push_enabled',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['sync.gbpPushEnabled'],
    emitted: true,
    description:
      '1 when GBP_PUBSUB_TOPIC is configured. 0 = Google push notifications are dark and new reviews only arrive on the discover-new-reviews sweep cadence.',
  },
  {
    name: 'sync.webhook.dedupe',
    kind: 'counter',
    unit: 'count',
    labels: {},
    emitted: false,
    description: 'Webhook deliveries dropped by the message-id dedupe (7.4).',
  },
  {
    name: 'sync.provider.throttle',
    kind: 'counter',
    unit: 'count',
    labels: {},
    emitted: false,
    description: 'Provider quota/throttle responses (7.4).',
  },
  {
    name: 'sync.provider.reconnect',
    kind: 'counter',
    unit: 'count',
    labels: {},
    emitted: false,
    description: 'Provider connection re-establishments (7.4).',
  },
  {
    name: 'sync.push_new_by_push_24h',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.newByPush24h'],
    emitted: true,
    description:
      'Live Reviews first seen in the last 24 hours by a Google push (its targeted read, or the full snapshot a push handed off to).',
  },
  {
    name: 'sync.push_new_by_poll_24h',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.newByPoll24h'],
    emitted: true,
    description:
      'Live Reviews first seen in the last 24 hours by polling or an on-demand read. Zero while push covers every new Review; compare with sync.push_accepted_24h.',
  },
  {
    name: 'sync.push_pending',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.pending'],
    emitted: true,
    description:
      'Reviews polling found in the last 24 hours that are under 60 minutes old with no push accepted yet. Counted as neither missed nor late.',
  },
  {
    name: 'sync.push_missed_24h',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.missed24h'],
    emitted: true,
    description:
      'Reviews first seen in the last 24 hours by polling with no push accepted within 60 minutes. A push that arrives later makes the Review late as well; it stays counted here.',
  },
  {
    name: 'sync.push_late_24h',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.late24h'],
    emitted: true,
    description:
      'Reviews first seen in the last 24 hours by polling whose push was accepted after polling saw them, by any delay.',
  },
  {
    name: 'sync.push_accepted_24h',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.acceptedPushes24h'],
    emitted: true,
    description:
      'Pushes Pub/Sub accepted for a known Property in the last 24 hours, one per Property that holds the location.',
  },
  {
    name: 'sync.push_locations_healthy',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.locationsHealthy'],
    emitted: true,
    description:
      'Locations with a live first sighting in the last 7 days and no missed push.',
  },
  {
    name: 'sync.push_locations_suspect',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.locationsSuspect'],
    emitted: true,
    description: 'Locations that missed at least one push in the last 7 days.',
  },
  {
    name: 'sync.push_accounts_dark',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.push.accountsDark'],
    emitted: true,
    description:
      'Google accounts (Organization, connection and account) that missed two or more pushes across their locations in the last 7 days.',
  },
  {
    name: 'sync.reconciliation_overdue',
    kind: 'gauge',
    unit: 'count',
    labels: {},
    snapshotPath: ['syncPush.reconciliation.overdueCount'],
    emitted: true,
    description:
      'Syncable Properties whose newest completed reconciliation of the current source epoch is older than 8 hours (no reconciliation: since the Property qualified). Properties parked with a coded failure are left to their own alert.',
  },
  {
    name: 'sync.oldest_reconciliation_age_ms',
    kind: 'gauge',
    unit: 'ms',
    labels: {},
    snapshotPath: ['syncPush.reconciliation.oldestAgeMs'],
    emitted: true,
    description:
      'Age of the oldest overdue reconciliation. Null/absent when none is overdue.',
  },
] as const
