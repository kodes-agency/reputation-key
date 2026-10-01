// Portal context — Drizzle schema for portal_groups table
// Portal groups aggregate multiple portals for department-level metrics.
// Per architecture: snake_case columns, camelCase field names.

import {
  check,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { properties } from './property.schema'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'

export const portalGroups = pgTable(
  'portal_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    // No inline `.references()` here: the composite `portal_groups_property_tenant_fk`
    // below is the only FK path into `properties`. An inline single-column
    // CASCADE used to exist alongside it, racing the composite RESTRICT FK's
    // trigger with no guaranteed firing order — an org purge could hit the
    // CASCADE path first and silently erase a portal_groups row before
    // Portal's own receipted purge ran for it (database-01).
    propertyId: uuid('property_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    sortKey: varchar('sort_key', { length: 255 }),
    // Who created the group. Null for a group made before round 4 recorded it.
    createdBy: varchar('created_by', { length: 255 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => [
    uniqueIndex('portal_groups_org_property_name_unique')
      .on(t.organizationId, t.propertyId, t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('portal_groups_org_property_id_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
    ),
    foreignKey({
      name: 'portal_groups_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
  ],
)

// ── portal_group_history ───────────────────────────────────────────
// The ledger of what happened to a group and to the Portals in it, written in
// the same transaction as each change. Names live here, not on events, which
// carry identifiers only (ADR 0030). Nothing updates or deletes a row; a group
// purge removes them with the group.

export const PORTAL_GROUP_HISTORY_KIND_SQL_LIST =
  "'created', 'renamed', 'archived', 'portal_added', 'portal_removed', 'portal_moved_in', 'portal_moved_out'"

export const portalGroupHistory = pgTable(
  'portal_group_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalGroupId: uuid('portal_group_id').notNull(),
    kind: varchar('kind', { length: 20 }).notNull(),
    // A Portal is referenced by id only: the ledger outlives a Portal that is
    // later archived, and its name is read live.
    portalId: uuid('portal_id'),
    // The group on the other side of a move.
    otherGroupId: uuid('other_group_id'),
    name: varchar('name', { length: 100 }),
    previousName: varchar('previous_name', { length: 100 }),
    actorUserId: varchar('actor_user_id', { length: 255 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    index('portal_group_history_group_idx').on(
      t.organizationId,
      t.portalGroupId,
      t.occurredAt,
    ),
    foreignKey({
      name: 'portal_group_history_group_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalGroupId],
      foreignColumns: [
        portalGroups.organizationId,
        portalGroups.propertyId,
        portalGroups.id,
      ],
    }).onDelete('cascade'),
    check(
      'portal_group_history_kind_valid',
      sql`${t.kind} IN (${sql.raw(PORTAL_GROUP_HISTORY_KIND_SQL_LIST)})`,
    ),
    check(
      'portal_group_history_shape',
      sql`(${t.kind} = 'created' AND ${t.name} IS NOT NULL AND ${t.previousName} IS NULL AND ${t.portalId} IS NULL AND ${t.otherGroupId} IS NULL)
        OR (${t.kind} = 'renamed' AND ${t.name} IS NOT NULL AND ${t.previousName} IS NOT NULL AND ${t.portalId} IS NULL AND ${t.otherGroupId} IS NULL)
        OR (${t.kind} = 'archived' AND ${t.name} IS NULL AND ${t.previousName} IS NULL AND ${t.portalId} IS NULL AND ${t.otherGroupId} IS NULL)
        OR (${t.kind} IN ('portal_added', 'portal_removed') AND ${t.name} IS NULL AND ${t.previousName} IS NULL AND ${t.portalId} IS NOT NULL AND ${t.otherGroupId} IS NULL)
        OR (${t.kind} IN ('portal_moved_in', 'portal_moved_out') AND ${t.name} IS NULL AND ${t.previousName} IS NULL AND ${t.portalId} IS NOT NULL AND ${t.otherGroupId} IS NOT NULL)`,
    ),
  ],
)
