// OBS-01 — content-free local authority for native beta-feedback triage.
//
// Report text and masked SVG bytes stay in the restricted Germany-hosted
// monitoring project. These tables retain only pseudonyms, controlled enums,
// provider linkage, classifications, ownership, and state-transition evidence.

import { desc, sql } from 'drizzle-orm'
import {
  char,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const betaFeedbackTriage = pgTable(
  'beta_feedback_triage',
  {
    reference: uuid('reference').primaryKey(),
    organizationPseudonym: char('organization_pseudonym', { length: 64 }).notNull(),
    actorPseudonym: char('actor_pseudonym', { length: 64 }).notNull(),
    feedbackType: varchar('feedback_type', { length: 16 }).notNull(),
    impactCode: varchar('impact_code', { length: 32 }).notNull(),
    routeKey: varchar('route_key', { length: 80 }).notNull(),
    viewport: varchar('viewport', { length: 16 }).notNull(),
    reporterRole: varchar('reporter_role', { length: 32 }).notNull(),
    deliveryState: varchar('delivery_state', { length: 16 }).notNull(),
    providerReference: varchar('provider_reference', { length: 64 }),
    deliveryFailureCode: varchar('delivery_failure_code', { length: 48 }),
    attachmentKind: varchar('attachment_kind', { length: 32 }).notNull(),
    attachmentCapturedAt: timestamptz('attachment_captured_at'),
    attachmentExpiresAt: timestamptz('attachment_expires_at'),
    triageState: varchar('triage_state', { length: 24 }).notNull().default('new'),
    severity: varchar('severity', { length: 16 }).notNull().default('unclassified'),
    privacyClass: varchar('privacy_class', { length: 16 }).notNull().default('pending'),
    securityClass: varchar('security_class', { length: 16 }).notNull().default('pending'),
    reproduction: varchar('reproduction', { length: 24 }).notNull().default('pending'),
    dedupeDisposition: varchar('dedupe_disposition', { length: 16 })
      .notNull()
      .default('pending'),
    duplicateOfReference: uuid('duplicate_of_reference'),
    ownerQueue: varchar('owner_queue', { length: 24 }).notNull().default('beta_support'),
    ownerPseudonym: char('owner_pseudonym', { length: 64 }),
    customerResponse: varchar('customer_response', { length: 24 })
      .notNull()
      .default('pending'),
    engineeringIssueRef: varchar('engineering_issue_ref', { length: 200 }),
    revision: integer('revision').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'beta_feedback_triage_pseudonyms_valid',
      sql`${t.organizationPseudonym} ~ '^[a-f0-9]{64}$' AND ${t.actorPseudonym} ~ '^[a-f0-9]{64}$' AND (${t.ownerPseudonym} IS NULL OR ${t.ownerPseudonym} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'beta_feedback_triage_feedback_type_valid',
      sql`${t.feedbackType} IN ('bug', 'suggestion')`,
    ),
    check(
      'beta_feedback_triage_impact_valid',
      sql`${t.impactCode} IN ('cannot_complete', 'workaround_available', 'small_issue', 'important', 'helpful', 'nice_to_have')`,
    ),
    check(
      'beta_feedback_triage_viewport_valid',
      sql`${t.viewport} IN ('compact', 'regular', 'wide')`,
    ),
    check(
      'beta_feedback_triage_reporter_role_valid',
      sql`${t.reporterRole} IN ('AccountAdmin', 'PropertyManager', 'Staff')`,
    ),
    check(
      'beta_feedback_triage_delivery_valid',
      sql`${t.deliveryState} IN ('prepared', 'delivered', 'failed')`,
    ),
    check(
      'beta_feedback_triage_delivery_shape',
      sql`(${t.deliveryState} = 'prepared' AND ${t.providerReference} IS NULL AND ${t.deliveryFailureCode} IS NULL)
        OR (${t.deliveryState} = 'delivered' AND ${t.providerReference} ~ '^[a-f0-9]{32,64}$' AND ${t.deliveryFailureCode} IS NULL)
        OR (${t.deliveryState} = 'failed' AND ${t.providerReference} IS NULL AND ${t.deliveryFailureCode} ~ '^[a-z][a-z0-9_]{0,47}$')`,
    ),
    check(
      'beta_feedback_triage_attachment_kind_valid',
      sql`${t.attachmentKind} IN ('none', 'masked_layout_v1')`,
    ),
    check(
      'beta_feedback_triage_attachment_shape',
      sql`(${t.attachmentKind} = 'none' AND ${t.attachmentCapturedAt} IS NULL AND ${t.attachmentExpiresAt} IS NULL)
        OR (${t.attachmentKind} = 'masked_layout_v1'
          AND ${t.feedbackType} = 'bug'
          AND ${t.attachmentCapturedAt} IS NOT NULL
          AND ${t.attachmentExpiresAt} > ${t.attachmentCapturedAt}
          AND ${t.attachmentExpiresAt} <= ${t.attachmentCapturedAt} + interval '30 days')`,
    ),
    check(
      'beta_feedback_triage_state_valid',
      sql`${t.triageState} IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved')`,
    ),
    check(
      'beta_feedback_triage_severity_valid',
      sql`${t.severity} IN ('unclassified', 'P0', 'P1', 'P2', 'P3')`,
    ),
    check(
      'beta_feedback_triage_privacy_valid',
      sql`${t.privacyClass} IN ('pending', 'clear', 'restricted', 'escalated')`,
    ),
    check(
      'beta_feedback_triage_security_valid',
      sql`${t.securityClass} IN ('pending', 'none', 'suspected', 'confirmed')`,
    ),
    check(
      'beta_feedback_triage_reproduction_valid',
      sql`${t.reproduction} IN ('pending', 'reproduced', 'not_reproduced', 'not_applicable')`,
    ),
    check(
      'beta_feedback_triage_dedupe_valid',
      sql`${t.dedupeDisposition} IN ('pending', 'unique', 'duplicate') AND ((${t.dedupeDisposition} = 'duplicate' AND ${t.duplicateOfReference} IS NOT NULL AND ${t.duplicateOfReference} <> ${t.reference}) OR (${t.dedupeDisposition} <> 'duplicate' AND ${t.duplicateOfReference} IS NULL))`,
    ),
    check(
      'beta_feedback_triage_owner_valid',
      sql`${t.ownerQueue} IN ('beta_support', 'privacy', 'security', 'engineering')`,
    ),
    check(
      'beta_feedback_triage_customer_response_valid',
      sql`${t.customerResponse} IN ('pending', 'not_required', 'sent')`,
    ),
    check(
      'beta_feedback_triage_issue_ref_valid',
      sql`${t.engineeringIssueRef} IS NULL OR ${t.engineeringIssueRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'`,
    ),
    check(
      'beta_feedback_triage_classification_shape',
      sql`${t.triageState} = 'new' OR (${t.severity} <> 'unclassified' AND ${t.privacyClass} <> 'pending' AND ${t.securityClass} <> 'pending' AND ${t.ownerPseudonym} IS NOT NULL)`,
    ),
    check(
      'beta_feedback_triage_security_owner_shape',
      sql`${t.securityClass} NOT IN ('suspected', 'confirmed') OR ${t.ownerQueue} = 'security'`,
    ),
    check(
      'beta_feedback_triage_privacy_owner_shape',
      sql`${t.privacyClass} <> 'escalated' OR ${t.ownerQueue} IN ('privacy', 'security')`,
    ),
    check(
      'beta_feedback_triage_decision_shape',
      sql`${t.triageState} NOT IN ('accepted', 'declined', 'resolved') OR (${t.reproduction} <> 'pending' AND ${t.dedupeDisposition} <> 'pending')`,
    ),
    check(
      'beta_feedback_triage_issue_shape',
      sql`${t.engineeringIssueRef} IS NULL OR ${t.triageState} IN ('accepted', 'resolved')`,
    ),
    check(
      'beta_feedback_triage_resolution_shape',
      sql`${t.triageState} <> 'resolved' OR ${t.customerResponse} <> 'pending'`,
    ),
    check('beta_feedback_triage_revision_nonnegative', sql`${t.revision} >= 0`),
    foreignKey({
      name: 'beta_feedback_triage_duplicate_reference_fk',
      columns: [t.duplicateOfReference],
      foreignColumns: [t.reference],
    }).onDelete('restrict'),
    uniqueIndex('beta_feedback_triage_provider_reference_unique').on(t.providerReference),
    index('beta_feedback_triage_work_queue_idx').on(
      t.ownerQueue,
      t.triageState,
      desc(t.updatedAt),
    ),
    index('beta_feedback_triage_delivery_idx').on(t.deliveryState, desc(t.createdAt)),
    index('beta_feedback_triage_attachment_expiry_idx').on(t.attachmentExpiresAt),
  ],
)

