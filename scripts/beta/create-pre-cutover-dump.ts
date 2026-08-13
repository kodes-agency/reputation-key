import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const JOURNAL_PATH = resolve('drizzle/meta/_journal.json')
const MIGRATION_ROOT = resolve('drizzle')
const DEFAULT_OUTPUT = resolve(
  'test-results/beta-smoke-inputs/beta-local-1-pre-cutover-0021.sql',
)
const PRE_CUTOVER_TAG = '0021_demonic_misty_knight'

type Journal = Readonly<{
  entries: readonly Readonly<{ tag: string; when: number }>[]
}>

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

export function createPreCutoverDump(outputPath = DEFAULT_OUTPUT): Readonly<{
  path: string
  sha256: string
  migrationHead: string
}> {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as Journal
  const cutoffIndex = journal.entries.findIndex((entry) => entry.tag === PRE_CUTOVER_TAG)
  if (cutoffIndex < 0) throw new Error(`Missing pre-cutover migration ${PRE_CUTOVER_TAG}`)
  if (cutoffIndex === journal.entries.length - 1)
    throw new Error('Pre-cutover fixture must leave at least one migration pending')
  const entries = journal.entries.slice(0, cutoffIndex + 1)
  const migrationSql: string[] = []
  const appliedRows: string[] = []
  for (const entry of entries) {
    const path = resolve(MIGRATION_ROOT, `${entry.tag}.sql`)
    const sql = readFileSync(path, 'utf8')
    const digest = createHash('sha256').update(sql, 'utf8').digest('hex')
    migrationSql.push(
      `\n-- beta-local-1 applied migration: ${entry.tag}\n${sql.trim()}\n`,
    )
    appliedRows.push(`('${digest}', ${entry.when})`)
  }
  const fixture = [
    '\\set ON_ERROR_STOP on',
    '-- beta-local-1 deterministic versioned pre-cutover fixture',
    `-- old migration head: ${PRE_CUTOVER_TAG}`,
    '-- Better Auth owns these tables outside the Drizzle journal. The',
    '-- pre-cutover Drizzle track references their stable primary keys; the',
    '-- deploy migrator adds the remaining auth columns and tables on upgrade.',
    'CREATE TABLE IF NOT EXISTS public."user" (',
    '  "id" text PRIMARY KEY',
    ');',
    'CREATE TABLE IF NOT EXISTS public."organization" (',
    '  "id" text PRIMARY KEY',
    ');',
    ...migrationSql,
    'CREATE SCHEMA IF NOT EXISTS drizzle;',
    'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (',
    '  id serial PRIMARY KEY,',
    '  hash text NOT NULL,',
    '  created_at bigint',
    ');',
    'TRUNCATE TABLE drizzle.__drizzle_migrations RESTART IDENTITY;',
    'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES',
    `${appliedRows.join(',\n')};`,
    'CREATE TABLE IF NOT EXISTS public.beta_local_pre_cutover_fixture (',
    '  fixture_version text PRIMARY KEY,',
    '  old_migration_head text NOT NULL,',
    '  legacy_seed_state jsonb NOT NULL',
    ');',
    'INSERT INTO public.beta_local_pre_cutover_fixture',
    '  (fixture_version, old_migration_head, legacy_seed_state)',
    `VALUES ('beta-local-1', '${PRE_CUTOVER_TAG}', '{"legacyPolicy":"dark","legacyAssignments":true,"legacyPortalPublication":true}'::jsonb);`,
    '',
  ].join('\n')
  const output = resolve(outputPath)
  const digest = createHash('sha256').update(fixture, 'utf8').digest('hex')
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, fixture, { encoding: 'utf8', flag: 'w' })
  writeFileSync(`${output}.sha256`, `${digest}  ${basename(output)}\n`, {
    encoding: 'utf8',
    flag: 'w',
  })
  return { path: output, sha256: digest, migrationHead: PRE_CUTOVER_TAG }
}

export function runCreatePreCutoverDumpCli(args: readonly string[]): number {
  try {
    const result = createPreCutoverDump(flagValue(args, '--output'))
    console.log(`created ${result.path} at ${result.migrationHead} (${result.sha256})`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runCreatePreCutoverDumpCli(process.argv.slice(2))
}
