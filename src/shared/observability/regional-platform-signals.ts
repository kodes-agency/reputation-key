import type { AlertSeverity } from './alert-definitions'

type PlatformSignalBase = Readonly<{
  name: string
  dataCellId: 'us'
  owner: 'Bozhidar Denev'
  severity: AlertSeverity
  runbook: `runbooks.md §${number}`
  activationGate: 'required_before_customer_data'
  /** Exact content-free artifacts retained after alert configuration/drill. */
  evidence: readonly string[]
}>

export type Reg04PlatformSignal = PlatformSignalBase &
  Readonly<{
    kind:
      | 'backup_age'
      | 'wal_pitr_health'
      | 'restore_range'
      | 'logical_export_success'
      | 'external_availability'
      | 'error_rate'
      | 'release_config_drift'
    source:
      | 'railway_platform'
      | 'logical_export_runner'
      | 'external_synthetic'
      | 'sentry'
      | 'release_controller'
    service?: 'Postgres' | 'web'
  }>

const base = Object.freeze({
  dataCellId: 'us' as const,
  owner: 'Bozhidar Denev' as const,
  activationGate: 'required_before_customer_data' as const,
})

/**
 * External signal inventory for the one deployable beta Data Cell. These
 * rows register what the platform/monitoring configuration and retained drill
 * evidence must prove; they are intentionally not an assertion that Railway,
 * Sentry, an export runner, or an uptime monitor is currently configured.
 */
export const REG04_PLATFORM_SIGNALS: readonly Reg04PlatformSignal[] = Object.freeze([
  {
    ...base,
    name: 'cell-us.backup.latest-success-age',
    kind: 'backup_age',
    source: 'railway_platform',
    service: 'Postgres',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    evidence: ['backup_schedule', 'latest_success_at', 'alert_injection_receipt'],
  },
  {
    ...base,
    name: 'cell-us.pitr.wal-health',
    kind: 'wal_pitr_health',
    source: 'railway_platform',
    service: 'Postgres',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    evidence: ['pitr_enabled', 'wal_health', 'alert_injection_receipt'],
  },
  {
    ...base,
    name: 'cell-us.pitr.restore-range',
    kind: 'restore_range',
    source: 'railway_platform',
    service: 'Postgres',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    evidence: ['earliest_restore_point', 'latest_restore_point', 'observed_at'],
  },
  {
    ...base,
    name: 'cell-us.logical-export.latest-success-age',
    kind: 'logical_export_success',
    source: 'logical_export_runner',
    severity: 'P1',
    runbook: 'runbooks.md §8',
    evidence: [
      'encrypted_export_digest',
      'destination_account_and_region_approval',
      'latest_success_at',
      'restore_read_verification',
    ],
  },
  {
    ...base,
    name: 'cell-us.web.external-availability',
    kind: 'external_availability',
    source: 'external_synthetic',
    service: 'web',
    severity: 'P1',
    runbook: 'runbooks.md §12',
    evidence: ['external_probe_configuration', 'alert_injection_receipt'],
  },
  {
    ...base,
    name: 'cell-us.error-monitoring.error-rate',
    kind: 'error_rate',
    source: 'sentry',
    severity: 'P1',
    runbook: 'runbooks.md §16',
    evidence: ['germany_project', 'release_and_cell_filter', 'alert_injection_receipt'],
  },
  {
    ...base,
    name: 'cell-us.release.config-drift',
    kind: 'release_config_drift',
    source: 'release_controller',
    severity: 'P1',
    runbook: 'runbooks.md §11',
    evidence: [
      'signed_release_manifest',
      'railway_readback',
      'fresh_no_drift_plan',
      'alert_injection_receipt',
    ],
  },
])

export type Reg04MonitoringRequirement = Readonly<{
  requirement:
    | 'backup_age'
    | 'wal_pitr_health'
    | 'restore_range'
    | 'logical_export_success'
    | 'queue_age'
    | 'outbox_lag'
    | 'reply_publication'
    | 'google_sync_freshness'
    | 'error_rate'
    | 'cell_release_config_drift'
  source: 'application_alert' | 'external_signal'
  signal: string
}>

/** Exact traceability for comprehensive-program REG-04 work item 2. */
export const REG04_MONITORING_REQUIREMENTS: readonly Reg04MonitoringRequirement[] =
  Object.freeze([
    {
      requirement: 'backup_age',
      source: 'external_signal',
      signal: 'cell-us.backup.latest-success-age',
    },
    {
      requirement: 'wal_pitr_health',
      source: 'external_signal',
      signal: 'cell-us.pitr.wal-health',
    },
    {
      requirement: 'restore_range',
      source: 'external_signal',
      signal: 'cell-us.pitr.restore-range',
    },
    {
      requirement: 'logical_export_success',
      source: 'external_signal',
      signal: 'cell-us.logical-export.latest-success-age',
    },
    {
      requirement: 'queue_age',
      source: 'application_alert',
      signal: 'worker.job-runtime-unready',
    },
    {
      requirement: 'outbox_lag',
      source: 'application_alert',
      signal: 'queue.oldest-age',
    },
    {
      requirement: 'reply_publication',
      source: 'application_alert',
      signal: 'reply.ambiguous-aging',
    },
    {
      requirement: 'google_sync_freshness',
      source: 'application_alert',
      signal: 'sync.sweep-lag',
    },
    {
      requirement: 'error_rate',
      source: 'external_signal',
      signal: 'cell-us.error-monitoring.error-rate',
    },
    {
      requirement: 'cell_release_config_drift',
      source: 'external_signal',
      signal: 'cell-us.release.config-drift',
    },
  ])
