/**
 * The registry rules for de-identified Guest facts: the rating fact, the counted
 * visit, the visit record, the destination selection, and corrections and
 * withdrawals. They are one data class stored in five tables across Guest and
 * Metric, so they are kept together where their horizons can be compared.
 *
 * The accepted Privacy Notice keeps this class for 24 months. The three Guest
 * tables execute that. The two Metric tables do not yet, and say why.
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
        horizon: { kind: 'months', months: 24 },
        predicate: null,
        query:
          'SELECT id FROM guest_qualified_scans WHERE occurred_at is more than 24 UTC calendar months before the run. The row carries no stamped deadline; occurred_at is the visit itself, and a retraction (retracted_at) does not move it.',
        implementedBoundary:
          'Live: the scheduled subject guest_qualified_scans.deidentified_fact deletes the counted visit 24 calendar months after it happened. The Metric reading recorded from it is a separate row this rule does not reach.',
      },
      evidenceSubject: 'guest_qualified_scans.deidentified_fact',
      restoreImplication: RESTORE_REPLAYS_DELETION,
      coveredFacts: ['qualified_scan'],
    }),
    rule({
      id: 'guest.deidentified_visit_record_facts',
      dataClass: 'guest_deidentified_facts',
      ownerContext: 'guest',
      ownerRole: 'Guest context owner',
      sourceKind: 'table',
      source: 'scan_events',
      eligibility: {
        anchorColumn: 'created_at',
        horizon: { kind: 'months', months: 24 },
        predicate: null,
        query:
          'SELECT id FROM scan_events WHERE created_at is more than 24 UTC calendar months before the run. The session and network pseudonyms were cleared long before by the two redactions on this table; what is deleted is the content-free visit row.',
        implementedBoundary:
          'Live: the scheduled subject scan_events.deidentified_fact deletes the visit record 24 calendar months after the visit. scan_events is still written on every Portal visit, so its rows are current visit facts; ratings and feedback, which the beta no longer writes, stay row-preserving.',
      },
      evidenceSubject: 'scan_events.deidentified_fact',
      restoreImplication: RESTORE_REPLAYS_DELETION,
      coveredFacts: ['visit_record'],
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
        horizon: { kind: 'accepted_unexecuted', months: 24 },
        predicate: "metric_key = 'portal.review_link_click'",
        query:
          "Inventory metric_readings WHERE metric_key = 'portal.review_link_click' by event_at. The accepted Privacy Notice keeps destination facts for 24 months, and after 30 days this reading is the only row that records a destination selection.",
        implementedBoundary:
          "No executing retention rule exists. A reading may be deleted only after its Portal's lifetime aggregate has been sealed through that day (sealThrough), and nothing runs the seal yet: deleting unsealed readings leaves the aggregate above what its sources add up to, and the parity check Organization closure requires then fails.",
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
          'Inventory metric_corrections by event_at. A correction has no horizon of its own: it is deleted with the reading it corrects or not at all, because removing it alone would restore the uncorrected value and reading_id is ON DELETE RESTRICT.',
        implementedBoundary:
          'No executing retention rule exists for correction and withdrawal facts, and none can run before a rule deletes the readings they correct.',
      },
      evidenceSubject: 'metric_corrections.retention_undecided',
      restoreImplication: RESTORE_REPLAYS_DELETION,
      coveredFacts: ['correction', 'withdrawal'],
    }),
  ])
