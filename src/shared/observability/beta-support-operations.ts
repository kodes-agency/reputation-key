import type { AlertSeverity } from './alert-definitions'

export type BetaCriticalJourney =
  | 'invitation_and_onboarding'
  | 'google_connection_and_import'
  | 'google_review_sync'
  | 'review_and_inbox_triage'
  | 'reply_publish_and_reconcile'
  | 'portal_review_gateway'
  | 'beta_feedback_delivery'
  | 'beta_feedback_triage'

export type BetaCriticalJourneySignal = Readonly<{
  journey: BetaCriticalJourney
  dataCellId: 'us'
  signalName: string
  status:
    | 'implemented_application_signal'
    | 'registered_external_signal'
    | 'external_configuration_required'
    | 'application_instrumentation_required'
  severity: AlertSeverity
  owner: 'Bozhidar Denev'
  runbook: 'runbooks.md §16'
  /** Content-free proof required before the signal is considered active. */
  evidence: readonly string[]
}>

const signal = (
  input: Omit<BetaCriticalJourneySignal, 'dataCellId' | 'owner' | 'runbook'>,
): BetaCriticalJourneySignal =>
  Object.freeze({
    ...input,
    dataCellId: 'us' as const,
    owner: 'Bozhidar Denev' as const,
    runbook: 'runbooks.md §16' as const,
  })

/**
 * Closed-beta journey monitoring authority for the single deployable US Data
 * Cell. A row is a required signal contract, not a claim that an external
 * synthetic, Sentry rule, or dashboard has already been configured.
 */
export const BETA_CRITICAL_JOURNEY_SIGNALS: readonly BetaCriticalJourneySignal[] =
  Object.freeze([
    signal({
      journey: 'invitation_and_onboarding',
      signalName: 'cell-us.journey.invitation-onboarding',
      status: 'external_configuration_required',
      severity: 'P1',
      evidence: [
        'synthetic_definition',
        'successful_and_failed_journey_receipts',
        'alert_injection_receipt',
      ],
    }),
    signal({
      journey: 'google_connection_and_import',
      signalName: 'cell-us.journey.google-connection-import',
      status: 'external_configuration_required',
      severity: 'P1',
      evidence: [
        'synthetic_definition',
        'oauth_and_import_terminal_outcomes',
        'alert_injection_receipt',
      ],
    }),
    signal({
      journey: 'google_review_sync',
      signalName: 'sync.sweep-lag',
      status: 'implemented_application_signal',
      severity: 'P1',
      evidence: ['health_snapshot_signal', 'dispatch_transition', 'alert_receipt'],
    }),
    signal({
      journey: 'review_and_inbox_triage',
      signalName: 'cell-us.journey.review-inbox-triage',
      status: 'external_configuration_required',
      severity: 'P1',
      evidence: [
        'synthetic_definition',
        'source_to_inbox_receipt_latency',
        'alert_injection_receipt',
      ],
    }),
    signal({
      journey: 'reply_publish_and_reconcile',
      signalName: 'reply.ambiguous-aging',
      status: 'implemented_application_signal',
      severity: 'P2',
      evidence: ['publication_state_signal', 'reconciliation_due_age', 'alert_receipt'],
    }),
    signal({
      journey: 'portal_review_gateway',
      signalName: 'cell-us.journey.portal-review-gateway',
      status: 'external_configuration_required',
      severity: 'P1',
      evidence: [
        'supported_locale_and_device_synthetics',
        'private_rating_durability_receipt',
        'alert_injection_receipt',
      ],
    }),
    signal({
      journey: 'beta_feedback_delivery',
      signalName: 'cell-us.journey.beta-feedback-delivery',
      status: 'external_configuration_required',
      severity: 'P2',
      evidence: [
        'bug_and_suggestion_synthetics',
        'local_receipt_to_provider_reference_reconciliation',
        'alert_injection_receipt',
      ],
    }),
    signal({
      journey: 'beta_feedback_triage',
      signalName: 'beta-feedback.triage-backlog',
      status: 'implemented_application_signal',
      severity: 'P2',
      evidence: [
        'content_free_queue_age_signal',
        'named_owner_coverage',
        'local_alert_injection_test',
      ],
    }),
  ])

export const BETA_SUPPORT_POLICY = Object.freeze({
  intake: 'native_beta_feedback' as const,
  triageOwner: 'Bozhidar Denev' as const,
  incidentCommander: 'Bozhidar Denev' as const,
  communicationsOwner: 'Bozhidar Denev' as const,
  regularResponseExpectation: 'next_business_day' as const,
  regularResponseIsGuarantee: false as const,
  immediateIncidentHandoff: Object.freeze([
    'privacy_escalated',
    'security_suspected',
    'security_confirmed',
    'critical_journey_unavailable',
  ] as const),
  afterHoursContainment: Object.freeze([
    'disable_affected_non_core_capability',
    'suspend_affected_property_processing',
    'pause_affected_queue_without_deleting_work',
    'roll_back_to_last_signed_release',
  ] as const),
  statusCommunication: Object.freeze({
    P0: 'hourly_until_contained',
    P1: 'each_business_day_until_resolved',
    P2: 'when_triage_state_changes',
    P3: 'when_triage_state_changes',
  } as const),
})

export type Obs01ExternalEvidenceGate = Readonly<{
  id:
    | 'germany_project_inspection'
    | 'per_process_cell_test_events'
    | 'inbound_scrubber_inspection'
    | 'source_map_inspection'
    | 'alert_delivery_drill'
    | 'provider_attachment_retention'
    | 'manual_attachment_journey'
    | 'legal_notice_and_retention_approval'
  status: 'external_evidence_required'
  repositoryProofIsSufficient: false
  evidence: readonly string[]
}>

const externalGate = (
  id: Obs01ExternalEvidenceGate['id'],
  evidence: readonly string[],
): Obs01ExternalEvidenceGate =>
  Object.freeze({
    id,
    status: 'external_evidence_required' as const,
    repositoryProofIsSufficient: false as const,
    evidence,
  })

/** These gates cannot be closed by repository tests or local execution. */
export const OBS01_EXTERNAL_EVIDENCE_GATES: readonly Obs01ExternalEvidenceGate[] =
  Object.freeze([
    externalGate('germany_project_inspection', [
      'project_region',
      'subprocessor_configuration',
      'release_and_cell_filters',
    ]),
    externalGate('per_process_cell_test_events', [
      'web_event',
      'worker_event',
      'four_sidecar_events',
    ]),
    externalGate('inbound_scrubber_inspection', [
      'seeded_marker_set',
      'provider_event_inspection',
    ]),
    externalGate('source_map_inspection', [
      'candidate_release',
      'readable_stack_frames',
      'no_source_context_content',
    ]),
    externalGate('alert_delivery_drill', [
      'injected_signal',
      'named_owner_receipt',
      'delivery_time',
    ]),
    externalGate('provider_attachment_retention', [
      'attachment_retention_days_at_most_30',
      'expiry_verification',
    ]),
    externalGate('manual_attachment_journey', [
      'supported_browser_and_device',
      'consent_preview_remove_cancel',
      'suggestion_text_only',
    ]),
    externalGate('legal_notice_and_retention_approval', [
      'approved_notice_version',
      'approved_retention_rule',
      'approved_subprocessor_region',
    ]),
  ])
