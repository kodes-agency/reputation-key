// Migration 0045 is hand-written SQL (drizzle/meta stops at 0013), so what it
// wrote is pinned here as literals and the catalogue renderings are tied to
// them by a tripwire: when the locale list grows, this fails and asks for a
// widening migration instead of tempting anyone to edit 0045.
// `pnpm check:schema-drift` proves the model matches a migrated database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GUEST_LOCALE_JSONB_LITERAL,
  GUEST_LOCALE_SQL_LIST,
} from '#/shared/guest-locale-schemas'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0045_property_look_model.sql'),
  'utf8',
)
const JOURNAL = JSON.parse(
  readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
) as { entries: ReadonlyArray<{ idx: number; tag: string; when: number }> }

const LOCALE_LIST_0045 = `'en', 'es', 'it', 'fr', 'de', 'bg'`
const LOCALE_JSONB_0045 = `["en", "es", "it", "fr", "de", "bg"]`

const statements = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const statementMatching = (pattern: RegExp): string => {
  const found = statements.filter((statement) => pattern.test(statement))
  expect(found).toHaveLength(1)
  return found[0] as string
}

describe('migration 0045 Property look model', () => {
  it('tripwire: the catalogue still renders what 0045 wrote', () => {
    expect(GUEST_LOCALE_SQL_LIST).toBe(LOCALE_LIST_0045)
    expect(GUEST_LOCALE_JSONB_LITERAL).toBe(LOCALE_JSONB_0045)
  })

  it('adds the look columns with safe defaults', () => {
    expect(MIGRATION).toContain(
      'ALTER TABLE "property_portal_brand_profiles" ADD COLUMN "wordmark" varchar(24);',
    )
    expect(MIGRATION).toContain(
      `ADD COLUMN "background_mode" varchar(10) DEFAULT 'auto' NOT NULL`,
    )
    expect(MIGRATION).toContain(
      `ADD COLUMN "default_guest_locales" jsonb DEFAULT '["en"]'::jsonb NOT NULL`,
    )
    expect(MIGRATION).toContain('ADD COLUMN "look_version" integer DEFAULT 1 NOT NULL')
    expect(MIGRATION).toContain(
      'ALTER TABLE "property_portal_brand_contents" ADD COLUMN "hero_alt_text" varchar(160);',
    )
  })

  it('closes the background mode and keeps the wordmark non-blank', () => {
    expect(
      statementMatching(
        /ADD CONSTRAINT "property_portal_brand_profiles_background_mode_valid"/,
      ),
    ).toContain(`IN ('auto', 'manual')`)
    expect(
      statementMatching(
        /ADD CONSTRAINT "property_portal_brand_profiles_wordmark_present"/,
      ),
    ).toContain('length(btrim(')
  })

  it('limits the default languages to one to six of the catalogue', () => {
    const check = statementMatching(
      /ADD CONSTRAINT "property_portal_brand_profiles_default_locales_valid"/,
    )
    expect(check).toContain(`jsonb_typeof(`)
    expect(check).toContain('BETWEEN 1 AND 6')
    expect(check).toContain(`<@ '${LOCALE_JSONB_0045}'::jsonb`)
  })

  it('backfills the default languages after the column exists and before the CHECK', () => {
    const column = statementMatching(/ADD COLUMN "default_guest_locales"/)
    const backfill = statementMatching(/^UPDATE "property_portal_brand_profiles" AS p/)
    const check = statementMatching(/default_locales_valid/)
    expect(statements.indexOf(backfill)).toBeGreaterThan(statements.indexOf(column))
    expect(statements.indexOf(backfill)).toBeLessThan(statements.indexOf(check))
    // Live Portals only, earliest Portal's language first.
    expect(backfill).toContain('"deleted_at" IS NULL')
    expect(backfill).toContain('ORDER BY earliest."created_at"')
  })

  it('keeps the hero alt text non-blank', () => {
    expect(
      statementMatching(
        /ADD CONSTRAINT "property_portal_brand_contents_hero_alt_present"/,
      ),
    ).toContain('length(btrim(')
  })

  it('is registered in the journal after 0044 with a later timestamp', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 45)
    expect(entry?.tag).toBe('0045_property_look_model')
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 44)
    expect(entry?.when).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY)
  })
})
