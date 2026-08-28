// Inbox context — Drizzle schema for inbox_items, inbox_notes & inbox_user_views
// Per ADR 0023: status is open/closed; escalation is an orthogonal flag.

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { materialReviewRevisions } from './review.schema'
import { properties } from './property.schema'
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  primaryKey,
  uuid,
  varchar,
  integer,
  boolean,
  text,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

export const inboxSourceTypeEnum = pgEnum('inbox_source_type', ['review', 'feedback'])

export const inboxStatusEnum = pgEnum('inbox_status', ['open', 'closed'])

export const inboxAssignmentReasonEnum = pgEnum('inbox_assignment_reason', [
  'claim',
  'assign',
  'reassign',
  'release',
  'eligibility_lost',
  'reopen_restore',
])

export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sourceType: inboxSourceTypeEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    status: inboxStatusEnum('status').notNull().default('open'),
    // Escalation flag — orthogonal to status (ADR 0023)
    isEscalated: boolean('is_escalated').notNull().default(false),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    escalatedBy: varchar('escalated_by', { length: 255 }),
    escalationResolvedAt: timestamp('escalation_resolved_at', { withTimezone: true }),
    escalationResolvedBy: varchar('escalation_resolved_by', { length: 255 }),
    rating: integer('rating'),
    sourceDate: timestamp('source_date', { withTimezone: true }).notNull(),
    platform: varchar('platform', { length: 255 }),
    snippet: text('snippet'),
    reviewerName: varchar('reviewer_name', { length: 255 }),
    assignedTo: varchar('assigned_to', { length: 255 }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    firstReplySubmittedAt: timestamp('first_reply_submitted_at', { withTimezone: true }),
    firstReplyPublishedAt: timestamp('first_reply_published_at', { withTimezone: true }),
    // Optimistic concurrency fence for every human-authored Inbox command.
    // Durable source consumers additionally fence the Handling Cycle head.
    commandRevision: bigint('command_revision', { mode: 'number' }).notNull().default(1),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('inbox_items_org_status_idx').on(t.organizationId, t.status),
    index('inbox_items_org_source_date_idx').on(
      t.organizationId,
      t.sourceDate.desc(),
      t.id.desc(),
    ),
    index('inbox_items_org_property_idx').on(t.organizationId, t.propertyId),
    // Composite index for attention signal count queries (org + property + status)
    index('inbox_items_org_property_status_idx').on(
      t.organizationId,
      t.propertyId,
      t.status,
    ),
    // Escalated-folder count: active flag (is_escalated AND escalation_resolved_at IS NULL)
    index('inbox_items_org_escalated_active_idx').on(
      t.organizationId,
      t.isEscalated,
      t.escalationResolvedAt,
    ),
    uniqueIndex('inbox_items_source_unique').on(
      t.sourceType,
      t.sourceId,
      t.organizationId,
    ),
    // Canonical source-scope authority for Handling Cycle foreign keys. The
    // older source_unique index remains the public idempotency anchor.
    uniqueIndex('inbox_items_cycle_source_scope_unique').on(
      t.id,
      t.organizationId,
      t.sourceType,
      t.sourceId,
    ),
    // Migration 0008: cross-org date-ordered scan for incremental rollups.
    index('inbox_items_source_date_idx').on(t.sourceDate),
    // Cross-tenant keyset scan for the notification-gap reconciliation sweep
    // (reconcile-missing-notifications): "items created in the last N hours"
    // ordered by (created_at, id). source_date is the review's own date, so
    // the existing source_date index cannot answer it — an imported backlog
    // lands with old source dates and a brand-new created_at.
    index('inbox_items_created_at_idx').on(t.createdAt, t.id),
    check(
      'inbox_items_command_revision_safe',
      sql`${t.commandRevision} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    check(
      'inbox_items_review_source_content_free',
      sql`${t.sourceType} <> 'review' OR (${t.rating} IS NULL AND ${t.snippet} IS NULL AND ${t.reviewerName} IS NULL)`,
    ),
  ],
)

/**
 * Immutable opening facts for numbered source Handling Cycles (ADR 0055).
 *
 * The mutable current pointer lives in `inbox_handling_cycle_heads`; starting
 * another cycle only appends here, so an earlier work episode and its source
 * revision anchor are never rewritten. A Review cycle is anchored to a
 * Material Review Revision; a feedback cycle is anchored to the Guest
 * Response Revision at which private feedback was submitted.
 */
export const inboxHandlingCycles = pgTable(
  'inbox_handling_cycles',
  {
    inboxItemId: uuid('inbox_item_id')
      .notNull()
      .references(() => inboxItems.id, { onDelete: 'cascade' }),
    cycleNumber: bigint('cycle_number', { mode: 'number' }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceType: inboxSourceTypeEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    // Review compatibility columns retain the material-revision FK while
    // feedback rows deliberately leave both null.
    reviewId: uuid('review_id'),
    materialReviewRevision: bigint('material_review_revision', {
      mode: 'number',
    }),
    openedReason: varchar('opened_reason', { length: 48 }).notNull(),
    manualReopenReason: varchar('manual_reopen_reason', { length: 48 }),
    manualReopenExplanation: varchar('manual_reopen_explanation', { length: 280 }),
    supersedesCycleNumber: bigint('supersedes_cycle_number', { mode: 'number' }),
    openedBy: varchar('opened_by', { length: 255 }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_handling_cycles_pk',
      columns: [t.inboxItemId, t.cycleNumber],
    }),
    foreignKey({
      name: 'inbox_handling_cycles_material_revision_fk',
      columns: [t.reviewId, t.materialReviewRevision],
      foreignColumns: [
        materialReviewRevisions.reviewId,
        materialReviewRevisions.revision,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'inbox_handling_cycles_source_scope_fk',
      columns: [t.inboxItemId, t.organizationId, t.sourceType, t.sourceId],
      foreignColumns: [
        inboxItems.id,
        inboxItems.organizationId,
        inboxItems.sourceType,
        inboxItems.sourceId,
      ],
    }).onDelete('cascade'),
    index('inbox_handling_cycles_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.inboxItemId,
      t.cycleNumber,
    ),
    index('inbox_handling_cycles_review_revision_idx').on(
      t.reviewId,
      t.materialReviewRevision,
      t.cycleNumber,
    ),
    index('inbox_handling_cycles_source_revision_idx').on(
      t.sourceType,
      t.sourceId,
      t.sourceRevision,
      t.cycleNumber,
    ),
    uniqueIndex('inbox_handling_cycles_outcome_scope_unique').on(
      t.inboxItemId,
      t.cycleNumber,
      t.organizationId,
      t.propertyId,
      t.sourceType,
      t.sourceId,
      t.sourceRevision,
    ),
    check(
      'inbox_handling_cycles_sequence_safe',
      sql`${t.cycleNumber} BETWEEN 1 AND '9007199254740991'::bigint
        AND (
          (${t.cycleNumber} = 1 AND ${t.supersedesCycleNumber} IS NULL)
          OR
          (${t.cycleNumber} > 1 AND ${t.supersedesCycleNumber} = ${t.cycleNumber} - 1)
        )`,
    ),
    check(
      'inbox_handling_cycles_reason_valid',
      sql`${t.openedReason} IN (
        'legacy_backfill',
        'review_observed',
        'feedback_submitted',
        'material_revision_changed',
        'manual_reopen',
        'provider_reply_deleted',
        'provider_reply_diverged'
      )`,
    ),
    check(
      'inbox_handling_cycles_source_anchor_valid',
      sql`${t.sourceRevision} BETWEEN 1 AND '9007199254740991'::bigint
        AND (
          (
            ${t.sourceType} = 'review'
            AND ${t.reviewId} = ${t.sourceId}
            AND ${t.materialReviewRevision} = ${t.sourceRevision}
            AND ${t.openedReason} <> 'feedback_submitted'
          ) OR (
            ${t.sourceType} = 'feedback'
            AND ${t.reviewId} IS NULL
            AND ${t.materialReviewRevision} IS NULL
            AND ${t.openedReason} IN ('legacy_backfill', 'feedback_submitted', 'manual_reopen')
          )
        )`,
    ),
    check(
      'inbox_handling_cycles_manual_reopen_valid',
      sql`(
        ${t.openedReason} <> 'manual_reopen'
        AND ${t.manualReopenReason} IS NULL
        AND ${t.manualReopenExplanation} IS NULL
      ) OR (
        ${t.openedReason} = 'manual_reopen'
        AND ${t.manualReopenReason} IS NOT NULL
        AND ${t.manualReopenReason} IN (
          'guest_follow_up_still_needed',
          'internal_follow_up_still_needed',
          'new_information',
          'correcting_handling_status',
          'other'
        )
        AND (
          (
            ${t.manualReopenReason} = 'other'
            AND ${t.manualReopenExplanation} IS NOT NULL
            AND length(btrim(${t.manualReopenExplanation})) BETWEEN 1 AND 280
          ) OR (
            ${t.manualReopenReason} <> 'other'
            AND ${t.manualReopenExplanation} IS NULL
          )
        )
      )`,
    ),
  ],
)

/**
 * Compare-and-swap head for the one current actionable source cycle.
 * Existing `inbox_items` columns remain as the compatibility projection while
 * readers and commands migrate to this explicit head.
 */
export const inboxHandlingCycleHeads = pgTable(
  'inbox_handling_cycle_heads',
  {
    inboxItemId: uuid('inbox_item_id')
      .primaryKey()
      .references(() => inboxItems.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceType: inboxSourceTypeEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    currentSourceRevision: bigint('current_source_revision', {
      mode: 'number',
    }).notNull(),
    reviewId: uuid('review_id'),
    currentCycleNumber: bigint('current_cycle_number', { mode: 'number' }).notNull(),
    currentMaterialReviewRevision: bigint('current_material_review_revision', {
      mode: 'number',
    }),
    stateRevision: bigint('state_revision', { mode: 'number' }).notNull().default(1),
    status: inboxStatusEnum('status').notNull().default('open'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    foreignKey({
      name: 'inbox_handling_cycle_heads_current_cycle_fk',
      columns: [t.inboxItemId, t.currentCycleNumber],
      foreignColumns: [inboxHandlingCycles.inboxItemId, inboxHandlingCycles.cycleNumber],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inbox_handling_cycle_heads_material_revision_fk',
      columns: [t.reviewId, t.currentMaterialReviewRevision],
      foreignColumns: [
        materialReviewRevisions.reviewId,
        materialReviewRevisions.revision,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'inbox_handling_cycle_heads_source_scope_fk',
      columns: [t.inboxItemId, t.organizationId, t.sourceType, t.sourceId],
      foreignColumns: [
        inboxItems.id,
        inboxItems.organizationId,
        inboxItems.sourceType,
        inboxItems.sourceId,
      ],
    }).onDelete('cascade'),
    index('inbox_handling_cycle_heads_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.status,
    ),
    check(
      'inbox_handling_cycle_heads_revisions_safe',
      sql`${t.currentCycleNumber} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.currentSourceRevision} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.stateRevision} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
    check(
      'inbox_handling_cycle_heads_source_anchor_valid',
      sql`(
        ${t.sourceType} = 'review'
        AND ${t.reviewId} = ${t.sourceId}
        AND ${t.currentMaterialReviewRevision} = ${t.currentSourceRevision}
      ) OR (
        ${t.sourceType} = 'feedback'
        AND ${t.reviewId} IS NULL
        AND ${t.currentMaterialReviewRevision} IS NULL
      )`,
    ),
  ],
)

