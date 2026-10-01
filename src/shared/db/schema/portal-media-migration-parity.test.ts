// Migration 0048 is hand-written SQL (drizzle/meta stops at 0013), so what it
// wrote is pinned here as literals and the catalogue renderings are tied to them
// by tripwires: when a purpose, status or format is added, these fail and ask
// for a widening migration instead of tempting anyone to edit 0048.
// `pnpm check:schema-drift` proves the model matches a migrated database.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PORTAL_MEDIA_PURPOSE_SQL_LIST,
  PORTAL_MEDIA_SOURCE_FORMAT_SQL_LIST,
  PORTAL_MEDIA_STATUS_SQL_LIST,
} from '#/shared/portal-media-schemas'

const ROOT = join(import.meta.dirname, '..', '..', '..', '..')
const MIGRATION = readFileSync(
  join(ROOT, 'drizzle', '0048_portal_media_assets.sql'),
  'utf8',
)
const JOURNAL = JSON.parse(
  readFileSync(join(ROOT, 'drizzle', 'meta', '_journal.json'), 'utf8'),
) as { entries: ReadonlyArray<{ idx: number; tag: string; when: number }> }

describe('migration 0048 Portal media assets', () => {
  it('tripwire: the catalogues still render what 0048 wrote', () => {
    expect(PORTAL_MEDIA_PURPOSE_SQL_LIST).toBe(`'hero', 'logo', 'link_image'`)
    expect(PORTAL_MEDIA_STATUS_SQL_LIST).toBe(`'active', 'taken_down'`)
    expect(PORTAL_MEDIA_SOURCE_FORMAT_SQL_LIST).toBe(`'jpeg', 'png', 'webp'`)
    expect(MIGRATION).toContain(`"purpose" IN ('hero', 'logo', 'link_image')`)
    expect(MIGRATION).toContain(`"status" IN ('active', 'taken_down')`)
    expect(MIGRATION).toContain(`"source_format" IN ('jpeg', 'png', 'webp')`)
  })

  it('ties every reference to an asset of the same Organization and Property', () => {
    for (const constraint of [
      'property_portal_brand_profiles_logo_asset_fk',
      'property_portal_brand_profiles_hero_asset_fk',
      'portal_links_image_asset_fk',
    ]) {
      const statement = MIGRATION.split('--> statement-breakpoint').find((part) =>
        part.includes(`ADD CONSTRAINT "${constraint}"`),
      )
      expect(statement, constraint).toBeDefined()
      expect(statement).toContain('("organization_id","property_id",')
      expect(statement).toContain(
        '"public"."portal_media_assets"("organization_id","property_id","id")',
      )
      expect(statement).toContain('ON DELETE restrict')
    }
  })

  it('stores the focal point as double precision, so 0.3 reads back as 0.3', () => {
    expect(MIGRATION).toContain('"hero_focal_x" double precision')
    expect(MIGRATION).toContain('"hero_focal_y" double precision')
    expect(MIGRATION).not.toMatch(/"hero_focal_[xy]" real/)
  })

  it('keeps only the indexes something uses', () => {
    // (organization_id, property_id, id) is the foreign-key target and also
    // serves the per-Property lookups; the primary key already makes id unique.
    expect(MIGRATION).not.toContain('portal_media_assets_org_id_key')
    expect(MIGRATION).not.toContain('portal_media_assets_property_idx')
    expect(MIGRATION).toContain('portal_media_assets_org_property_id_key')
    expect(MIGRATION).toContain('portal_media_assets_object_key_unique')
  })

  it('is journalled after the sealed address migration', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 48)
    expect(entry?.tag).toBe('0048_portal_media_assets')
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 47)
    expect(entry && previous && entry.when > previous.when).toBe(true)
  })
})

describe('migration 0049 object removal', () => {
  const MIGRATION_0049 = readFileSync(
    join(ROOT, 'drizzle', '0049_portal_media_object_deleted.sql'),
    'utf8',
  )

  it('adds the column and lets only a taken-down row carry it', () => {
    expect(MIGRATION_0049).toContain(
      'ADD COLUMN "object_deleted_at" timestamp with time zone',
    )
    expect(MIGRATION_0049).toContain(
      `CHECK ("portal_media_assets"."object_deleted_at" IS NULL OR "portal_media_assets"."status" = 'taken_down')`,
    )
  })

  it('is journalled after 0048', () => {
    const entry = JOURNAL.entries.find((candidate) => candidate.idx === 49)
    expect(entry?.tag).toBe('0049_portal_media_object_deleted')
    const previous = JOURNAL.entries.find((candidate) => candidate.idx === 48)
    expect(entry && previous && entry.when > previous.when).toBe(true)
  })
})
