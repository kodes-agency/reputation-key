// Create + migrate the isolated test database (BQC-6.1) — clean-clone → green
// without manual DB prep. Idempotent: safe to run before every test session;
// fast-skips when the deploy migration state is already present. Refuses
// non-localhost targets unless ALLOW_REMOTE_TEST_DB=1 (denylist still applies).
//
// Applies the deploy migration sequence from ci.yml: auth:migrate → db:migrate
// → the registered sidecar SQL.
//
// Usage:
//   pnpm tsx scripts/test-db-setup.ts
//   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/scratch pnpm tsx scripts/test-db-setup.ts

import { ensureTestDatabase } from '../src/shared/testing/test-db-setup'

const result = await ensureTestDatabase()
console.log(
  `[test-db-setup] ${result.databaseUrl.replace(/:[^:@]+@/, ':***@')}\n` +
    `  created=${result.created} migrated=${result.migrated} ` +
    `tables=${result.tableCount} journal=${result.journalCount}`,
)
