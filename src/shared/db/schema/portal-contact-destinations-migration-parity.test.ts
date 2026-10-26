// Migration 0073 is hand-written SQL (drizzle/meta stops at 0013), so what it
// wrote is pinned here as literals and tied to the Drizzle model: a new source
// type fails this and asks for a widening migration instead of tempting anyone
// to edit 0073. `pnpm check:schema-drift` proves the model matches a migrated
// database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { portalApprovedDestinations } from './portal.schema'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0073_portal_contact_destinations.sql'),
  'utf8',
)
const JOURNAL = JSON.parse(
  readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
) as { entries: ReadonlyArray<{ idx: number; tag: string; when: number }> }

const STATEMENTS = MIGRATION.split('--> statement-breakpoint').map((part) =>
  part
    .split('\n')
    .filter((line) => !line.startsWith('--'))
    .join('\n')
    .trim(),
)

// What migration 0073 wrote, spelled out on purpose.
const SOURCE_TYPES = ['recognized', 'custom', 'provider', 'contact'] as const
const SOURCE_LIST = SOURCE_TYPES.map((type) => `'${type}'`).join(', ')

describe('migration 0073 contact destinations', () => {
  it('only re-creates the source CHECK with contact added, and rewrites no row', () => {
    expect(STATEMENTS).toEqual([
      'ALTER TABLE "portal_approved_destinations" DROP CONSTRAINT "portal_approved_destinations_source_valid";',
      'ALTER TABLE "portal_approved_destinations" ADD CONSTRAINT "portal_approved_destinations_source_valid" ' +
        `CHECK ("portal_approved_destinations"."source_type" IN (${SOURCE_LIST}));`,
    ])
    expect(STATEMENTS.join('\n')).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/u)
  })

  it('holds the same CHECK in the Drizzle model', () => {
    const check = getTableConfig(portalApprovedDestinations).checks.find(
      (candidate) => candidate.name === 'portal_approved_destinations_source_valid',
    )
    expect(check).toBeDefined()
    const rendered = new PgDialect().sqlToQuery(check!.value).sql
    // The very predicate migration 0073 adds, column qualified by its table.
    expect(rendered).toBe(
      `"portal_approved_destinations"."source_type" IN (${SOURCE_LIST})`,
    )
  })

  it('is the journal entry after 0072, with a later instant', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 73)
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 72)
    expect(entry?.tag).toBe('0073_portal_contact_destinations')
    expect(entry && previous && entry.when > previous.when).toBe(true)
  })
})
