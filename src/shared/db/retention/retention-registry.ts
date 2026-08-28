/**
 * LIF-01 (program bullet 10) — the counsel-ready retention registry.
 *
 * One matrix covering every data class the program names, with an owner, a
 * source table or object class, an eligibility query, an evidence subject and a
 * restore implication per rule. It is DECLARATIVE. It does not execute; the
 * separately authorized `RETENTION_RULES` sweep does that, and this registry is
 * the governance layer above it.
 *
 * Three properties are load-bearing and are asserted by the companion test:
 *
 * 1. `approvalState` is derived from `approvalArtifact`, so a rule cannot be
 *    marked approved by editing a flag. Counsel has approved nothing —
 *    docs/legal/legal-document-registry.json holds five drafts and zero
 *    approvals — so every rule is `pending_counsel` and
 *    `assertRetentionRegistryApplyAllowed` refuses apply for all of them.
 *    Report-only is the only reachable mode.
 *
 * 2. No rule may name a compatibility mirror or bounded-contraction table.
 *    Those tables are contraction candidates blocked until one verified release
 *    plus a restore proof. A retention rule that deleted their rows would do
 *    the contraction early and quietly, destroying the very inventory the
 *    contraction decision is supposed to rest on. `retention_classes.
 *    unresolved_legacy_compatibility_rows` is still an open counsel question.
 *
 * 3. A content deadline is anchored on the original submission or creation
 *    column (or an absolute deadline stamped at submission). Reading,
 *    moderating or archiving a row must never move it, so the columns those
 *    actions touch are refused as anchors.
 *
 * Horizons come from the program contract, not from invention. Where the
 * program states no horizon the rule carries `counsel_undecided` and cites the
 * open item in docs/legal/counsel-decision-checklist.json rather than guessing
 * a number that would then read as an approved policy.
 */

export const RETENTION_DATA_CLASSES = Object.freeze([
  'google_source_content',
  'guest_session_pseudonym',
  'guest_abuse_pseudonym',
  'guest_network_pseudonym',
  'guest_optional_contact',
  'guest_private_feedback_text',
  'guest_deidentified_facts',
  'guest_lifetime_aggregates',
  'notifications',
  'recent_activity',
  'operational_action_history',
  'logs_sentry_replay_screenshots',
  'ai_derivatives',
  'uploads',
  'quarantine',
  'provider_tokens',
  'exports',
  'backups',
] as const)

export type RetentionDataClass = (typeof RETENTION_DATA_CLASSES)[number]

/**
 * Classes whose rows carry Guest, provider or manager content. Only these are
 * subject to the "reading never extends a deadline" rule — an operational saga
 * fence keyed on `updated_at` is a state clock, not a content deadline.
 */
export const CONTENT_DEADLINE_CLASSES: ReadonlyArray<RetentionDataClass> = Object.freeze([
  'google_source_content',
  'guest_optional_contact',
  'guest_private_feedback_text',
  'guest_deidentified_facts',
  'ai_derivatives',
  'uploads',
])

/**
 * Columns that record an act of reading, moderating, archiving or otherwise
 * handling a row. Anchoring a content deadline on one of them would restart the
 * clock every time somebody opened the record.
 */
export const DEADLINE_NEUTRAL_COLUMNS: ReadonlyArray<string> = Object.freeze([
  'last_read_at',
  'read_at',
  'seen_at',
  'viewed_at',
  'last_accessed_at',
  'accessed_at',
  'revealed_at',
  'moderated_at',
  'reviewed_at',
  'handled_at',
  'archived_at',
  'updated_at',
])

export type RetentionApprovalState = 'pending_counsel' | 'approved'

export type RetentionSourceKind = 'table' | 'object_store' | 'external_processor'

export type RetentionHorizon =
  | Readonly<{ kind: 'days'; days: number }>
  | Readonly<{ kind: 'months'; months: number }>
  /** An absolute deadline stamped on the row at submission. */
  | Readonly<{ kind: 'row_deadline' }>
  /** Deliberately kept while its owning aggregate lives; no age-based expiry. */
  | Readonly<{ kind: 'retained_no_age_expiry' }>
  /** The program states no horizon; counsel must decide before any apply. */
  | Readonly<{ kind: 'counsel_undecided' }>

