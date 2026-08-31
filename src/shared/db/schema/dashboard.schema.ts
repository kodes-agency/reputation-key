import { sql } from 'drizzle-orm'
import { check, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core'
import { createdAtColumn } from '../columns'

/**
 * Content-free, monotonic onboarding milestones. Current health remains in the
 * owning contexts; this table only remembers that a canonical fact was true.
 */
export const setupChecklistMilestones = pgTable(
  'setup_checklist_milestones',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    step: varchar('step', { length: 40 }).notNull(),
    firstCompletedAt: timestamp('first_completed_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    primaryKey({
      name: 'setup_checklist_milestones_pk',
      columns: [t.organizationId, t.step],
    }),
    check(
      'setup_checklist_milestones_step_valid',
      sql`${t.step} IN ('google_connection', 'imported_property', 'initial_review_sync', 'published_portal', 'responsible_managers')`,
    ),
  ],
)
