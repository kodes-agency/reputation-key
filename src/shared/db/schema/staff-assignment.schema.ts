// Staff context — Drizzle schema for staff_assignments table
// Staff assignments link users to properties (directly or via a team).
// Per architecture: snake_case columns, camelCase field names.

import { sql } from 'drizzle-orm'
import { pgTable, uuid, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { portals } from './portal.schema'
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
    portalId: uuid('portal_id').references(() => portals.id, { onDelete: 'cascade' }),
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
    orgTeamIdx: index('staff_assignments_org_team_idx').on(t.organizationId, t.teamId),
    orgPortalIdx: index('staff_assignments_org_portal_idx').on(
      t.organizationId,
      t.portalId,
    ),
    // Enforce assignment uniqueness across every (teamId, portalId) NULL-combination.
    // PostgreSQL treats NULLs as distinct in a unique index, so a single 5-column
    // index never fires for the common direct-assignment case (teamId/portalId NULL),
    // leaving a check-then-act (TOCTOU) race between assignmentExists() and INSERT.
    // Splitting into per-combination partial indexes closes the race: each partition
    // pins the nullability of the nullable columns, so its key lists only columns
    // that are non-NULL within that partition (a NULL-constant column is excluded,
    // since two NULLs are never "equal" under a unique index). Drizzle's uniqueIndex
    // builder has no nullsNotDistinct(), and a table-level unique() constraint cannot
    // be partial (PG forbids WHERE on constraints), so partial indexes are the only
    // native way to keep the soft-delete-aware (deleted_at IS NULL) semantics.
    // assignmentExists() stays as a fast-path for a friendly already_assigned error;
    // the DB constraint is authoritative.
    uniqueDirect: uniqueIndex('staff_assignments_unique_direct')
      .on(t.organizationId, t.userId, t.propertyId)
      .where(sql`team_id IS NULL AND portal_id IS NULL AND deleted_at IS NULL`),
    uniquePortal: uniqueIndex('staff_assignments_unique_portal')
      .on(t.organizationId, t.userId, t.propertyId, t.portalId)
      .where(sql`team_id IS NULL AND portal_id IS NOT NULL AND deleted_at IS NULL`),
    uniqueTeam: uniqueIndex('staff_assignments_unique_team')
      .on(t.organizationId, t.userId, t.propertyId, t.teamId)
      .where(sql`team_id IS NOT NULL AND portal_id IS NULL AND deleted_at IS NULL`),
    uniqueTeamPortal: uniqueIndex('staff_assignments_unique_team_portal')
      .on(t.organizationId, t.userId, t.propertyId, t.teamId, t.portalId)
      .where(sql`team_id IS NOT NULL AND portal_id IS NOT NULL AND deleted_at IS NULL`),
  }),
)