export type RetentionEligibility = Readonly<{
  /**
   * The column the cutoff is measured from, or null for an object store or an
   * external processor where the boundary is not a PostgreSQL column.
   */
  anchorColumn: string | null
  horizon: RetentionHorizon
  /** Registry-static predicate; never runtime input. */
  predicate: string | null
  /** The eligibility query in the form counsel and operators can review. */
  query: string
  /**
   * What the shipped code enforces TODAY, which may be stricter than the
   * counsel-facing horizon above. Counsel approves the horizon; operators are
   * held to the boundary. Conflating them is how a policy document ends up
   * describing behaviour the code does not have.
   */
  implementedBoundary: string
}>

export type RetentionRegistryRule = Readonly<{
  id: string
  dataClass: RetentionDataClass
  /** Owning bounded context or platform area. */
  ownerContext: string
  /** The accountable human role, not a person. */
  ownerRole: string
  sourceKind: RetentionSourceKind
  /** Physical table name, object class, or named external system. */
  source: string
  eligibility: RetentionEligibility
  /** `retention_runs.subject`, or a named external evidence record. */
  evidenceSubject: string
  restoreImplication: string
  approvalState: RetentionApprovalState
  approvalArtifact: string | null
  /** Open ids in docs/legal/counsel-decision-checklist.json. */
  blockingCounselDecisions: ReadonlyArray<string>
  /** Only meaningful for the de-identified fact class. */
  coveredFacts?: ReadonlyArray<string>
}>

type RetentionRegistryRuleInput = Omit<
  RetentionRegistryRule,
  'approvalState' | 'approvalArtifact'
> &
  Readonly<{ approvalArtifact?: string | null }>

/**
 * `approvalState` is computed, never written. A rule reaches 'approved' only by
 * carrying a named counsel approval artifact, so the state cannot drift away
 * from the evidence that is supposed to justify it.
 */
function rule(input: RetentionRegistryRuleInput): RetentionRegistryRule {
  const approvalArtifact = input.approvalArtifact ?? null
  return Object.freeze({
    ...input,
    approvalArtifact,
    approvalState: approvalArtifact ? 'approved' : 'pending_counsel',
  })
}

const RESTORE_REPLAYS_DELETION =
  'A restore from a backup taken before the cutoff reinstates rows this rule already removed; the post-restore retention sweep must be re-run and its evidence linked to the restore before the cell is reopened.'

const RESTORE_REPLAYS_REDACTION =
  'A restore reinstates the un-redacted column values; the redaction must be re-applied before the cell is reopened and the restore evidence must name the re-applied subject.'

const RESTORE_EXTERNAL =
  'The external processor holds its own copy on its own clock. A RepKey restore does not restore or re-delete it, and a RepKey deletion does not reach it; the boundary must be stated in the notice rather than implied.'

