/**
 * The vocabulary of the counsel-ready retention registry: its data classes, the
 * shape of a rule, and the one constructor a rule may be built with. The matrix
 * itself is `retention-registry.ts`.
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
  'beta_feedback_masked_layout',
  'ai_derivatives',
  'uploads',
  'provider_tokens',
  'exports',
  'backups',
] as const)

export type RetentionDataClass = (typeof RETENTION_DATA_CLASSES)[number]

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
  /** Declarative operation. Omitted entries are destructive row deletion. */
  operation?: 'delete' | 'redact'
  /** Columns cleared by a row-preserving redaction. */
  redactColumns?: ReadonlyArray<string>
  eligibility: RetentionEligibility
  /** `retention_runs.subject`, or a named external evidence record. */
  evidenceSubject: string
  restoreImplication: string
  approvalState: RetentionApprovalState
  approvalArtifact: string | null
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
export function defineRetentionRegistryRule(
  input: RetentionRegistryRuleInput,
): RetentionRegistryRule {
  const approvalArtifact = input.approvalArtifact ?? null
  return Object.freeze({
    ...input,
    approvalArtifact,
    approvalState: approvalArtifact ? 'approved' : 'pending_counsel',
  })
}

/** The restore implication of every rule that deletes rows on a cutoff. */
export const RESTORE_REPLAYS_DELETION =
  'A restore from a backup taken before the cutoff reinstates rows this rule already removed; the post-restore retention sweep must be re-run and its evidence linked to the restore before the cell is reopened.'
