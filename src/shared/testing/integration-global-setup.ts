// Integration project globalSetup (BQC-6.1) — creates + migrates the isolated
// scratch database before any integration test file loads, so a clean clone
// goes green without manual DB prep. Idempotent: fast-skips when the deploy
// migration state (journal + auth tables + sidecar) is already present.
// Wired in vitest.config.ts (integration project only).

import { ensureTestDatabase } from './test-db-setup'

export default async function setup(): Promise<void> {
  const result = await ensureTestDatabase()
  process.stdout.write(
    `[integration-global-setup] ${result.databaseUrl.replace(/:[^:@]+@/, ':***@')} ` +
      `created=${result.created} migrated=${result.migrated} ` +
      `tables=${result.tableCount} journal=${result.journalCount}\n`,
  )
}