export const RETENTION_REGISTRY: ReadonlyArray<RetentionRegistryRule> = Object.freeze([
  rule({
    id: 'google.source_content',
    dataClass: 'google_source_content',
    ownerContext: 'review',
    ownerRole: 'Review context owner with the Google terms owner',
    sourceKind: 'table',
    source: 'review_source_contents',
    eligibility: {
      anchorColumn: 'content_expires_at',
      horizon: { kind: 'counsel_undecided' },
      predicate: null,
      query:
        'SELECT review_id FROM review_source_contents WHERE content_expires_at < now(). The anchor is deliberately NOT last_fetched_at: a re-observation refreshes the cache, and keying expiry on the fetch would let RepKey hold provider text for as long as it keeps looking at it.',
      implementedBoundary:
        'content_expires_at is stamped and enforced per row today, but no scheduled rule deletes on it yet and the 30-day figure is not a published commitment.',
    },
    evidenceSubject: 'review_source_contents.expired',
    restoreImplication: RESTORE_REPLAYS_DELETION,
    blockingCounselDecisions: [
      'google_terms_and_expiry.source_content_horizon',
      'retention_classes.unresolved_provider_reply_text',
    ],
  }),
  rule({
    id: 'google.import_discovery',
    dataClass: 'google_source_content',
    ownerContext: 'integration',
    ownerRole: 'Integration context owner',
    sourceKind: 'table',
    source: 'google_import_discovery_records',
    eligibility: {
      anchorColumn: 'expires_at',
      horizon: { kind: 'row_deadline' },
      predicate: null,
      query:
        'SELECT reference_key FROM google_import_discovery_records WHERE expires_at < now() — a database-enforced 24-hour deadline stamped on insert.',
      implementedBoundary:
        'Live: the scheduled sweep subject google_import_discovery_records.expired deletes on this deadline and writes content-free evidence.',
    },
    evidenceSubject: 'google_import_discovery_records.expired',
    restoreImplication: RESTORE_REPLAYS_DELETION,
    blockingCounselDecisions: ['retention_classes.expiring_google_cache'],
  }),
  rule({
    id: 'guest.session_pseudonym',
    dataClass: 'guest_session_pseudonym',
    ownerContext: 'guest',
    ownerRole: 'Guest context owner',
    sourceKind: 'table',
    source: 'guest_response_session_bindings',
    eligibility: {
      anchorColumn: 'expires_at',
      horizon: { kind: 'days', days: 7 },
      predicate: null,
      query:
        'SELECT response_id FROM guest_response_session_bindings WHERE expires_at < now(). expires_at is an absolute deadline stamped at submission; reopening the Portal in the same browser does not move it.',
      implementedBoundary:
        'Stricter than the §3.3.10 seven-day default: the binding expires 24 hours after submission, and the mirror session_id redactions run at 24 hours. Counsel approves the seven-day default; operators are held to the 24-hour boundary.',
    },
    evidenceSubject: 'guest_response_session_bindings.expired',
    restoreImplication: RESTORE_REPLAYS_DELETION,
    blockingCounselDecisions: [
      'retention_classes.guest_session_pseudonyms',
      'retention_classes.guest_response_session_binding',
    ],
  }),
  rule({
    id: 'guest.abuse_pseudonym',
    dataClass: 'guest_abuse_pseudonym',
    ownerContext: 'guest',
    ownerRole: 'Guest context owner',
    sourceKind: 'table',
    source: 'guest_network_pressure_records',
    eligibility: {
      anchorColumn: 'expires_at',
      horizon: { kind: 'days', days: 7 },
      predicate: null,
      query:
        'SELECT id FROM guest_network_pressure_records WHERE expires_at < now(). The canonical model has NO per-fact abuse pseudonym: one content-free, Portal-scoped authority replaced the per-row network hash, so this row IS the abuse pseudonym.',
      implementedBoundary:
        'Live at exactly seven days. The only remaining per-fact abuse pseudonyms are the ip_hash columns on the pre-beta mirrors; those are redacted at seven days without deleting a row — see LEGACY_MIRROR_PSEUDONYM_REDACTIONS.',
    },
    evidenceSubject: 'guest_network_pressure_records.expired',
    restoreImplication: RESTORE_REPLAYS_REDACTION,
    blockingCounselDecisions: ['retention_classes.guest_session_pseudonyms'],
  }),
  rule({
    id: 'guest.network_pseudonym',
    dataClass: 'guest_network_pseudonym',
    ownerContext: 'guest',
    ownerRole: 'Guest context owner',
    sourceKind: 'table',
    source: 'guest_network_pressure_records',
    eligibility: {
      anchorColumn: 'expires_at',
      horizon: { kind: 'days', days: 7 },
      predicate: null,
      query:
        'SELECT id FROM guest_network_pressure_records WHERE expires_at < now() — a database check fixes expires_at to exactly seven days after creation, so the horizon cannot drift per row.',
      implementedBoundary:
        'Live at exactly seven days via the scheduled subject guest_network_pressure_records.expired.',
    },
    evidenceSubject: 'guest_network_pressure_records.expired',
    restoreImplication: RESTORE_REPLAYS_DELETION,
    blockingCounselDecisions: ['retention_classes.guest_network_pressure_records'],
  }),
  rule({
    id: 'guest.optional_contact',
    dataClass: 'guest_optional_contact',
    ownerContext: 'guest',
    ownerRole: 'Guest context owner with the privacy notice owner',
    sourceKind: 'table',
    source: 'guest_contact_requests',
    eligibility: {
      anchorColumn: 'expires_at',
      horizon: { kind: 'days', days: 30 },
      predicate: 'purged_at IS NULL',
      query:
        'Expire the encrypted contact material WHERE expires_at < now() AND purged_at IS NULL. expires_at is stamped at consent, thirty days out. An audited reveal reads the material and must not move expires_at; the reveal is recorded separately in guest_contact_request_reveal_audits.',
      implementedBoundary:
        'Contact Request is a dark capability, so no new rows are produced. The bounded expiry sweep exists and writes evidence under guest_contact_requests.expired_material.',
    },
    evidenceSubject: 'guest_contact_requests.expired_material',
    restoreImplication: RESTORE_REPLAYS_REDACTION,
    blockingCounselDecisions: ['retention_classes.unresolved_contact_requests'],
  }),
  rule({
    id: 'guest.private_feedback_text',
    dataClass: 'guest_private_feedback_text',
    ownerContext: 'guest',
    ownerRole: 'Guest context owner with the privacy notice owner',
    sourceKind: 'table',
    source: 'guest_response_private_feedback',
    eligibility: {
      anchorColumn: 'expires_at',
      horizon: { kind: 'days', days: 90 },
      predicate: null,
      query:
        'SELECT response_id FROM guest_response_private_feedback WHERE expires_at < now(). expires_at is derived from submitted_at, ninety days out; manager reading, Inbox handling, escalation and archive all leave it untouched.',
      implementedBoundary:
        'Live: the scheduled subject guest_response_private_feedback.expired deletes the text row while the content-free response fact survives, so an expired row renders "Feedback expired/was received" rather than empty text.',
    },
    evidenceSubject: 'guest_response_private_feedback.expired',
    restoreImplication: RESTORE_REPLAYS_DELETION,
    blockingCounselDecisions: ['retention_classes.guest_private_feedback_text'],
  }),
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
    coveredFacts: [
      'rating',
      'qualified_scan',
      'destination_click',
      'correction',
      'withdrawal',
    ],
    blockingCounselDecisions: [
      'retention_classes.canonical_guest_response_fact',
      'retention_classes.unresolved_base_guest_metric_facts',
    ],
  }),
  rule({
    id: 'metric.lifetime_aggregates',
    dataClass: 'guest_lifetime_aggregates',
    ownerContext: 'metric',
    ownerRole: 'Metric context owner',
    sourceKind: 'table',
    source: 'portal_metric_lifetime_aggregates',
    eligibility: {
      anchorColumn: null,
      horizon: { kind: 'retained_no_age_expiry' },
      predicate: null,
      query:
        'No age-based eligibility. The anonymous lifetime aggregate is retained while its Portal exists. Corrections and withdrawals MUST be applied to it BEFORE the 24-month source-fact purge; otherwise the aggregate keeps a contribution whose source is gone and can never be reconciled again.',
      implementedBoundary:
        'No deletion rule exists or is proposed. The ordering constraint against guest.deidentified_facts is the operative control.',
    },
    evidenceSubject: 'portal_metric_lifetime_aggregates.reconciled',
    restoreImplication:
      'Restoring the aggregate without the matching source facts (or the reverse) reintroduces exactly the divergence the pre-purge reconciliation exists to prevent; both must be restored to the same point in time and reconciled before metrics are readable.',
    blockingCounselDecisions: ['retention_classes.unresolved_base_guest_metric_facts'],
  }),
  rule({
    id: 'notification.delivery_records',
    dataClass: 'notifications',
    ownerContext: 'notification',
    ownerRole: 'Notification context owner',
    sourceKind: 'table',
    source: 'notifications',
    eligibility: {
      anchorColumn: 'created_at',
      horizon: { kind: 'days', days: 90 },
      predicate: null,
      query:
        "SELECT id FROM notifications WHERE created_at < now() - interval '90 days' — keyed on creation, so marking a notification read or seen does not extend it.",
      implementedBoundary:
        'Live at ninety days, together with the terminal digest-batch and email-queue subjects, which retain open retry work by predicate.',
    },
    evidenceSubject: 'notifications',
    restoreImplication: RESTORE_REPLAYS_DELETION,
    blockingCounselDecisions: ['retention_classes.terminal_notification_evidence'],
  }),
  rule({
    id: 'activity.recent_activity',
    dataClass: 'recent_activity',
    ownerContext: 'activity',
    ownerRole: 'Activity context owner',
    sourceKind: 'table',
    source: 'recent_activity_entries',
    eligibility: {
      anchorColumn: 'created_at',
      horizon: { kind: 'days', days: 90 },
      predicate: null,
      query:
        "SELECT id FROM recent_activity_entries WHERE created_at < now() - interval '90 days'. The replay authority recent_activity_replay_facts expires on the same ninety-day source clock (source_occurred_at), so the projection cannot outlive its source.",
      implementedBoundary:
        'Live at ninety days for both the projection and its replay authority; actor-label redactions expire on their own stamped deadline.',
    },
    evidenceSubject: 'recent_activity_entries',
    restoreImplication: RESTORE_REPLAYS_DELETION,
    blockingCounselDecisions: ['retention_classes.recent_activity_storage'],
  }),
  rule({
    id: 'activity.operational_action_history',
    dataClass: 'operational_action_history',
    ownerContext: 'activity',
    ownerRole: 'Activity context owner with the compliance owner',
    sourceKind: 'table',
    source: 'operational_action_history_records',
    eligibility: {
      anchorColumn: 'occurred_at',
      horizon: { kind: 'counsel_undecided' },
      predicate: 'no active legal hold covers the record',
      query:
        'SELECT id FROM operational_action_history_records WHERE occurred_at < :cutoff AND no operational_action_history_legal_holds row covers it. The proposed 365-day horizon is REPORT-ONLY.',
      implementedBoundary:
        'No destructive lifecycle is armed for this table. The related 365-day audit horizon that IS live applies to policy_decision_audit and audit_logs only.',
    },
    evidenceSubject: 'operational_action_history_records.expired',
    restoreImplication:
      'Action history is the evidence chain for operator actions. A restore that reinstates purged records without reinstating the purge evidence makes the record set unexplainable; restore both or neither.',
    blockingCounselDecisions: ['retention_classes.policy_decision_records'],
  }),
  rule({
    id: 'platform.logs_sentry_replay_screenshots',
    dataClass: 'logs_sentry_replay_screenshots',
    ownerContext: 'platform',
    ownerRole: 'Platform operations owner with the processor owner',
    sourceKind: 'external_processor',
    source: 'error-monitoring and platform log retention (external processors)',
    eligibility: {
      anchorColumn: null,
      horizon: { kind: 'counsel_undecided' },
      predicate: null,
      query:
        'Not a RepKey query. The horizon is whatever the processor plan enforces and MUST be read back from the processor console and recorded as evidence; this repository cannot observe it and must not assert it.',
      implementedBoundary:
        'Unverified from this repository. No retention claim about session replay or screenshots may be published until the processor setting is read back and attached.',
    },
    evidenceSubject: 'external.processor_retention_attestation',
    restoreImplication: RESTORE_EXTERNAL,
    blockingCounselDecisions: [
      'processors_and_transfers.monitoring_region',
      'processors_and_transfers.provider_schedule',
    ],
  }),
  rule({
    id: 'ai.local_derivatives',
    dataClass: 'ai_derivatives',
    ownerContext: 'ai',
    ownerRole: 'AI context owner with the authorizing AccountAdmin',
    sourceKind: 'table',
    source: 'ai_review_analyses',
    eligibility: {
      anchorColumn: 'expires_at',
      horizon: { kind: 'counsel_undecided' },
      predicate: 'the owning authorization is withdrawn or the generation is retired',
      query:
        'Erasure is driven by AccountAdmin-requested erasure and generation retirement within 24 hours, not by an age cutoff. generated_at/expires_at bound freshness reuse, not retention.',
      implementedBoundary:
        'Live: exact retired-generation local derivative erasure with content-free evidence. There is no age-based purge and none is proposed.',
    },
    evidenceSubject: 'ai.authorization_erasure',
    restoreImplication:
      'A restore can resurrect derivatives whose authorization was withdrawn. The erasure ledger must be replayed after restore before any AI output is readable again.',
    blockingCounselDecisions: ['processors_and_transfers.ai_provider_terms'],
  }),
  rule({
    id: 'platform.uploads',
    dataClass: 'uploads',
    ownerContext: 'guest',
    ownerRole: 'Guest context owner with the Platform storage owner',
    sourceKind: 'object_store',
    source: 'guest response media objects (capability-issued bucket prefix)',
    eligibility: {
      anchorColumn: null,
      horizon: { kind: 'counsel_undecided' },
      predicate: 'the object has no live guest_response_media row',
      query:
        'Portal upload is a dark capability, so the live population is orphaned objects only. Inventory them; do not purge on a horizon nobody has approved.',
      implementedBoundary:
        'No purge runs. guest_response_media is classified quarantined_reconciliation_input and stays beta-disabled.',
    },
    evidenceSubject: 'object_store.orphan_inventory',
    restoreImplication:
      'Object storage and PostgreSQL restore independently. An object restored without its row is invisible to every deletion path, so the orphan inventory must be re-run after any restore.',
    blockingCounselDecisions: ['retention_classes.unresolved_legacy_compatibility_rows'],
  }),
  rule({
    id: 'platform.quarantine',
    dataClass: 'quarantine',
    ownerContext: 'metric',
    ownerRole: 'Metric context owner with Platform operations',
    sourceKind: 'table',
    source: 'metric_quarantine',
    eligibility: {
      anchorColumn: 'quarantined_at',
      horizon: { kind: 'counsel_undecided' },
      predicate: 'resolved_at IS NOT NULL',
      query:
        'Quarantine rows are reconciliation input. Eligibility is a reviewed terminal disposition (resolved_at IS NOT NULL), never age alone; an age cutoff would discard unreconciled evidence a metric correction still depends on.',
      implementedBoundary:
        'No age-based purge runs against metric_quarantine. The separate quarantine.ttl subject bounds the job-queue quarantine, which holds no tenant content.',
    },
    evidenceSubject: 'metric_quarantine.resolved',
    restoreImplication:
      'Restoring quarantine rows after reconciliation replays already-resolved conflicts. Reconcile against the current canonical set rather than re-applying past dispositions.',
    blockingCounselDecisions: ['retention_classes.unresolved_legacy_compatibility_rows'],
  }),
  rule({
    id: 'integration.provider_tokens',
    dataClass: 'provider_tokens',
    ownerContext: 'integration',
    ownerRole: 'Integration context owner',
    sourceKind: 'table',
    source: 'google_oauth_exchange_attempts',
    eligibility: {
      anchorColumn: 'response_expires_at',
      horizon: { kind: 'row_deadline' },
      predicate: null,
      query:
        'The application-encrypted provider response is one-use and erased on connection commit, deterministic rejection, ambiguous terminalization, or its database-recorded ten-minute expiry — whichever comes first. Only content-free outcome facts survive.',
      implementedBoundary:
        'Live and enforced by the owning connection saga, not by the retention sweep. Long-lived credentials themselves are never written to this table.',
    },
    evidenceSubject: 'google_oauth_exchange_attempts.erased',
    restoreImplication:
      'A restore can reinstate credential material that was deliberately erased. Provider credentials must be treated as compromised after any restore and reauthorized, never reused.',
    blockingCounselDecisions: ['google_terms_and_expiry.scope'],
  }),
  rule({
    id: 'lifecycle.organization_exports',
    dataClass: 'exports',
    ownerContext: 'identity',
    ownerRole: 'Identity context owner with the support/closure policy owner',
    sourceKind: 'object_store',
    source: 'organization export archives (encrypted export bucket prefix)',
    eligibility: {
      anchorColumn: 'object_expires_at',
      horizon: { kind: 'days', days: 7 },
      predicate: null,
      query:
        'SELECT id FROM organization_exports WHERE object_expires_at < now(), then prove the object is gone. Retrieval is a single-use 24-hour link; re-issuing or re-downloading extends neither clock.',
      implementedBoundary:
        'object_expires_at is stamped at generation. Deletion proof is the operative evidence and must accompany every expiry.',
    },
    evidenceSubject: 'organization_exports.purged',
    restoreImplication:
      'A restore can resurrect an export archive whose seven-day deletion was already proven. Export objects must be re-purged and the proof re-issued after any restore.',
    blockingCounselDecisions: ['rights.export_promise'],
  }),
  rule({
    id: 'platform.backups',
    dataClass: 'backups',
    ownerContext: 'platform',
    ownerRole: 'Platform operations owner with the compliance owner',
    sourceKind: 'external_processor',
    source: 'managed PostgreSQL backups and the backup erasure ledger',
    eligibility: {
      anchorColumn: null,
      horizon: { kind: 'counsel_undecided' },
      predicate: null,
      query:
        'A backup may retain data past a deletion only under a documented delayed-erasure policy. The erasure ledger records what must not be resurrected; the backup rotation window is the real horizon and must be read back from the provider, not asserted here.',
      implementedBoundary:
        'The erasure ledger exists as the restore fence. The rotation window is unverified from this repository and no notice may state a number until it is read back.',
    },
    evidenceSubject: 'backup_erasure_ledger',
    restoreImplication:
      'This is the class that makes every other restore implication true: any restore reintroduces rows deleted after the backup was taken. The erasure ledger must be replayed and every retention subject re-swept before the cell is reopened.',
    blockingCounselDecisions: ['retention_classes.unresolved_restored_backups'],
  }),
] satisfies ReadonlyArray<RetentionRegistryRule>)