export const betaFeedbackTriageTransitions = pgTable(
  'beta_feedback_triage_transitions',
  {
    transitionId: uuid('transition_id').primaryKey(),
    feedbackReference: uuid('feedback_reference')
      .notNull()
      .references(() => betaFeedbackTriage.reference, { onDelete: 'restrict' }),
    fromState: varchar('from_state', { length: 24 }).notNull(),
    toState: varchar('to_state', { length: 24 }).notNull(),
    resultRevision: integer('result_revision').notNull(),
    severity: varchar('severity', { length: 16 }).notNull(),
    privacyClass: varchar('privacy_class', { length: 16 }).notNull(),
    securityClass: varchar('security_class', { length: 16 }).notNull(),
    reproduction: varchar('reproduction', { length: 24 }).notNull(),
    dedupeDisposition: varchar('dedupe_disposition', { length: 16 }).notNull(),
    duplicateOfReference: uuid('duplicate_of_reference'),
    ownerQueue: varchar('owner_queue', { length: 24 }).notNull(),
    ownerPseudonym: char('owner_pseudonym', { length: 64 }),
    customerResponse: varchar('customer_response', { length: 24 }).notNull(),
    engineeringIssueRef: varchar('engineering_issue_ref', { length: 200 }),
    operatorPseudonym: char('operator_pseudonym', { length: 64 }).notNull(),
    reasonCode: varchar('reason_code', { length: 64 }).notNull(),
    supportEvidenceRef: varchar('support_evidence_ref', { length: 200 }).notNull(),
    occurredAt: timestamptz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'beta_feedback_triage_transition_states_valid',
      sql`${t.fromState} IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved') AND ${t.toState} IN ('new', 'screened', 'reproducing', 'accepted', 'declined', 'resolved')`,
    ),
    check(
      'beta_feedback_triage_transition_revision_positive',
      sql`${t.resultRevision} > 0`,
    ),
    check(
      'beta_feedback_triage_transition_operator_valid',
      sql`${t.operatorPseudonym} ~ '^[a-f0-9]{64}$' AND (${t.ownerPseudonym} IS NULL OR ${t.ownerPseudonym} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'beta_feedback_triage_transition_reason_valid',
      sql`${t.reasonCode} ~ '^[a-z][a-z0-9_]{0,63}$' AND ${t.supportEvidenceRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$'`,
    ),
    check(
      'beta_feedback_triage_transition_classification_shape',
      sql`${t.severity} IN ('unclassified', 'P0', 'P1', 'P2', 'P3') AND ${t.privacyClass} IN ('pending', 'clear', 'restricted', 'escalated') AND ${t.securityClass} IN ('pending', 'none', 'suspected', 'confirmed') AND ${t.reproduction} IN ('pending', 'reproduced', 'not_reproduced', 'not_applicable') AND ${t.ownerQueue} IN ('beta_support', 'privacy', 'security', 'engineering') AND ${t.customerResponse} IN ('pending', 'not_required', 'sent') AND (${t.toState} = 'new' OR (${t.severity} <> 'unclassified' AND ${t.privacyClass} <> 'pending' AND ${t.securityClass} <> 'pending' AND ${t.ownerPseudonym} IS NOT NULL))`,
    ),
    check(
      'beta_feedback_triage_transition_dedupe_shape',
      sql`${t.dedupeDisposition} IN ('pending', 'unique', 'duplicate') AND ((${t.dedupeDisposition} = 'duplicate' AND ${t.duplicateOfReference} IS NOT NULL AND ${t.duplicateOfReference} <> ${t.feedbackReference}) OR (${t.dedupeDisposition} <> 'duplicate' AND ${t.duplicateOfReference} IS NULL))`,
    ),
    check(
      'beta_feedback_triage_transition_owner_shape',
      sql`(${t.securityClass} NOT IN ('suspected', 'confirmed') OR ${t.ownerQueue} = 'security') AND (${t.privacyClass} <> 'escalated' OR ${t.ownerQueue} IN ('privacy', 'security'))`,
    ),
    check(
      'beta_feedback_triage_transition_decision_shape',
      sql`${t.toState} NOT IN ('accepted', 'declined', 'resolved') OR (${t.reproduction} <> 'pending' AND ${t.dedupeDisposition} <> 'pending')`,
    ),
    check(
      'beta_feedback_triage_transition_issue_shape',
      sql`${t.engineeringIssueRef} IS NULL OR (${t.engineeringIssueRef} ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{0,199}$' AND ${t.toState} IN ('accepted', 'resolved'))`,
    ),
    check(
      'beta_feedback_triage_transition_resolution_shape',
      sql`${t.toState} <> 'resolved' OR ${t.customerResponse} <> 'pending'`,
    ),
    foreignKey({
      name: 'beta_feedback_triage_transition_duplicate_reference_fk',
      columns: [t.duplicateOfReference],
      foreignColumns: [betaFeedbackTriage.reference],
    }).onDelete('restrict'),
    uniqueIndex('beta_feedback_triage_transition_revision_unique').on(
      t.feedbackReference,
      t.resultRevision,
    ),
    index('beta_feedback_triage_transition_reference_idx').on(
      t.feedbackReference,
      desc(t.occurredAt),
    ),
  ],
)
