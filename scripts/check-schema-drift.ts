// Standalone schema-drift check (BQC-5.4).
//
// Runs the semantic comparator (src/shared/db/schema-drift.ts) against a
// target database and exits non-zero on any drift. The same comparator backs
// the integration gate (src/shared/db/migration-verification.test.ts).
//
// Usage:
//   tsx scripts/check-schema-drift.ts [DATABASE_URL]
//   pnpm check:schema-drift            (uses $DATABASE_URL)
//
// The target DB must be fully migrated (auth:migrate + db:migrate + the
// registered sidecar) or every missing object reports as drift.

import { Pool } from 'pg'
import { collectSchemaDrift, formatDrifts } from '../src/shared/db/schema-drift'

async function main() {
  const url = process.argv[2] ?? process.env.DATABASE_URL
  if (!url) {
    console.error('Usage: tsx scripts/check-schema-drift.ts [DATABASE_URL]')
    process.exit(2)
  }
  const pool = new Pool({ connectionString: url })
  try {
    const drifts = await collectSchemaDrift(pool)
    if (drifts.length > 0) {
      console.error(`✗ Schema drift detected (${drifts.length}):`)
      console.error(formatDrifts(drifts))
      console.error(
        '\nFix the model in src/shared/db/schema/*.ts or register intentional ' +
          'DB-only constructs in src/shared/db/schema/db-only-constructs.ts ' +
          '(see src/shared/db/CONTEXT.md).',
      )
      process.exit(1)
    }
    console.log('✓ No schema drift — model matches the migrated catalog.')
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(2)
})