/**
 * Pseudonym redactions that still run against pre-beta compatibility mirrors.
 *
 * They are recorded here and NOT in the registry on purpose. A mirror may not
 * be a retention source, but the mirrors do hold `ip_hash` and `session_id`
 * pseudonyms and the seven-day §3.3.10 default has to reach them. Redaction
 * satisfies both: the pseudonym goes, every row stays, and the contraction
 * inventory still counts exactly what it counted before.
 *
 * The invariant the test enforces is that these are the ONLY sweep rules
 * touching a contraction candidate, and that every one of them is `redact`.
 */
export const LEGACY_MIRROR_PSEUDONYM_REDACTIONS = Object.freeze(
  (['scan_events', 'ratings', 'feedback'] as const).flatMap((table) => [
    Object.freeze({
      subject: `${table}.abuse_pseudonym`,
      table,
      registryRuleId: 'guest.abuse_pseudonym',
      redactedColumn: 'ip_hash',
    }),
    Object.freeze({
      subject: `${table}.guest_session_pseudonym`,
      table,
      registryRuleId: 'guest.session_pseudonym',
      redactedColumn: 'session_id',
    }),
  ]),
)

export type RetentionRegistryClassCoverage = Readonly<{
  classCount: number
  coveredCount: number
  uncoveredClasses: ReadonlyArray<RetentionDataClass>
  complete: boolean
}>

