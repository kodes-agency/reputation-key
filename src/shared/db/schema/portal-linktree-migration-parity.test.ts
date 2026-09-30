// Migration 0044 is hand-written SQL (drizzle/meta stops at 0013), so an applied
// migration's CHECK bodies are pinned here as literals and the catalogue
// renderings are tied to them by tripwires: when the icon set or the locale
// list grows, these fail and ask for a widening migration instead of tempting
// anyone to edit 0044. `pnpm check:schema-drift` proves the model matches a
// migrated database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GUEST_LOCALE_SQL_LIST } from '#/shared/guest-locale-schemas'
import { PORTAL_LINK_ICON_SQL_LIST } from '#/shared/portal-link-icon-schemas'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0044_portal_linktree_model.sql'),
  'utf8',
)
const JOURNAL = JSON.parse(
  readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
) as { entries: ReadonlyArray<{ idx: number; tag: string; when: number }> }

// What migration 0044 wrote, spelled out on purpose.
const ICON_LIST_0044 = `'link', 'external-link', 'globe', 'utensils', 'coffee', 'wine', 'bed-double', 'map-pin', 'phone', 'mail', 'calendar', 'clock', 'star', 'gift', 'shopping-bag', 'music', 'ticket', 'wifi', 'car', 'info', 'heart', 'scissors', 'sparkles', 'camera', 'book-open'`
const LOCALE_LIST_0044 = `'en', 'es', 'it', 'fr', 'de', 'bg'`

const statements = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const statementMatching = (pattern: RegExp): string => {
  const found = statements.filter((statement) => pattern.test(statement))
  expect(found).toHaveLength(1)
  return found[0] as string
}

describe('migration 0044 Linktree model', () => {
  it('tripwire: the catalogues still render what 0044 wrote', () => {
    expect(PORTAL_LINK_ICON_SQL_LIST).toBe(ICON_LIST_0044)
    expect(GUEST_LOCALE_SQL_LIST).toBe(LOCALE_LIST_0044)
  })

  it('closes portal_links.icon_key to the icon catalogue and clears strays first', () => {
    const check = statementMatching(/ADD CONSTRAINT "portal_links_icon_key_valid"/)
    expect(check).toContain(`IN (${ICON_LIST_0044})`)
    const clear = statementMatching(/^UPDATE "portal_links" SET "icon_key" = NULL/)
    expect(clear).toContain(`NOT IN (${ICON_LIST_0044})`)
    expect(statements.indexOf(clear)).toBeLessThan(statements.indexOf(check))
  })

  it('limits portal_link_texts to the six locales', () => {
    const table = statementMatching(/^CREATE TABLE "portal_link_texts"/)
    expect(table).toContain(`"locale" IN (${LOCALE_LIST_0044})`)
  })

  it('tenant-scopes portal_link_texts through both its parents', () => {
    const portal = statementMatching(
      /ADD CONSTRAINT "portal_link_texts_portal_tenant_fk"/,
    )
    expect(portal).toContain('("organization_id","property_id","portal_id")')
    const link = statementMatching(/ADD CONSTRAINT "portal_link_texts_link_tenant_fk"/)
    expect(link).toContain('("organization_id","portal_id","link_id")')
    expect(link).toContain('ON DELETE cascade')
  })

  it('backfills one text per link in the primary language, only from a present label', () => {
    const backfill = statementMatching(/^INSERT INTO "portal_link_texts"/)
    expect(backfill).toContain('p."primary_guest_locale"')
    expect(backfill).toContain('length(btrim(l."label")) > 0')
    expect(backfill).toContain('ON CONFLICT')
    expect(statements.indexOf(backfill)).toBeGreaterThan(
      statements.indexOf(statementMatching(/^CREATE TABLE "portal_link_texts"/)),
    )
  })

  it('widens the override has-value check to count a Linktree title', () => {
    const added = statementMatching(
      /ADD CONSTRAINT "portal_localized_overrides_has_value"/,
    )
    expect(added).toContain('"linktree_title" IS NOT NULL')
  })

  it('adds the enabled switch on, and the title column null', () => {
    expect(MIGRATION).toContain(
      'ALTER TABLE "portals" ADD COLUMN "linktree_enabled" boolean DEFAULT true NOT NULL',
    )
    expect(MIGRATION).toContain(
      'ALTER TABLE "portal_localized_overrides" ADD COLUMN "linktree_title" varchar(60)',
    )
  })

  it('is registered in the journal after 0043 with a later timestamp', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 44)
    expect(entry?.tag).toBe('0044_portal_linktree_model')
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 43)
    expect(entry?.when).toBeGreaterThan(previous?.when ?? Number.POSITIVE_INFINITY)
  })
})
