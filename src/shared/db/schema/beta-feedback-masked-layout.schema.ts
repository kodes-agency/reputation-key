// OBS-01 — the optional `masked_layout_v1` geometry for one Bug report.
//
// Separate from `beta_feedback_triage` on purpose: that table is declared
// content-free and holds only pseudonyms, controlled enums, provider linkage,
// classifications, ownership and state-transition evidence. Geometry is none of
// those, so it lives here rather than quietly widening what that table means.
//
// What a row may hold is bounded by construction, not by filtering: a viewport
// size and a bounded list of rectangles carrying a role from a closed
// vocabulary. There is no column a page's text, URL or attribute could occupy.
//
// `expires_at` is fixed by CHECK to at most 30 days after capture — the horizon
// BETA.md §3 and the accepted privacy notice both state — and the retention
// sweep deletes on it.

import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { betaFeedbackTriage } from './beta-feedback-triage.schema'
import type { MaskedLayoutBox } from '#/shared/beta-feedback-layout'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const betaFeedbackMaskedLayouts = pgTable(
  'beta_feedback_masked_layouts',
  {
    feedbackReference: uuid('feedback_reference')
      .primaryKey()
      .references(() => betaFeedbackTriage.reference, { onDelete: 'cascade' }),
    viewportWidth: integer('viewport_width').notNull(),
    viewportHeight: integer('viewport_height').notNull(),
    boxCount: integer('box_count').notNull(),
    /** Validated against `maskedLayoutSchema` before it ever reaches here. */
    boxes: jsonb('boxes').$type<ReadonlyArray<MaskedLayoutBox>>().notNull(),
    capturedAt: timestamptz('captured_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (t) => [
    check(
      'beta_feedback_masked_layout_viewport_valid',
      sql`${t.viewportWidth} BETWEEN 1 AND 20000 AND ${t.viewportHeight} BETWEEN 1 AND 20000`,
    ),
    check(
      'beta_feedback_masked_layout_box_count_valid',
      sql`${t.boxCount} BETWEEN 1 AND 240 AND jsonb_array_length(${t.boxes}) = ${t.boxCount}`,
    ),
    check(
      'beta_feedback_masked_layout_boxes_are_array',
      sql`jsonb_typeof(${t.boxes}) = 'array'`,
    ),
    // The 30-day horizon is the database's, not the application's: an
    // application bug cannot mint a row that outlives the accepted policy.
    check(
      'beta_feedback_masked_layout_retention_valid',
      sql`${t.expiresAt} > ${t.capturedAt} AND ${t.expiresAt} <= ${t.capturedAt} + interval '30 days'`,
    ),
    index('beta_feedback_masked_layout_expiry_idx').on(t.expiresAt),
  ],
)