export function retentionRegistryClassCoverage(
  registry: ReadonlyArray<RetentionRegistryRule>,
): RetentionRegistryClassCoverage {
  const covered = new Set(registry.map(({ dataClass }) => dataClass))
  const uncoveredClasses = RETENTION_DATA_CLASSES.filter(
    (dataClass) => !covered.has(dataClass),
  )
  return Object.freeze({
    classCount: RETENTION_DATA_CLASSES.length,
    coveredCount: RETENTION_DATA_CLASSES.length - uncoveredClasses.length,
    uncoveredClasses: Object.freeze(uncoveredClasses),
    complete: uncoveredClasses.length === 0,
  })
}

/** Ids of every rule that may not run in apply mode yet. */
export function retentionRegistryApprovalBlockers(
  registry: ReadonlyArray<RetentionRegistryRule>,
): ReadonlyArray<string> {
  return registry
    .filter(({ approvalState }) => approvalState === 'pending_counsel')
    .map(({ id }) => id)
}

/**
 * The single gate destructive execution must pass. It throws rather than
 * returning false so a caller cannot ignore the result by accident.
 */
export function assertRetentionRegistryApplyAllowed(rule: RetentionRegistryRule): void {
  if (rule.approvalState !== 'pending_counsel') return
  throw new Error(
    `retention rule '${rule.id}' is pending_counsel and cannot run in apply mode; ` +
      `blocking counsel decisions: ${rule.blockingCounselDecisions.join(', ') || 'none recorded'}`,
  )
}

