// Inbox context — Drizzle schema for inbox_items, inbox_notes & inbox_user_views
// Per ADR 0023: status is open/closed; escalation is an orthogonal flag.

import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { materialReviewRevisions } from './review.schema'
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
    // Migration 0008: cross-org date-ordered scan for incremental rollups.
    index('inbox_items_source_date_idx').on(t.sourceDate),
    // Cross-tenant keyset scan for the notification-gap reconciliation sweep
    // (reconcile-missing-notifications): "items created in the last N hours"
    // ordered by (created_at, id). source_date is the review's own date, so
    // the existing source_date index cannot answer it — an imported backlog
    // lands with old source dates and a brand-new created_at.
    index('inbox_items_created_at_idx').on(t.createdAt, t.id),
  ],
)

/**
 * Immutable opening facts for numbered Review handling cycles (ADR 0055).
 *
 * The mutable current pointer lives in `inbox_handling_cycle_heads`; starting
 * another cycle only appends here, so an earlier work episode and its source
 * revision anchor are never rewritten. Guest Response anchors intentionally
 * remain a later expand step rather than being represented by an unverified
 * generic identifier.
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
    reviewId: uuid('review_id').notNull(),
    materialReviewRevision: bigint('material_review_revision', {
      mode: 'number',
    }).notNull(),
    openedReason: varchar('opened_reason', { length: 48 }).notNull(),
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
        'material_revision_changed',
        'manual_reopen',
        'provider_reply_deleted',
        'provider_reply_diverged'
      )`,
    ),
  ],
)

/**
 * Compare-and-swap head for the one current actionable Review cycle.
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
    reviewId: uuid('review_id').notNull(),
    currentCycleNumber: bigint('current_cycle_number', { mode: 'number' }).notNull(),
    currentMaterialReviewRevision: bigint('current_material_review_revision', {
      mode: 'number',
    }).notNull(),
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
    index('inbox_handling_cycle_heads_scope_idx').on(
      t.organizationId,
      t.propertyId,
      t.status,
    ),
    check(
      'inbox_handling_cycle_heads_revisions_safe',
      sql`${t.currentCycleNumber} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.currentMaterialReviewRevision} BETWEEN 1 AND '9007199254740991'::bigint
        AND ${t.stateRevision} BETWEEN 1 AND '9007199254740991'::bigint`,
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
