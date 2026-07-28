import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.local', '.env'] })

export default defineConfig({
  out: './drizzle',
  // All 60 app-owned tables — the migratable barrel IS the boundary (no
  // tablesFilter whitelist). Auth tables (user, session, account,
  // verification, organization, member, invitation, organizationRole) are
  // excluded by the barrel and managed by `pnpm auth:migrate` (Better Auth
  // CLI).
  schema: './src/shared/db/schema/migratable.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
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