/**
 * Append-only lifecycle evidence for source Handling Cycles. The composite
 * state revision key makes replay/reorder inert and lets the mutable head be
 * reconstructed without consulting transient Inbox projection state.
 */
export const inboxHandlingCycleTransitions = pgTable(
  'inbox_handling_cycle_transitions',
  {
    inboxItemId: uuid('inbox_item_id').notNull(),
    stateRevision: bigint('state_revision', { mode: 'number' }).notNull(),
    cycleNumber: bigint('cycle_number', { mode: 'number' }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceType: inboxSourceTypeEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    transitionReason: varchar('transition_reason', { length: 48 }).notNull(),
    actorType: varchar('actor_type', { length: 16 }).notNull(),
    actorUserId: varchar('actor_user_id', { length: 255 }),
    triggerEventId: uuid('trigger_event_id'),
    transitionedAt: timestamp('transitioned_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_handling_cycle_transitions_pk',
      columns: [t.inboxItemId, t.stateRevision],
    }),
    foreignKey({
      name: 'inbox_handling_cycle_transitions_cycle_fk',
      columns: [t.inboxItemId, t.cycleNumber],
      foreignColumns: [inboxHandlingCycles.inboxItemId, inboxHandlingCycles.cycleNumber],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inbox_handling_cycle_transitions_source_scope_fk',
      columns: [t.inboxItemId, t.organizationId, t.sourceType, t.sourceId],
      foreignColumns: [
        inboxItems.id,
        inboxItems.organizationId,
        inboxItems.sourceType,
        inboxItems.sourceId,
      ],
    }).onDelete('cascade'),
    index('inbox_handling_cycle_transitions_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.inboxItemId,
      t.stateRevision,
    ),
    index('inbox_handling_cycle_transitions_source_idx').on(
      t.sourceType,
      t.sourceId,
      t.sourceRevision,
    ),
    check(
      'inbox_handling_cycle_transitions_values_valid',
      sql`${t.cycleNumber} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.stateRevision} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.sourceRevision} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.kind} IN ('opened', 'closed', 'reopened')
        AND ${t.transitionReason} IN (
          'legacy_backfill',
          'review_observed',
          'feedback_submitted',
          'material_revision_changed',
          'manual_reopen',
          'provider_reply_deleted',
          'provider_reply_diverged',
          'guest_follow_up_still_needed',
          'internal_follow_up_still_needed',
          'new_information',
          'correcting_handling_status',
          'other',
          'confirmed_on_google',
          'external_reply_observed',
          'guest_withdrawn',
          'private_feedback_handled',
          'source_ineligible',
          'superseded_by_source_revision'
        )
        AND ${t.actorType} IN ('user', 'guest', 'provider', 'system')
        AND ((${t.actorType} = 'user') = (${t.actorUserId} IS NOT NULL))`,
    ),
  ],
)

