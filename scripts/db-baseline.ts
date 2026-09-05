// Regenerate the whole Drizzle journal from the pgTable declarations.
//
// The journal is not history any more. It is two files: the schema Drizzle can
// derive from `src/shared/db/schema/`, plus the constructs it cannot express —
// the functions and triggers kept by hand in `src/shared/db/db-constructs.sql`.
// Run this after any schema edit, then `pnpm db:reset`.
//
// This is only safe because every environment starts from an empty database.
// If that ever stops being true, append a migration instead of re-baselining:
// rewriting the journal orphans the rows a populated database already applied.

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DRIZZLE_DIR = join(ROOT, 'drizzle')
const CONSTRUCTS = join(ROOT, 'src/shared/db/db-constructs.sql')
const SEED = join(ROOT, 'src/shared/db/db-seed.sql')
// drizzle-kit writes one snapshot per migration, so a three-migration journal
// carries three of them. The plan's four-file expectation was wrong on both
// counts: it missed the per-migration snapshots and the seed migration.
const EXPECTED = [
  '0000_baseline.sql',
  '0001_db_constructs.sql',
  '0002_db_seed.sql',
  'meta/0000_snapshot.json',
  'meta/0001_snapshot.json',
  'meta/0002_snapshot.json',
  'meta/_journal.json',
]

function drizzleKit(args: readonly string[]): void {
  execFileSync('pnpm', ['exec', 'drizzle-kit', ...args], {
    cwd: ROOT,
    stdio: 'inherit',
  })
}

const BREAKPOINT = '--> statement-breakpoint'
const UNIQUE_INDEX = /^CREATE UNIQUE INDEX/mu
const FOREIGN_KEY = /^ALTER TABLE .* FOREIGN KEY/mu

/**
 * drizzle-kit emits types, then tables, then foreign keys, then indexes. A
 * composite foreign key that references a column pair backed by a unique INDEX
 * rather than a unique CONSTRAINT therefore fails: at that point the index does
 * not exist yet and PostgreSQL reports "no unique constraint matching given
 * keys". The 182-migration history never hit this because indexes and keys were
 * interleaved across migrations.
 *
 * Hoisting every unique index above every foreign key fixes it for good and
 * changes no semantics — these are all created inside one transaction.
 */
function hoistUniqueIndexes(sql: string): string {
  const statements = sql.split(BREAKPOINT)
  const uniqueIndexes = statements.filter((s) => UNIQUE_INDEX.test(s))
  const foreignKeys = statements.filter(
    (s) => FOREIGN_KEY.test(s) && !UNIQUE_INDEX.test(s),
  )
  const rest = statements.filter(
    (s) => !uniqueIndexes.includes(s) && !foreignKeys.includes(s),
  )
  if (uniqueIndexes.length === 0 || foreignKeys.length === 0) return sql
  return [...rest, ...uniqueIndexes, ...foreignKeys]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(`\n${BREAKPOINT}\n`)
}

function main(): void {
  for (const source of [CONSTRUCTS, SEED]) {
    if (!existsSync(source)) {
      throw new Error(`missing ${source} — it is one of the generated migrations`)
    }
  }

  rmSync(DRIZZLE_DIR, { recursive: true, force: true })
  drizzleKit(['generate', '--name', 'baseline'])
  drizzleKit(['generate', '--custom', '--name', 'db_constructs'])
  drizzleKit(['generate', '--custom', '--name', 'db_seed'])

  const baseline = join(DRIZZLE_DIR, '0000_baseline.sql')
  writeFileSync(baseline, hoistUniqueIndexes(readFileSync(baseline, 'utf8')))

  // `--custom` emits an empty SQL file plus its journal entry; the constructs
  // and seeds are authored in the repository, so their content is copied over.
  copyFileSync(CONSTRUCTS, join(DRIZZLE_DIR, '0001_db_constructs.sql'))
  copyFileSync(SEED, join(DRIZZLE_DIR, '0002_db_seed.sql'))

  const produced = readdirSync(DRIZZLE_DIR, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.sql') || entry.endsWith('.json'))
    .map((entry) => entry.split('\\').join('/'))
    .sort()
  const missing = EXPECTED.filter((entry) => !produced.includes(entry))
  const unexpected = produced.filter((entry) => !EXPECTED.includes(entry))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `drizzle/ must contain exactly ${EXPECTED.join(', ')} — ` +
        `missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`,
    )
  }

  console.log(`[db:baseline] regenerated drizzle/ — ${produced.join(', ')}`)
  console.log('[db:baseline] next: pnpm db:reset && pnpm check:schema-drift')
}

main()
