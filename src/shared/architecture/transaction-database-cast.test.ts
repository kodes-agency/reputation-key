// A transaction is not handed on as a `Database` through a double cast.
//
// WHY A TEST. `db.transaction(async (tx) => …)` gives a handle that is not a
// `Database`, so passing it to a factory or helper typed `db: Database` takes a
// double cast. The cast compiles, and from then on the callee's signature says
// "top-level handle" while it holds a transaction: its own `db.transaction` is
// a savepoint, and nothing it commits is durable when it returns. A later edit
// that relies on the signature is wrong on that one path and no compiler or
// test objects.
//
// The 2026-09-28 review recorded this as fixed with the sites below still in
// place, and two more were written a week later in a new file. The cure at a
// site is to type the receiver for what it uses (`Tx`, or a
// `Pick<Database, …>` a transaction also satisfies); this list is what keeps a
// new site from being added while the old ones wait.
//
// Production modules under `src` only. Tests and test support build fakes with
// the same cast, which is a different thing.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

/**
 * The cast, to the type `Database` exactly. Any whitespace may separate the two
 * halves, because Prettier breaks a long expression between them.
 */
const DOUBLE_CAST = /\bas unknown\s+as Database\b/gu

/**
 * The sites that remain, and what each waits for. This list only shrinks:
 * remove a cast, then lower or delete its entry here in the same change.
 */
const REMAINING_SITES: Readonly<Record<string, number>> = {
  // Both repositories pass the transaction to read helpers typed
  // `db: Database`; the helpers need narrowing to the query surface they use.
  'src/contexts/feed/infrastructure/repositories/notification-delivery-settlement.repository.ts': 2,
  'src/contexts/feed/infrastructure/repositories/notification.repository.ts': 1,
  // The repository's port types every method `tx: Database`; the port needs a
  // transaction type of its own.
  'src/contexts/identity/infrastructure/repositories/google-content-authority.repository.ts': 1,
  // Builds the Portal lifetime repository on the lifecycle transaction, so its
  // own transaction is a savepoint; the repository factory needs to say so.
  'src/contexts/reporting/infrastructure/adapters/metric-organization-lifecycle.adapter.ts': 1,
}

const TEST_FILE = /\.(?:test|spec)\.tsx?$/u
const TEST_SUPPORT_DIRECTORIES: ReadonlySet<string> = new Set(['testing', '__fixtures__'])

function productionSources(directory: string): string[] {
  const sources: string[] = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) {
      if (!TEST_SUPPORT_DIRECTORIES.has(entry)) sources.push(...productionSources(full))
      continue
    }
    if (/\.tsx?$/u.test(entry) && !TEST_FILE.test(entry)) sources.push(full)
  }
  return sources
}

function doubleCastSites(): Record<string, number> {
  const sites: Record<string, number> = {}
  for (const file of productionSources(join(ROOT, 'src'))) {
    const count = [...readFileSync(file, 'utf8').matchAll(DOUBLE_CAST)].length
    if (count > 0) sites[relative(ROOT, file).split(sep).join('/')] = count
  }
  return sites
}

describe('transaction handles cast to Database', () => {
  it('exist only at the recorded sites, in the recorded number', () => {
    expect(doubleCastSites()).toEqual(REMAINING_SITES)
  })
})
