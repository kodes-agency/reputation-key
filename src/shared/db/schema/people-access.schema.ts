// POST-BETA-1: People, access, and attribution schema.
//
// Per ADR 0039: PropertyAccessGrant, StaffParticipation, TeamMembership,
// and PortalResponsibility are separate effective-dated concepts.
//
// Per ADR 0040: PortalGroupMembership is effective-dated for event-time
// attribution.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal-group.schema'
import { createdAtColumn, updatedAtColumn } from '../columns'

// ── Enums ──────────────────────────────────────────────────────────

export const grantStatusEnum = pgEnum('grant_status', ['active', 'revoked'])
export const grantKindEnum = pgEnum('grant_kind', [
  'full_access',
  'manage',
  'respond',
  'view',
])

export const participationStatusEnum = pgEnum('participation_status', [
  'active',
  'inactive',
  'archived',
])

export const membershipRoleEnum = pgEnum('membership_role', ['member', 'lead'])

export const responsibilityKindEnum = pgEnum('responsibility_kind', [
  'primary',
  'supporting',
])

// ── Property Access Grants ────────────────────────────────────────

export const propertyAccessGrants = pgTable(
  'property_access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    userId: varchar('user_id', { length: 255 }).notNull(),
    kind: grantKindEnum('kind').notNull(),
    status: grantStatusEnum('status').notNull().default('active'),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    grantedBy: varchar('granted_by', { length: 255 }).notNull(),
    revokedBy: varchar('revoked_by', { length: 255 }),
    reason: text('reason'),
  },
  (t) => ({
    orgPropUserIdx: index('pag_org_prop_user_idx').on(
      t.organizationId,
      t.propertyId,
      t.userId,
    ),
    uniqueActiveGrant: uniqueIndex('pag_unique_active')
      .on(t.organizationId, t.propertyId, t.userId, t.kind)
      .where(sql`status = 'active'`),
  }),
)

// ── Staff Participations ──────────────────────────────────────────

export const staffParticipations = pgTable(
  'staff_participations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    userId: varchar('user_id', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    status: participationStatusEnum('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    orgPropUserIdx: index('sp_org_prop_user_idx').on(
      t.organizationId,
      t.propertyId,
      t.userId,
    ),
    uniqueActiveParticipation: uniqueIndex('sp_unique_active')
      .on(t.organizationId, t.propertyId, t.userId)
      .where(sql`status = 'active'`),
  }),
)

// ── Team Memberships (effective-dated) ────────────────────────────

export const teamMemberships = pgTable(
  'team_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    teamId: uuid('team_id').notNull(),
    staffParticipationId: uuid('staff_participation_id')
      .notNull()
      .references(() => staffParticipations.id, { onDelete: 'restrict' }),
    role: membershipRoleEnum('role').notNull().default('member'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    endReason: text('end_reason'),
  },
  (t) => ({
    orgTeamIdx: index('tm_org_team_idx').on(t.organizationId, t.teamId),
    orgPartIdx: index('tm_org_part_idx').on(t.organizationId, t.staffParticipationId),
    // At most one active lead per team
    uniqueActiveLead: uniqueIndex('tm_unique_active_lead')
      .on(t.organizationId, t.teamId)
      .where(sql`role = 'lead' AND effective_to IS NULL`),
  }),
)

// ── Portal Responsibilities (effective-dated) ─────────────────────

export const portalResponsibilities = pgTable(
  'portal_responsibilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
    staffParticipationId: uuid('staff_participation_id')
      .notNull()
      .references(() => staffParticipations.id, { onDelete: 'restrict' }),
    kind: responsibilityKindEnum('kind').notNull().default('primary'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    endReason: text('end_reason'),
  },
  (t) => ({
    orgPortalIdx: index('pr_org_portal_idx').on(t.organizationId, t.portalId),
    // At most one active primary per portal
    uniqueActivePrimary: uniqueIndex('pr_unique_active_primary')
      .on(t.organizationId, t.portalId)
      .where(sql`kind = 'primary' AND effective_to IS NULL`),
  }),
)

// ── Portal Group Memberships (effective-dated, event-time) ────────

export const portalGroupMemberships = pgTable(
  'portal_group_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id, { onDelete: 'restrict' }),
    portalGroupId: uuid('portal_group_id')
      .notNull()
      .references(() => portalGroups.id, { onDelete: 'restrict' }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    endReason: text('end_reason'),
  },
  (t) => ({
    orgPortalIdx: index('pgm_org_portal_idx').on(t.organizationId, t.portalId),
    // At most one active group per portal
    uniqueActiveGroup: uniqueIndex('pgm_unique_active')
      .on(t.organizationId, t.portalId)
      .where(sql`effective_to IS NULL`),
  }),
)
