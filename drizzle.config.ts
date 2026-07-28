import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import { getTableName, isTable } from 'drizzle-orm'
import * as migratable from './src/shared/db/schema/migratable'

config({ path: ['.env.local', '.env'] })

// The migratable barrel IS the boundary: all 60 app-owned tables. Auth
// tables (user, session, account, verification, organization, member,
// invitation, organizationRole) are excluded by the barrel and managed by
// `pnpm auth:migrate` (Better Auth CLI). tablesFilter is derived FROM the
// barrel (never a second hand-maintained list): db:push introspects only
// these tables — without it, push pulls the auth tables, hits interactive
// rename/conflict prompts, and dies in non-TTY shells (simulation.yml).
const managedTables = Object.values(migratable).filter(isTable).map(getTableName)

export default defineConfig({
  out: './drizzle',
  schema: './src/shared/db/schema/migratable.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  tablesFilter: managedTables,
  // Schema authority (BQC-5.4): the migration SQL track (this journal +
  // better-auth CLI + registered deploy sidecars) is authoritative; the
  // Drizzle model is verified semantically against the migrated metadata by
  // src/shared/db/migration-verification.test.ts. Migrate-based workflow:
  // edit schema -> `pnpm db:generate` -> commit drizzle/ -> `pnpm db:migrate`
  // (deploy). Do NOT use db:push — it bypasses the journal and was the root
  // cause of the prior schema drift. Deploy apply order:
  //   `pnpm auth:migrate` -> `pnpm db:migrate` -> registered raw-SQL sidecars
  // (currently scripts/migrations/2026-07-06-permission-version-triggers.sql
  // — functions/triggers/BA-table index that Drizzle cannot express; see
  // src/shared/db/schema/db-only-constructs.ts and src/shared/db/CONTEXT.md).
})
