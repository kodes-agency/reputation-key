// Region move workflow (BQC-4.5 / ADR 0048) — migration 0016.
//
// Durable state machine for operator-driven cross-cell property moves:
//   requested → writes_paused → queues_drained → data_copied → verified →
//   target_activated → source_erased → completed
// with failed → rolling_back → rolled_back as the failure/rollback path
// (src/contexts/property/domain/region-move-workflow.ts is the authority).
// The property FK is ON DELETE RESTRICT — move history is evidence and must
// survive; denial_reason/error stay content-free (typed reason / first line).

import { sql, desc } from 'drizzle-orm'
import {
  pgTable,
  text,
  uuid,
  varchar,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const regionMoves = pgTable(
  'region_moves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    fromRegion: text('from_region').notNull(),
    toRegion: text('to_region').notNull(),
    state: text('state').notNull(),
    denialReason: text('denial_reason'),
    requestedBy: varchar('requested_by', { length: 255 }).notNull(),
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
    stateChangedAt: timestamptz('state_changed_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),
    error: text('error'),
  },
  (t) => [
    check(
      'region_moves_state_check',
      sql`${t.state} IN ('requested', 'writes_paused', 'queues_drained', 'data_copied', 'verified', 'target_activated', 'source_erased', 'completed', 'failed', 'rolling_back', 'rolled_back')`,
    ),
    index('region_moves_property_state_idx').on(t.propertyId, t.state),
    index('region_moves_org_requested_idx').on(t.organizationId, desc(t.requestedAt)),
  ],
)
