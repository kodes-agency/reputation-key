// Migration 0043 is hand-written SQL (drizzle/meta stops at 0013, so there is
// no generator to keep it honest). This test pins its seven CHECK bodies to the
// catalogue renderings the Drizzle model uses, so the two cannot drift apart
// silently. `pnpm check:schema-drift` proves the same against a migrated
// database.

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

const CHECKS: readonly CheckExpectation[] = [
  {
    constraint: 'portals_primary_guest_locale_active',
    table: 'portals',
    fragment: `IN (${GUEST_LOCALE_SQL_LIST})`,
  },
  {
    constraint: 'portals_additional_guest_locales_array',
    table: 'portals',
    fragment: `<@ '${GUEST_LOCALE_JSONB_LITERAL}'::jsonb`,
  },
  {
    constraint: 'property_portal_brand_contents_locale_active',
    table: 'property_portal_brand_contents',
    fragment: `IN (${GUEST_LOCALE_SQL_LIST})`,
  },
  {
    constraint: 'portal_localized_overrides_locale_active',
    table: 'portal_localized_overrides',
    fragment: `IN (${GUEST_LOCALE_SQL_LIST})`,
  },
  {
    constraint: 'portal_publication_snapshots_locale_valid',
    table: 'portal_publication_snapshots',
    fragment: `IN (${GUEST_LOCALE_SQL_LIST})`,
  },
  {
    constraint: 'portal_publication_snapshots_locale_set_valid',
    table: 'portal_publication_snapshots',
    fragment: `<@ '${GUEST_LOCALE_JSONB_LITERAL}'::jsonb`,
  },
  {
    constraint: 'portal_publication_snapshots_language_pack_valid',
    table: 'portal_publication_snapshots',
    fragment: `~ '${GUEST_LANGUAGE_PACK_SQL_PATTERN}'`,
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
