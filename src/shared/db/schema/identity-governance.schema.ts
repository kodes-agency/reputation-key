// Application-owned identity governance state.
//
// Better Auth owns users, sessions, memberships, organizations, and
// invitations. This table is deliberately app-owned: it is the closed-beta
// authority that binds one login to one Organization independently of the
// mutable session activeOrganizationId field.

import { sql } from 'drizzle-orm'
import { check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { createdAtColumn, updatedAtColumn } from '../columns'

export const userOrganizationBindings = pgTable(
  'user_organization_bindings',
  {
    // One row per user makes two simultaneous active Organization bindings
    // unrepresentable. No FK crosses into the Better Auth-owned schema track.
    userId: text('user_id').primaryKey(),
    organizationId: text('organization_id'),
    state: text('state').notNull().default('active'),
    source: text('source').notNull(),
    invitationId: text('invitation_id'),
    version: integer('version').notNull().default(1),
    resolutionReason: text('resolution_reason'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('user_organization_bindings_org_state_idx').on(t.organizationId, t.state),
    check(
      'user_organization_bindings_state_valid',
      sql`${t.state} IN ('active', 'support_resolution', 'released')`,
    ),
    check(
      'user_organization_bindings_source_valid',
      sql`${t.source} IN ('invitation', 'operator', 'backfill')`,
    ),
    check('user_organization_bindings_version_positive', sql`${t.version} > 0`),
    check(
      'user_organization_bindings_state_shape',
      sql`(
        (${t.state} = 'active' AND ${t.organizationId} IS NOT NULL AND ${t.releasedAt} IS NULL)
        OR (${t.state} = 'support_resolution' AND ${t.releasedAt} IS NULL)
        OR (${t.state} = 'released' AND ${t.releasedAt} IS NOT NULL)
      )`,
    ),
  ],
)
