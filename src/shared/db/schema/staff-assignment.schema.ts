// Staff context — Drizzle schema for staff_assignments table
// Staff assignments link users to properties (directly or via a team).
// Per architecture: snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import { pgTable, uuid, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { teams } from './team.schema'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'

export const staffAssignments = pgTable(
  'staff_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    orgUserIdx: index('staff_assignments_org_user_idx').on(t.organizationId, t.userId),
    orgPropertyIdx: index('staff_assignments_org_property_idx').on(
      t.organizationId,
      t.propertyId,
    ),
    orgUserPropertyTeamUnique: uniqueIndex(
      'staff_assignments_org_user_property_team_unique',
    )
      .on(t.organizationId, t.userId, t.propertyId, t.teamId)
      .where(sql`deleted_at IS NULL`),
  }),
)
