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
  foreignKey,
  check,
  integer,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'
import { portals } from './portal.schema'
import { portalGroups } from './portal-group.schema'
import { teams } from './team.schema'
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

export const staffParticipantStatusEnum = pgEnum('staff_participant_status', [
  'active',
  'archived',
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
  (t) => [
    index('pag_org_prop_user_idx').on(t.organizationId, t.propertyId, t.userId),
    uniqueIndex('pag_unique_active')
      .on(t.organizationId, t.propertyId, t.userId, t.kind)
      .where(sql`status = 'active'`),
    foreignKey({
      name: 'pag_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
  ],
)

// ── Staff Participants + optional login links ────────────────────

export const staffParticipants = pgTable(
  'staff_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    status: staffParticipantStatusEnum('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archiveReason: text('archive_reason'),
    revision: integer('revision').notNull().default(1),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('staff_participants_org_id_key').on(t.organizationId, t.id),
    index('staff_participants_org_status_name_idx').on(
      t.organizationId,
      t.status,
      t.displayName,
    ),
    check(
      'staff_participants_lifecycle_consistent',
      sql`(${t.status} = 'active' AND ${t.archivedAt} IS NULL AND ${t.archiveReason} IS NULL) OR (${t.status} = 'archived' AND ${t.archivedAt} IS NOT NULL AND ${t.archiveReason} IS NOT NULL)`,
    ),
    check('staff_participants_revision_positive', sql`${t.revision} >= 1`),
  ],
)

export const staffUserLinks = pgTable(
  'staff_user_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    staffParticipantId: uuid('staff_participant_id').notNull(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    endReason: text('end_reason'),
  },
  (t) => [
    index('staff_user_links_org_participant_idx').on(
      t.organizationId,
      t.staffParticipantId,
    ),
    index('staff_user_links_org_user_idx').on(t.organizationId, t.userId),
    uniqueIndex('staff_user_links_unique_active_participant')
      .on(t.organizationId, t.staffParticipantId)
      .where(sql`effective_to IS NULL`),
    uniqueIndex('staff_user_links_unique_active_user')
      .on(t.organizationId, t.userId)
      .where(sql`effective_to IS NULL`),
    foreignKey({
      name: 'staff_user_links_participant_tenant_fk',
      columns: [t.organizationId, t.staffParticipantId],
      foreignColumns: [staffParticipants.organizationId, staffParticipants.id],
    }).onDelete('restrict'),
    check(
      'staff_user_links_interval_valid',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
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
    staffParticipantId: uuid('staff_participant_id'),
    // Compatibility shadow for the legacy login-bound reader. New beta writes
    // leave this null and identify the person through staffParticipantId.
    userId: varchar('user_id', { length: 255 }),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    status: participationStatusEnum('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    archiveReason: text('archive_reason'),
    revision: integer('revision').notNull().default(1),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    index('sp_org_prop_user_idx').on(t.organizationId, t.propertyId, t.userId),
    uniqueIndex('sp_unique_active')
      .on(t.organizationId, t.propertyId, t.userId)
      .where(sql`status = 'active'`),
    uniqueIndex('sp_unique_active_participant')
      .on(t.organizationId, t.propertyId, t.staffParticipantId)
      .where(sql`status = 'active' AND staff_participant_id IS NOT NULL`),
    uniqueIndex('sp_org_property_id_key').on(t.organizationId, t.propertyId, t.id),
    uniqueIndex('sp_org_property_id_participant_key').on(
      t.organizationId,
      t.propertyId,
      t.id,
      t.staffParticipantId,
    ),
    foreignKey({
      name: 'sp_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sp_participant_tenant_fk',
      columns: [t.organizationId, t.staffParticipantId],
      foreignColumns: [staffParticipants.organizationId, staffParticipants.id],
    }).onDelete('restrict'),
    check(
      'sp_lifecycle_consistent',
      sql`(${t.status} = 'active' AND ${t.endedAt} IS NULL) OR (${t.status} <> 'active' AND ${t.endedAt} IS NOT NULL)`,
    ),
    check(
      'sp_archive_reason_consistent',
      sql`(${t.status} = 'archived' AND ${t.archiveReason} IS NOT NULL) OR (${t.status} <> 'archived' AND ${t.archiveReason} IS NULL)`,
    ),
    check('sp_revision_positive', sql`${t.revision} >= 1`),
  ],
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
  (t) => [
    index('tm_org_team_idx').on(t.organizationId, t.teamId),
    index('tm_org_part_idx').on(t.organizationId, t.staffParticipationId),
    // At most one active lead per team
    uniqueIndex('tm_unique_active_lead')
      .on(t.organizationId, t.teamId)
      .where(sql`role = 'lead' AND effective_to IS NULL`),
    uniqueIndex('tm_unique_active_participation')
      .on(t.organizationId, t.propertyId, t.staffParticipationId)
      .where(sql`effective_to IS NULL`),
    check(
      'tm_interval_valid',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    foreignKey({
      name: 'tm_team_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.teamId],
      foreignColumns: [teams.organizationId, teams.propertyId, teams.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tm_participation_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.staffParticipationId],
      foreignColumns: [
        staffParticipations.organizationId,
        staffParticipations.propertyId,
        staffParticipations.id,
      ],
    }).onDelete('restrict'),
  ],
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
  (t) => [
    index('pr_org_portal_idx').on(t.organizationId, t.portalId),
    uniqueIndex('pr_scope_id_participation_key').on(
      t.organizationId,
      t.propertyId,
      t.portalId,
      t.id,
      t.staffParticipationId,
    ),
    // At most one active primary per portal
    uniqueIndex('pr_unique_active_primary')
      .on(t.organizationId, t.portalId)
      .where(sql`kind = 'primary' AND effective_to IS NULL`),
    check(
      'pr_interval_valid',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    foreignKey({
      name: 'pr_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pr_participation_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.staffParticipationId],
      foreignColumns: [
        staffParticipations.organizationId,
        staffParticipations.propertyId,
        staffParticipations.id,
      ],
    }).onDelete('restrict'),
  ],
)

// ── Team Portal-Group Scopes (effective-dated) ─────────────────────
export const teamPortalGroupScopes = pgTable(
  'team_portal_group_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    teamId: uuid('team_id').notNull(),
    portalGroupId: uuid('portal_group_id').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    createdBy: varchar('created_by', { length: 255 }).notNull(),
    endReason: text('end_reason'),
  },
  (t) => [
    index('tpgs_org_team_idx').on(t.organizationId, t.propertyId, t.teamId),
    uniqueIndex('tpgs_unique_active')
      .on(t.organizationId, t.propertyId, t.teamId, t.portalGroupId)
      .where(sql`effective_to IS NULL`),
    check(
      'tpgs_interval_valid',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    foreignKey({
      name: 'tpgs_team_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.teamId],
      foreignColumns: [teams.organizationId, teams.propertyId, teams.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tpgs_portal_group_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalGroupId],
      foreignColumns: [
        portalGroups.organizationId,
        portalGroups.propertyId,
        portalGroups.id,
      ],
    }).onDelete('restrict'),
  ],
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
  (t) => [
    index('pgm_org_portal_idx').on(t.organizationId, t.portalId),
    // At most one active group per portal
    uniqueIndex('pgm_unique_active')
      .on(t.organizationId, t.portalId)
      .where(sql`effective_to IS NULL`),
  ],
)
