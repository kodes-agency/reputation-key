/**
 * The registry rules for de-identified Guest facts: the rating fact, the counted
 * visit, the destination selection, and corrections and withdrawals. They are
 * one data class stored in four tables across Guest and Metric, so they are
 * kept together where their horizons can be compared.
 */

import {
  defineRetentionRegistryRule as rule,
  RESTORE_REPLAYS_DELETION,
  type RetentionRegistryRule,
} from './retention-registry-model'

export const GUEST_DEIDENTIFIED_FACT_RULES: ReadonlyArray<RetentionRegistryRule> =
  Object.freeze([
    rule({
      id: 'guest.deidentified_facts',
      dataClass: 'guest_deidentified_facts',
      ownerContext: 'guest',
      ownerRole: 'Guest context owner with the Metric context owner',
      sourceKind: 'table',
      source: 'guest_responses',
      eligibility: {
        anchorColumn: 'retention_deadline',
        horizon: { kind: 'months', months: 24 },
        predicate: null,
        query:
          'SELECT id FROM guest_responses WHERE retention_deadline < now(). retention_deadline is 24 calendar months from the INITIAL submission and is never recomputed — not on moderation (moderated_at), not on correction, not on archive.',
        implementedBoundary:
          'Live: the scheduled subject guest_responses.deidentified_fact deletes on retention_deadline. Corrections and withdrawals must reach portal_metric_lifetime_aggregates before this purge runs.',
      },
      evidenceSubject: 'guest_responses.deidentified_fact',
      restoreImplication:
        'A restore reinstates purged facts AND desynchronises the lifetime aggregate, because corrections and withdrawals applied before the purge are replayed against rows that already carry them. The aggregate must be reconciled against the restored facts before the cell is reopened.',
      coveredFacts: ['rating'],
    }),
    rule({
      id: 'guest.deidentified_qualified_scan_facts',
      dataClass: 'guest_deidentified_facts',
      ownerContext: 'guest',
      ownerRole: 'Guest context owner with the Metric context owner',
      sourceKind: 'table',
      source: 'guest_qualified_scans',
      eligibility: {
        anchorColumn: 'occurred_at',
        horizon: { kind: 'counsel_undecided' },
        predicate: null,
        query:
          'Inventory guest_qualified_scans by occurred_at. No deletion cutoff is armed until counsel decides the separately stored Qualified Scan horizon.',
        implementedBoundary:
          'No executing retention rule exists for this identifier-only fact table.',
      },
      evidenceSubject: 'guest_qualified_scans.retention_undecided',
      restoreImplication: RESTORE_REPLAYS_DELETION,
      coveredFacts: ['qualified_scan'],
    }),
    rule({
      id: 'metric.deidentified_destination_click_facts',
      dataClass: 'guest_deidentified_facts',
      ownerContext: 'metric',
      ownerRole: 'Metric context owner with the Guest context owner',
      sourceKind: 'table',
      source: 'metric_readings',
      eligibility: {
        anchorColumn: 'event_at',
        horizon: { kind: 'counsel_undecided' },
        predicate: "metric_key = 'portal.review_link_click'",
        query:
          "Inventory metric_readings WHERE metric_key = 'portal.review_link_click' by event_at. No deletion cutoff is armed until counsel decides the separately stored click-fact horizon.",
        implementedBoundary:
          'No executing retention rule exists for retained destination-click readings.',
      },
      evidenceSubject: 'metric_readings.destination_click_retention_undecided',
      restoreImplication: RESTORE_REPLAYS_DELETION,
      coveredFacts: ['destination_click'],
    }),
    rule({
      id: 'metric.deidentified_correction_withdrawal_facts',
      dataClass: 'guest_deidentified_facts',
      ownerContext: 'metric',
      ownerRole: 'Metric context owner with the Guest context owner',
      sourceKind: 'table',
      source: 'metric_corrections',
      eligibility: {
        anchorColumn: 'event_at',
        horizon: { kind: 'counsel_undecided' },
        predicate: "kind IN ('retract', 'replace', 'adjust')",
        query:
          'Inventory metric_corrections by event_at. No deletion cutoff is armed until counsel decides the correction and withdrawal fact horizon.',
        implementedBoundary:
          'No executing retention rule exists for retained correction and withdrawal facts.',
      },
      evidenceSubject: 'metric_corrections.retention_undecided',
      restoreImplication: RESTORE_REPLAYS_DELETION,
      coveredFacts: ['correction', 'withdrawal'],
    }),
  ])
