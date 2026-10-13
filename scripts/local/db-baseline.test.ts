// `pnpm db:baseline` deletes `drizzle/` and writes three generated migrations.
// It was the documented schema change loop while every database started
// empty; the journal has since been appended by hand and applied by a
// database that keeps its data. These tests run the real script on a
// throwaway checkout: the script finds its repository from its own path, so it
// works on the copy and never on this repository's `drizzle/`.

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const BASELINE_SCRIPT = 'scripts/db-baseline.ts'
const GENERATED = [
  '0000_baseline.sql',
  '0001_db_constructs.sql',
  '0002_db_seed.sql',
] as const

const checkouts: string[] = []

afterEach(() => {
  for (const checkout of checkouts.splice(0)) {
    rmSync(checkout, { recursive: true, force: true })
  }
})

/** A throwaway checkout: the script, its two SQL sources and the given migrations. */
function checkoutWith(migrations: readonly string[]): string {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), 'repkey-baseline-')))
  checkouts.push(checkout)
  mkdirSync(join(checkout, 'scripts'))
  cpSync(join(ROOT, BASELINE_SCRIPT), join(checkout, BASELINE_SCRIPT))
  mkdirSync(join(checkout, 'src/shared/db'), { recursive: true })
  writeFileSync(join(checkout, 'src/shared/db/db-constructs.sql'), 'SELECT 1;\n')
  writeFileSync(join(checkout, 'src/shared/db/db-seed.sql'), 'SELECT 1;\n')
  mkdirSync(join(checkout, 'drizzle/meta'), { recursive: true })
  for (const migration of migrations) {
    writeFileSync(join(checkout, 'drizzle', migration), 'SELECT 1;\n')
  }
  return checkout
}

function runBaseline(checkout: string) {
  // Started from the real repository so that `tsx` resolves.
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(checkout, BASELINE_SCRIPT)],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

function migrationsIn(checkout: string): readonly string[] {
  if (!existsSync(join(checkout, 'drizzle'))) return []
  return readdirSync(join(checkout, 'drizzle'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

describe('pnpm db:baseline', () => {
  it('refuses a journal with appended migrations and deletes nothing', () => {
    const appended = ['0003_first_appended.sql', '0054_data_backfill.sql']
    const checkout = checkoutWith([...GENERATED, ...appended])

    const { status, output } = runBaseline(checkout)

    expect(migrationsIn(checkout)).toEqual([...GENERATED, ...appended])
    expect(output).toContain(
      '[db:baseline] refused: drizzle/ holds 2 migration(s) appended after the generated three ' +
        '(0003_first_appended.sql to 0054_data_backfill.sql)',
    )
    expect(output).toContain('Append a migration instead: src/shared/db/CONTEXT.md')
    expect(status).toBe(1)
  }, 60_000)

  // The refusal is about appended migrations, not about the tool: a journal
  // that holds only what the script writes is still regenerated. The throwaway
  // checkout has no drizzle configuration, so the run stops at drizzle-kit,
  // after the old files went.
  it('still regenerates a journal that holds only its own three migrations', () => {
    const checkout = checkoutWith(GENERATED)

    const { output } = runBaseline(checkout)

    expect(output).not.toContain('[db:baseline] refused')
    expect(migrationsIn(checkout)).toEqual([])
  }, 60_000)
})
