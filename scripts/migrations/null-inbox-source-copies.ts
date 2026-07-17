// BQC-1.2 — operator script: bounded null-backfill of inbox raw copies.
// Idempotent and resumable. Usage:
//   DATABASE_URL=... pnpm exec tsx scripts/migrations/null-inbox-source-copies.ts

import 'dotenv/config'
import { getDb } from '../../src/shared/db'
import { nullInboxSourceCopies } from '../../src/contexts/inbox/infrastructure/migrations/null-inbox-source-copies'

async function main(): Promise<void> {
  const result = await nullInboxSourceCopies(getDb(), {
    onBatch: (batch, rows) => console.log(`batch ${batch}: nulled ${rows} rows`),
  })
  console.log(
    `null-inbox-source-copies: done — ${result.rowsNulled} rows in ${result.batches} batches`,
  )
}

main().catch((err) => {
  console.error('null-inbox-source-copies failed', err)
  process.exit(1)
})