/**
 * Append-only manager outcomes for private-feedback Handling Cycles.
 * Corrections append a self-bound successor and retain the first completion
 * instant plus its deadline classification; internal notes never leave Inbox.
 */
export const inboxFeedbackHandlingOutcomes = pgTable(
  'inbox_feedback_handling_outcomes',
  {
    id: uuid('id').primaryKey(),
    inboxItemId: uuid('inbox_item_id').notNull(),
    cycleNumber: bigint('cycle_number', { mode: 'number' }).notNull(),
    outcomeRevision: bigint('outcome_revision', { mode: 'number' }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceType: inboxSourceTypeEnum('source_type').notNull().default('feedback'),
    feedbackId: uuid('feedback_id').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    outcome: varchar('outcome', { length: 48 }).notNull(),
    internalNote: text('internal_note'),
    recordedBy: varchar('recorded_by', { length: 255 }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    completionAt: timestamp('completion_at', { withTimezone: true }).notNull(),
    completionStateRevision: bigint('completion_state_revision', {
      mode: 'number',
    }).notNull(),
    deadlineResult: varchar('deadline_result', { length: 24 }).notNull(),
    resultingCommandRevision: bigint('resulting_command_revision', {
      mode: 'number',
    }).notNull(),
    supersedesOutcomeId: uuid('supersedes_outcome_id'),
    supersedesOutcomeRevision: bigint('supersedes_outcome_revision', {
      mode: 'number',
    }),
    createdAt: createdAtColumn(),
  },
  (t) => [
    uniqueIndex('inbox_feedback_handling_outcomes_cycle_revision_unique').on(
      t.inboxItemId,
      t.cycleNumber,
      t.outcomeRevision,
    ),
    uniqueIndex('inbox_feedback_handling_outcomes_chain_target_unique').on(
      t.inboxItemId,
      t.cycleNumber,
      t.id,
      t.outcomeRevision,
    ),
    uniqueIndex('inbox_feedback_handling_outcomes_command_revision_unique').on(
      t.inboxItemId,
      t.resultingCommandRevision,
    ),
    foreignKey({
      name: 'inbox_feedback_handling_outcomes_cycle_scope_fk',
      columns: [
        t.inboxItemId,
        t.cycleNumber,
        t.organizationId,
        t.propertyId,
        t.sourceType,
        t.feedbackId,
        t.sourceRevision,
      ],
      foreignColumns: [
        inboxHandlingCycles.inboxItemId,
        inboxHandlingCycles.cycleNumber,
        inboxHandlingCycles.organizationId,
        inboxHandlingCycles.propertyId,
        inboxHandlingCycles.sourceType,
        inboxHandlingCycles.sourceId,
        inboxHandlingCycles.sourceRevision,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inbox_feedback_handling_outcomes_completion_transition_fk',
      columns: [t.inboxItemId, t.completionStateRevision],
      foreignColumns: [
        inboxHandlingCycleTransitions.inboxItemId,
        inboxHandlingCycleTransitions.stateRevision,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inbox_feedback_handling_outcomes_supersedes_fk',
      columns: [
        t.inboxItemId,
        t.cycleNumber,
        t.supersedesOutcomeId,
        t.supersedesOutcomeRevision,
      ],
      foreignColumns: [t.inboxItemId, t.cycleNumber, t.id, t.outcomeRevision],
    }).onDelete('cascade'),
    index('inbox_feedback_handling_outcomes_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.inboxItemId,
      t.cycleNumber,
      t.outcomeRevision,
    ),
    check(
      'inbox_feedback_handling_outcomes_values_valid',
      sql`${t.sourceType} = 'feedback'
        AND ${t.cycleNumber} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.sourceRevision} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.outcomeRevision} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.completionStateRevision} BETWEEN 2 AND '9007199254740991'::bigint
        AND ${t.resultingCommandRevision} BETWEEN 2 AND '9007199254740991'::bigint
        AND ${t.outcome} IN (
          'follow_up_completed', 'follow_up_attempted', 'handled_with_team',
          'reviewed_no_additional_step', 'content_concern_reviewed'
        )
        AND ${t.deadlineResult} IN ('on_time', 'late', 'not_measured')
        AND (${t.internalNote} IS NULL OR length(btrim(${t.internalNote})) BETWEEN 1 AND 2000)
        AND ${t.recordedAt} >= ${t.completionAt}
        AND (
          (${t.outcomeRevision} = 1 AND ${t.supersedesOutcomeId} IS NULL AND ${t.supersedesOutcomeRevision} IS NULL)
          OR (${t.outcomeRevision} > 1 AND ${t.supersedesOutcomeId} IS NOT NULL
            AND ${t.supersedesOutcomeRevision} = ${t.outcomeRevision} - 1)
        )`,
    ),
  ],
)

/**
 * Current Organization policy for each Inbox-owned Response Target family.
 * Earlier cycles never consult this row again: every cycle snapshots the
 * resolved duration/source/version in `inbox_handling_cycle_response_targets`.
 */
export const inboxResponseTargetOrganizationPolicies = pgTable(
  'inbox_response_target_organization_policies',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    targetKind: varchar('target_kind', { length: 48 }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    policyVersion: bigint('policy_version', { mode: 'number' }).notNull(),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_response_target_organization_policies_pk',
      columns: [t.organizationId, t.targetKind],
    }),
    check(
      'inbox_response_target_organization_policies_values_valid',
      sql`${t.targetKind} IN ('google_review_response', 'private_feedback_handling')
        AND ${t.durationMinutes} BETWEEN 1 AND 43200
        AND ${t.policyVersion} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
  ],
)

/**
 * Private-feedback-only Property override. There is deliberately no Portal
 * key or Portal override table: the supported resolution chain ends here.
 */
export const inboxPrivateFeedbackTargetPropertyOverrides = pgTable(
  'inbox_private_feedback_target_property_overrides',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    enabled: boolean('enabled').notNull(),
    durationMinutes: integer('duration_minutes'),
    policyVersion: bigint('policy_version', { mode: 'number' }).notNull(),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_private_feedback_target_property_overrides_pk',
      columns: [t.organizationId, t.propertyId],
    }),
    foreignKey({
      name: 'inbox_private_feedback_target_property_overrides_property_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('cascade'),
    check(
      'inbox_private_feedback_target_property_overrides_values_valid',
      sql`((${t.enabled} AND ${t.durationMinutes} BETWEEN 1 AND 43200)
          OR (NOT ${t.enabled} AND ${t.durationMinutes} IS NULL))
        AND ${t.policyVersion} BETWEEN 1 AND '9007199254740991'::bigint`,
    ),
  ],
)

/**
 * One target snapshot/result per Handling Cycle. Absence on a legacy cycle is
 * itself legacy-unknown and is never inferred from `inbox_items.closed_at`.
 * Snapshot columns are immutable at the database boundary; only the one
 * terminal completion/cancellation transition is allowed.
 */
export const inboxHandlingCycleResponseTargets = pgTable(
  'inbox_handling_cycle_response_targets',
  {
    inboxItemId: uuid('inbox_item_id').notNull(),
    cycleNumber: bigint('cycle_number', { mode: 'number' }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    sourceType: inboxSourceTypeEnum('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    sourceRevision: bigint('source_revision', { mode: 'number' }).notNull(),
    targetKind: varchar('target_kind', { length: 48 }).notNull(),
    performanceEligibility: varchar('performance_eligibility', {
      length: 32,
    }).notNull(),
    durationMinutes: integer('duration_minutes'),
    policySource: varchar('policy_source', { length: 32 }),
    policyVersion: bigint('policy_version', { mode: 'number' }),
    startAt: timestamp('start_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completionAt: timestamp('completion_at', { withTimezone: true }),
    result: varchar('result', { length: 24 }),
    stopReason: varchar('stop_reason', { length: 48 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_handling_cycle_response_targets_pk',
      columns: [t.inboxItemId, t.cycleNumber],
    }),
    uniqueIndex('inbox_handling_cycle_response_targets_scope_unique').on(
      t.inboxItemId,
      t.cycleNumber,
      t.organizationId,
      t.propertyId,
      t.targetKind,
    ),
    foreignKey({
      name: 'inbox_handling_cycle_response_targets_cycle_scope_fk',
      columns: [
        t.inboxItemId,
        t.cycleNumber,
        t.organizationId,
        t.propertyId,
        t.sourceType,
        t.sourceId,
        t.sourceRevision,
      ],
      foreignColumns: [
        inboxHandlingCycles.inboxItemId,
        inboxHandlingCycles.cycleNumber,
        inboxHandlingCycles.organizationId,
        inboxHandlingCycles.propertyId,
        inboxHandlingCycles.sourceType,
        inboxHandlingCycles.sourceId,
        inboxHandlingCycles.sourceRevision,
      ],
    }).onDelete('cascade'),
    index('inbox_handling_cycle_response_targets_active_due_idx')
      .on(t.organizationId, t.targetKind, t.dueAt, t.inboxItemId)
      .where(sql`${t.completionAt} IS NULL AND ${t.performanceEligibility} = 'measured'`),
    index('inbox_handling_cycle_response_targets_property_result_idx').on(
      t.organizationId,
      t.propertyId,
      t.targetKind,
      t.result,
      t.startAt,
    ),
    check(
      'inbox_handling_cycle_response_targets_values_valid',
      sql`${t.cycleNumber} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.sourceRevision} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.targetKind} IN ('google_review_response', 'private_feedback_handling')
        AND ${t.performanceEligibility} IN ('measured', 'legacy_unknown', 'historical_onboarding')
        AND (
          (${t.targetKind} = 'google_review_response' AND ${t.sourceType} = 'review')
          OR (${t.targetKind} = 'private_feedback_handling' AND ${t.sourceType} = 'feedback')
        )
        AND (
          (
            ${t.performanceEligibility} = 'measured'
            AND ${t.durationMinutes} BETWEEN 1 AND 43200
            AND ${t.policySource} IN ('builtin_default', 'organization_policy', 'property_override')
            AND (${t.targetKind} = 'private_feedback_handling' OR ${t.policySource} <> 'property_override')
            AND ${t.policyVersion} BETWEEN 1 AND '9007199254740991'::bigint
            AND ${t.startAt} IS NOT NULL
            AND ${t.dueAt} = ${t.startAt} + make_interval(mins => ${t.durationMinutes})
          ) OR (
            ${t.performanceEligibility} <> 'measured'
            AND ${t.durationMinutes} IS NULL
            AND ${t.policySource} IS NULL
            AND ${t.policyVersion} IS NULL
            AND ${t.startAt} IS NULL
            AND ${t.dueAt} IS NULL
          )
        )
        AND (
          (${t.completionAt} IS NULL AND ${t.result} IS NULL AND ${t.stopReason} IS NULL)
          OR (
            ${t.performanceEligibility} = 'measured'
            AND (
              (
                ${t.result} IN ('on_time', 'late')
                AND ${t.completionAt} >= ${t.startAt}
                AND ${t.stopReason} IN ('private_feedback_handled', 'confirmed_on_google')
              )
              OR (
                ${t.result} = 'cancelled'
                AND ${t.stopReason} IN ('guest_withdrawn', 'superseded_by_source_revision', 'source_ineligible')
              )
            )
            AND (
              ${t.result} = 'cancelled'
              OR (
                ((${t.result} = 'on_time') = (${t.completionAt} <= ${t.dueAt}))
                AND ((${t.result} = 'late') = (${t.completionAt} > ${t.dueAt}))
              )
            )
          )
        )`,
    ),
    check(
      'inbox_handling_cycle_response_targets_source_stop_valid',
      sql`${t.stopReason} IS NULL
        OR (${t.targetKind} = 'private_feedback_handling' AND ${t.stopReason} IN ('private_feedback_handled', 'guest_withdrawn', 'superseded_by_source_revision'))
        OR (${t.targetKind} = 'google_review_response' AND ${t.stopReason} IN ('confirmed_on_google', 'superseded_by_source_revision', 'source_ineligible'))`,
    ),
  ],
)

/** Exactly two bounded, content-free reminder slots for each measured target. */
export const inboxResponseTargetReminders = pgTable(
  'inbox_response_target_reminders',
  {
    inboxItemId: uuid('inbox_item_id').notNull(),
    cycleNumber: bigint('cycle_number', { mode: 'number' }).notNull(),
    reminderKind: varchar('reminder_kind', { length: 24 }).notNull(),
    eventId: uuid('event_id').notNull().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    targetKind: varchar('target_kind', { length: 48 }).notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_response_target_reminders_pk',
      columns: [t.inboxItemId, t.cycleNumber, t.reminderKind],
    }),
    uniqueIndex('inbox_response_target_reminders_event_unique').on(t.eventId),
    foreignKey({
      name: 'inbox_response_target_reminders_target_scope_fk',
      columns: [
        t.inboxItemId,
        t.cycleNumber,
        t.organizationId,
        t.propertyId,
        t.targetKind,
      ],
      foreignColumns: [
        inboxHandlingCycleResponseTargets.inboxItemId,
        inboxHandlingCycleResponseTargets.cycleNumber,
        inboxHandlingCycleResponseTargets.organizationId,
        inboxHandlingCycleResponseTargets.propertyId,
        inboxHandlingCycleResponseTargets.targetKind,
      ],
    }).onDelete('cascade'),
    index('inbox_response_target_reminders_due_idx')
      .on(t.scheduledFor, t.inboxItemId, t.cycleNumber, t.reminderKind)
      .where(sql`${t.deliveredAt} IS NULL AND ${t.cancelledAt} IS NULL`),
    check(
      'inbox_response_target_reminders_values_valid',
      sql`${t.cycleNumber} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.reminderKind} IN ('halfway', 'target_passed')
        AND ${t.targetKind} IN ('google_review_response', 'private_feedback_handling')
        AND NOT (${t.deliveredAt} IS NOT NULL AND ${t.cancelledAt} IS NOT NULL)
        AND (${t.deliveredAt} IS NULL OR ${t.deliveredAt} >= ${t.scheduledFor})`,
    ),
  ],
)

/**
 * Append-only assignment decisions. The resulting item command revision is
 * the history identity, so the projection row and its assignment fact cannot
 * disagree about which command committed. `handlingCycleNumber` is nullable
 * only during the expand period for feedback items that do not yet have a
 * canonical Guest Handling Cycle anchor and for authority-removal commands
 * covering quarantined legacy Review items whose head is awaiting repair.
 */
export const inboxAssignmentHistory = pgTable(
  'inbox_assignment_history',
  {
    inboxItemId: uuid('inbox_item_id')
      .notNull()
      .references(() => inboxItems.id, { onDelete: 'cascade' }),
    resultingCommandRevision: bigint('resulting_command_revision', {
      mode: 'number',
    }).notNull(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    // Keep the exact legacy Inbox projection key. `inbox_items.property_id`
    // remains varchar during expand, and eligibility-loss cleanup must be
    // able to append its audit fact even for a quarantined non-UUID value.
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    handlingCycleNumber: bigint('handling_cycle_number', { mode: 'number' }),
    previousAssignee: varchar('previous_assignee', { length: 255 }),
    nextAssignee: varchar('next_assignee', { length: 255 }),
    reason: inboxAssignmentReasonEnum('reason').notNull(),
    actorUserId: varchar('actor_user_id', { length: 255 }),
    bulkId: uuid('bulk_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'inbox_assignment_history_pk',
      columns: [t.inboxItemId, t.resultingCommandRevision],
    }),
    index('inbox_assignment_history_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.occurredAt,
      t.inboxItemId,
    ),
    index('inbox_assignment_history_assignee_idx').on(
      t.organizationId,
      t.nextAssignee,
      t.occurredAt,
    ),
    check(
      'inbox_assignment_history_revision_safe',
      sql`${t.resultingCommandRevision} BETWEEN 2 AND '9007199254740991'::bigint
        AND (${t.handlingCycleNumber} IS NULL OR ${t.handlingCycleNumber} BETWEEN 1 AND '9007199254740991'::bigint)`,
    ),
    check(
      'inbox_assignment_history_changes_assignee',
      sql`${t.previousAssignee} IS DISTINCT FROM ${t.nextAssignee}`,
    ),
  ],
)

export const inboxNotes = pgTable(
  'inbox_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    inboxItemId: uuid('inbox_item_id')
      .notNull()
      .references(() => inboxItems.id, { onDelete: 'cascade' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    userId: varchar('author_user_id', { length: 255 }).notNull(),
    text: text('text').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [index('inbox_notes_item_idx').on(t.inboxItemId)],
)

// Per-user last-visit timestamp (ADR 0023) — replaces the org-level "new" badge.
export const inboxUserViews = pgTable(
  'inbox_user_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    lastInboxView: timestamp('last_inbox_view', { withTimezone: true }).notNull(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [uniqueIndex('inbox_user_views_org_user_unique').on(t.organizationId, t.userId)],
)
