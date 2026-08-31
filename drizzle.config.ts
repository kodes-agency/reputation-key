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
  // Schema authority (BQC-5.4): the migration SQL track (this journal +
  // better-auth CLI + registered deploy sidecars) is authoritative; the
  // Drizzle model is verified semantically against the migrated metadata by
  // src/shared/db/migration-verification.test.ts. Migrate-based workflow:
  // edit schema -> `pnpm db:generate` -> commit drizzle/ -> `pnpm db:migrate`
  // (staged journal runner + deploy). Do NOT use db:push — it bypasses the
  // journal and caused the prior schema drift. Deploy apply order:
  //   `pnpm auth:migrate` -> `pnpm db:migrate` (0033 commit boundary + journal) -> registered raw-SQL sidecars
  // (currently scripts/migrations/2026-07-06-permission-version-triggers.sql
  // — functions/triggers/BA-table index that Drizzle cannot express; see
  // src/shared/db/schema/db-only-constructs.ts and src/shared/db/CONTEXT.md).
  // BQC-7.1: at deploy time this trio runs inside the Railway
  // preDeployCommand via scripts/migrate-deploy.ts (advisory-locked,
  // idempotent, forward-recovery) — the better-auth track runs through
  // better-auth's getMigrations and the same staged Drizzle journal runner
  // used by `pnpm db:migrate`; CI's "Predeploy migration parity" step proves
  // end-state equivalence.
})
