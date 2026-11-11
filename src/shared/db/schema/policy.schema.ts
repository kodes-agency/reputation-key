// App-owned authorization records that survive the static capability cutover.
//
// property_access_grant: user ↔ property access with scope/source/lifecycle —
//   the authoritative grant model used by execution-policy decisions. Tenant
//   consistency is enforced by a composite FK to properties(organization_id, id).

import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  uuid,
  timestamp,
  uniqueIndex,
  index,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { properties } from './property.schema'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const propertyAccessGrant = pgTable(
  'property_access_grant',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    propertyId: uuid('property_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at'),
    revokedAt: timestamptz('revoked_at'),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    // Tenant consistency: the grant's org must be the property's org.
    foreignKey({
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
      name: 'property_access_grant_tenant_fk',
    }).onDelete('cascade'),
    check(
      'property_access_grant_source_check',
      sql`${t.source} IN ('operator', 'migration', 'invitation')`,
    ),
    // One active grant per (org, property, user); revoked rows keep the trail.
    uniqueIndex('property_access_grant_active_unique')
      .on(t.organizationId, t.propertyId, t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('property_access_grant_user_idx')
      .on(t.organizationId, t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
)
