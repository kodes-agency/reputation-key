import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.local', '.env'] })

export default defineConfig({
  out: './drizzle',
  // Business tables only — auth tables (user, session, account, verification,
  // organization, member, invitation) are managed by `pnpm auth:migrate`.
  schema: './src/shared/db/schema/business.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Only manage business tables. Auth tables (user, session, account,
  // verification, organization, member, invitation) are managed by
  // `pnpm auth:migrate` (Better Auth CLI). Without this filter, db:push
  // would try to drop them since they're not in the business schema.
  tablesFilter: [
    'properties',
    'teams',
    'staff_assignments',
    'audit_logs',
    'portals',
    'portal_groups',
    'portal_link_categories',
    'portal_links',
    'feedback',
    'ratings',
    'scan_events',
    'google_connections',
    'gbp_cache',
    'gbp_import_jobs',
    'reviews',
    'replies',
    'inbox_items',
    'inbox_notes',
    'metric_definitions',
    'metric_readings',
    'goals',
    'goal_progress',
    'activity_log',
  ],
})
