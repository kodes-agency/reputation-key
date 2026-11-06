import { checkStructure, writeStructure } from '../src/shared/db/structure.server'
import { validateTestDatabaseTarget } from '../src/shared/testing/test-environment-lease'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function main(args = process.argv.slice(2)): Promise<void> {
  const write = args[0] === '--write'
  const url = args[write ? 1 : 0] ?? (write ? undefined : process.env.DATABASE_URL)
  if (!url || args.length > (write ? 2 : 1)) {
    throw new Error(
      'Usage: tsx scripts/check-schema-drift.ts [DATABASE_URL] | --write <disposable DATABASE_URL>',
    )
  }
  if (write) {
    validateTestDatabaseTarget(url)
    await writeStructure(url)
    console.log('Recorded structure.sql; review its diff before committing.')
    return
  }
  const faults = await checkStructure(url)
  if (faults.length > 0) {
    console.error(faults.map(({ object, detail }) => `${object}: ${detail}`).join('\n'))
    process.exitCode = 1
    return
  }
  console.log('Schema and migration journal match the canonical structure.')
}

const startedScript = process.argv[1]
if (
  startedScript !== undefined &&
  realpathSync(startedScript) === realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch(() => {
    console.error(
      'Schema check failed. Check the canonical structure.sql, PostgreSQL 16 pg_dump client and database access; use --write <disposable DATABASE_URL> only after migrating a fresh reference database.',
    )
    process.exitCode = 2
  })
}
