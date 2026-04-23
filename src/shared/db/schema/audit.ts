// Audit log table — tracks significant actions across all contexts
// Per Phase 3 plan: "Audit log table (audit_logs) with a minimal implementation"
// Per architecture: schemas live in shared/db/schema/ because Drizzle needs a single barrel.
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const auditLogs = pgTable('audit_logs', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull(),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  details: jsonb('details'),
  success: boolean('success').notNull().default(true),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
