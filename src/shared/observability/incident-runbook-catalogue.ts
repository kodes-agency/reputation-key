import type { AlertSeverity } from './alert-definitions'

export type Reg04IncidentRunbook = Readonly<{
  id:
    | 'auth_compromise'
    | 'cross_tenant_suspicion'
    | 'bad_migration'
    | 'queue_outbox_stall'
    | 'google_ambiguous_publish'
    | 'provider_credential_leak'
    | 'us_regional_outage'
    | 'lost_bucket_object'
    | 'privacy_request'
  severity: AlertSeverity
  runbook: `runbooks.md §${number}`
  incidentCommander: 'Bozhidar Denev'
  communicationsSupportOwner: 'Bozhidar Denev'
  /** Content-free items required in the retained incident record. */
  evidence: readonly string[]
}>

const roles = Object.freeze({
  incidentCommander: 'Bozhidar Denev' as const,
  communicationsSupportOwner: 'Bozhidar Denev' as const,
})

/**
 * Exact REG-04 incident inventory. One person fills both roles for the closed
 * beta, but the record keeps the roles separate so either can be delegated
 * without changing containment authority.
 */
export const REG04_INCIDENT_RUNBOOKS: readonly Reg04IncidentRunbook[] = Object.freeze([
  {
    ...roles,
    id: 'auth_compromise',
    severity: 'P0',
    runbook: 'runbooks.md §1',
    evidence: ['incident_timeline', 'session_revocation_count', 'recovery_signoff'],
  },
  {
    ...roles,
    id: 'cross_tenant_suspicion',
    severity: 'P0',
    runbook: 'runbooks.md §20',
    evidence: ['stop_time', 'affected_release_and_cell', 'scope_decision', 'signoff'],
  },
  {
    ...roles,
    id: 'bad_migration',
    severity: 'P0',
    runbook: 'runbooks.md §8',
    evidence: ['migration_head', 'failed_step', 'forward_fix_or_restore_decision'],
  },
  {
    ...roles,
    id: 'queue_outbox_stall',
    severity: 'P1',
    runbook: 'runbooks.md §7',
    evidence: ['oldest_age', 'queue_depth', 'replay_and_duplicate_check'],
  },
  {
    ...roles,
    id: 'google_ambiguous_publish',
    severity: 'P0',
    runbook: 'runbooks.md §6',
    evidence: ['publication_state', 'reconciliation_coverage', 'provider_truth'],
  },
  {
    ...roles,
    id: 'provider_credential_leak',
    severity: 'P0',
    runbook: 'runbooks.md §2',
    evidence: ['capability_stop_time', 'provider_revocation_evidence', 'rotation_head'],
  },
  {
    ...roles,
    id: 'us_regional_outage',
    severity: 'P1',
    runbook: 'runbooks.md §12',
    evidence: ['cell_us_outage_window', 'dormant_fallback_refusal', 'backlog_recovery'],
  },
  {
    ...roles,
    id: 'lost_bucket_object',
    severity: 'P1',
    runbook: 'runbooks.md §21',
    evidence: ['object_class', 'reference_count', 'recovery_or_fallback_outcome'],
  },
  {
    ...roles,
    id: 'privacy_request',
    severity: 'P0',
    runbook: 'runbooks.md §22',
    evidence: ['verified_request', 'scope_inventory', 'purge_receipts', 'backup_ledger'],
  },
])
