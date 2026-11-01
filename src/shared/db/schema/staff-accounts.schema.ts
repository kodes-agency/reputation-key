import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { properties } from './property.schema'

export const staffOnboardings = pgTable(
  'staff_onboardings',
  {
    id: uuid('id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    email: text('email'),
    displayName: varchar('display_name', { length: 100 }),
    sourcePortalId: uuid('source_portal_id'),
    portalGroupId: uuid('portal_group_id'),
    requestedBy: varchar('requested_by', { length: 255 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('running'),
    step: text('step').notNull(),
    staffParticipantId: uuid('staff_participant_id'),
    staffParticipationId: uuid('staff_participation_id'),
    portalId: uuid('portal_id'),
    invitationId: text('invitation_id'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'staff_onboardings_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
    uniqueIndex('staff_onboardings_unfinished_address')
      .on(t.organizationId, t.propertyId, t.email)
      .where(sql`status IN ('running', 'failed')`),
    check(
      'staff_onboardings_status_valid',
      sql`${t.status} IN ('running', 'failed', 'done', 'cancelled')`,
    ),
    check(
      'staff_onboardings_email_lowercase',
      sql`${t.email} IS NULL OR ${t.email} = lower(${t.email})`,
    ),
    check(
      'staff_onboardings_finished_identifiers_only',
      sql`${t.status} NOT IN ('done', 'cancelled') OR (${t.email} IS NULL AND ${t.displayName} IS NULL)`,
    ),
  ],
)

export const staffPropertySettings = pgTable(
  'staff_property_settings',
  {
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    colleagueListEnabled: boolean('colleague_list_enabled').notNull().default(false),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.propertyId] }),
    foreignKey({
      name: 'staff_property_settings_property_tenant_fk',
      columns: [t.organizationId, t.propertyId],
      foreignColumns: [properties.organizationId, properties.id],
    }).onDelete('restrict'),
  ],
)
