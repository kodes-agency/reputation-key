import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import { getTableName, isTable } from 'drizzle-orm'
import * as migratable from './src/shared/db/schema/migratable'

config({ path: ['.env.local', '.env'] })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required for Drizzle tooling')

// The migratable barrel IS the boundary: every app-owned table. Auth
// tables (user, session, account, verification, organization, member,
// invitation, organizationRole) are excluded by the barrel and managed by
// `pnpm auth:migrate` (Better Auth CLI). tablesFilter is derived FROM the
// barrel (never a second hand-maintained list): db:push introspects only
// these tables — without it, push pulls the auth tables, hits interactive
// rename/conflict prompts, and dies in non-TTY shells (simulation.yml).
const managedTables: string[] = []
for (const value of Object.values(migratable)) {
  if (isTable(value)) managedTables.push(getTableName(value))
}

export default defineConfig({
  out: './drizzle',
  schema: './src/shared/db/schema/migratable.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  tablesFilter: managedTables,
  // Schema authority (BQC-5.4): Better Auth owns its tables; this journal owns
  // application tables, DB-only constructs, and control-plane seed data. The
  // Drizzle model is verified semantically against migrated metadata by
  // src/shared/db/migration-verification.test.ts. Migrate-based workflow:
  // edit schema -> `pnpm db:baseline` -> commit drizzle/ -> `pnpm db:migrate`.
  // Do NOT use db:push — it bypasses the journal and concealed prior drift.
  // Deploy order is `pnpm auth:migrate` -> `pnpm db:migrate`, so constructs
  // targeting Better Auth tables resolve. BQC-7.1 runs both tracks inside the
  // Railway preDeployCommand via scripts/migrate-deploy.ts (advisory-locked,
  // idempotent, forward-recovery); CI's "Predeploy migration parity" step
  // proves end-state equivalence.
})