export type RetentionRegistryContractionViolation = Readonly<{
  ruleId: string
  source: string
}>

/**
 * A retention rule over a compatibility mirror or bounded-contraction table
 * would perform the contraction early — before the one verified release plus
 * restore proof that gates it — and would erase the inventory the decision
 * rests on. The candidate set is passed in so this module does not have to pull
 * the whole Drizzle schema graph into every consumer.
 */
export function retentionRegistryContractionViolations(
  registry: ReadonlyArray<RetentionRegistryRule>,
  contractionCandidateTables: ReadonlyArray<string>,
): ReadonlyArray<RetentionRegistryContractionViolation> {
  const candidates = new Set(contractionCandidateTables)
  // Matched on the source name alone, NOT on sourceKind: relabelling a mirror
  // as an object store would otherwise walk straight through this guard.
  return registry
    .filter((rule) => candidates.has(rule.source))
    .map(({ id, source }) => Object.freeze({ ruleId: id, source }))
}

export type RetentionRegistryDeadlineViolation = Readonly<{
  ruleId: string
  anchorColumn: string
}>

/** Reading, moderating or archiving must never extend a content deadline. */
export function retentionRegistryDeadlineExtensionViolations(
  registry: ReadonlyArray<RetentionRegistryRule>,
): ReadonlyArray<RetentionRegistryDeadlineViolation> {
  const neutral = new Set(DEADLINE_NEUTRAL_COLUMNS)
  const contentClasses = new Set<RetentionDataClass>(CONTENT_DEADLINE_CLASSES)
  return registry
    .filter(
      (rule) =>
        contentClasses.has(rule.dataClass) &&
        rule.eligibility.anchorColumn !== null &&
        neutral.has(rule.eligibility.anchorColumn),
    )
    .map((rule) =>
      Object.freeze({
        ruleId: rule.id,
        anchorColumn: rule.eligibility.anchorColumn as string,
      }),
    )
}

export type RetentionRegistryPlan = Readonly<{
  mode: 'report_only' | 'bounded_apply'
  approvedRuleIds: ReadonlyArray<string>
  applyBlockedRuleIds: ReadonlyArray<string>
}>

/**
 * The only execution plan the registry can currently produce. It degrades to
 * 'bounded_apply' only when every rule carries an approval artifact, so a
 * partially approved matrix still ships report-only.
 */
export function retentionRegistryReportOnlyPlan(
  registry: ReadonlyArray<RetentionRegistryRule>,
): RetentionRegistryPlan {
  const applyBlockedRuleIds = retentionRegistryApprovalBlockers(registry)
  const approvedRuleIds = registry
    .filter(({ approvalState }) => approvalState === 'approved')
    .map(({ id }) => id)
  return Object.freeze({
    mode: applyBlockedRuleIds.length === 0 ? 'bounded_apply' : 'report_only',
    approvedRuleIds: Object.freeze(approvedRuleIds),
    applyBlockedRuleIds: Object.freeze(applyBlockedRuleIds),
  })
}
