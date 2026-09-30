// Migration 0043 is hand-written SQL (drizzle/meta stops at 0013, so there is
// no generator to keep it honest). An applied migration is history and never
// changes, so its expected CHECK bodies are pinned here as literals. The
// tripwire below ties the live catalogue renderings to those literals: when the
// catalogue grows it fails and asks for a new widening migration, instead of
// tempting anyone to edit 0043. `pnpm check:schema-drift` proves the model
// matches a migrated database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GUEST_LANGUAGE_PACK_SQL_PATTERN,
  GUEST_LOCALE_JSONB_LITERAL,
  GUEST_LOCALE_SQL_LIST,
} from '#/shared/guest-locale-schemas'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0043_guest_locales_six.sql'),
  'utf8',
)
const JOURNAL = JSON.parse(
  readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
) as { entries: ReadonlyArray<{ idx: number; tag: string; when: number }> }

type CheckExpectation = Readonly<{
  constraint: string
  table: string
  fragment: string
}>

// What migration 0043 wrote, spelled out on purpose.
const IN_LIST_0043 = `'en', 'es', 'it', 'fr', 'de', 'bg'`
const JSONB_LITERAL_0043 = `["en", "es", "it", "fr", "de", "bg"]`
const PACK_PATTERN_0043 = `^guest-ui-(en|es|it|fr|de|bg)-v[1-9][0-9]{0,2}$`

const CHECKS: readonly CheckExpectation[] = [
  {
    constraint: 'portals_primary_guest_locale_active',
    table: 'portals',
    fragment: `IN (${IN_LIST_0043})`,
  },
  {
    constraint: 'portals_additional_guest_locales_array',
    table: 'portals',
    fragment: `<@ '${JSONB_LITERAL_0043}'::jsonb`,
  },
  {
    constraint: 'property_portal_brand_contents_locale_active',
    table: 'property_portal_brand_contents',
    fragment: `IN (${IN_LIST_0043})`,
  },
  {
    constraint: 'portal_localized_overrides_locale_active',
    table: 'portal_localized_overrides',
    fragment: `IN (${IN_LIST_0043})`,
  },
  {
    constraint: 'portal_publication_snapshots_locale_valid',
    table: 'portal_publication_snapshots',
    fragment: `IN (${IN_LIST_0043})`,
  },
  {
    constraint: 'portal_publication_snapshots_locale_set_valid',
    table: 'portal_publication_snapshots',
    fragment: `<@ '${JSONB_LITERAL_0043}'::jsonb`,
  },
  {
    constraint: 'portal_publication_snapshots_language_pack_valid',
    table: 'portal_publication_snapshots',
    fragment: `~ '${PACK_PATTERN_0043}'`,
  },
]

const statements = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

function statementsFor(constraint: string, verb: 'DROP' | 'ADD'): string[] {
  return statements.filter((statement) =>
    new RegExp(`${verb} CONSTRAINT "${constraint}"`).test(statement),
  )
}

describe('migration 0043 guest locale CHECKs', () => {
  it('tripwire: the catalogue still renders what 0043 wrote', () => {
    // Fails when a locale is added to the catalogue. Write a new widening
    // migration for it; never edit 0043 to make this pass.
    expect(GUEST_LOCALE_SQL_LIST).toBe(IN_LIST_0043)
    expect(GUEST_LOCALE_JSONB_LITERAL).toBe(JSONB_LITERAL_0043)
    expect(GUEST_LANGUAGE_PACK_SQL_PATTERN).toBe(PACK_PATTERN_0043)
  })

  it.each(CHECKS)(
    'drops and re-adds $constraint with the catalogue rendering',
    ({ constraint, table, fragment }) => {
      const dropped = statementsFor(constraint, 'DROP')
      const added = statementsFor(constraint, 'ADD')
      expect(dropped).toHaveLength(1)
      expect(added).toHaveLength(1)
      expect(dropped[0]).toContain(`ALTER TABLE "${table}"`)
      expect(added[0]).toContain(`ALTER TABLE "${table}"`)
      expect(added[0]).toContain(fragment)
    },
  )

  it('changes exactly the seven guest locale constraints and nothing else', () => {
    expect(statements).toHaveLength(CHECKS.length * 2)
    for (const statement of statements) {
      expect(statement).toMatch(/^ALTER TABLE "[a-z_]+" (DROP|ADD) CONSTRAINT "/)
    }
  })

  it('keeps the snapshot locale set tied to its primary locale', () => {
    const added = statementsFor('portal_publication_snapshots_locale_set_valid', 'ADD')[0]
    expect(added).toContain(
      `@> jsonb_build_array("portal_publication_snapshots"."guest_locale")`,
    )
    expect(added).toContain(
      `jsonb_typeof("portal_publication_snapshots"."locale_set") = 'array'`,
    )
  })

  it('is registered in the journal after 0042 with a later timestamp', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 43)
    expect(entry?.tag).toBe('0043_guest_locales_six')
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 42)
    expect(entry?.when).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY)
  })
})
