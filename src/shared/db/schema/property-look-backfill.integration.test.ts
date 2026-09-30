// Migration 0045 backfills each Property's default guest languages from the
// languages its live Portals already offer. The migration is applied once, so
// this suite re-runs its backfill statement (taken from the migration file,
// narrowed to one organization) over legacy-shaped rows and proves what it
// writes, what it leaves alone and that a second run changes nothing. It also
// covers the look columns' own constraints.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

const MIGRATION = readFileSync(
  join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    'drizzle',
    '0045_property_look_model.sql',
  ),
  'utf8',
)
const BACKFILL = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .find((statement) => statement.startsWith('UPDATE "property_portal_brand_profiles"'))

const OUTER_WHERE = 'WHERE po."deleted_at" IS NULL'

describe('Property look backfill and constraints (real PostgreSQL)', () => {
  let lease: TestLease
  const organizationId = `look-backfill-${randomUUID()}`
  const otherOrganizationId = `look-backfill-${randomUUID()}`
  const mixedProperty = randomUUID()
  const emptyProperty = randomUUID()
  const singleProperty = randomUUID()
  const otherProperty = randomUUID()
  const profileIds = {
    mixed: randomUUID(),
    empty: randomUUID(),
    single: randomUUID(),
    other: randomUUID(),
  }

  const q = (text: string, values: readonly unknown[] = []) =>
    lease.pool.query(text, [...values])

  async function seedProperty(orgId: string, id: string) {
    await q(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Look Property', $3, 'UTC')`,
      [id, orgId, `look-${randomUUID()}`],
    )
  }

  async function seedProfile(orgId: string, property: string, id: string) {
    await q(
      `INSERT INTO property_portal_brand_profiles
         (id, organization_id, property_id, display_name, primary_color,
          background_color, text_color, updated_by)
       VALUES ($1, $2, $3, 'Look Property', '#2563EB', '#FFFFFF', '#111827', 'seed')`,
      [id, orgId, property],
    )
  }

  async function seedPortal(
    orgId: string,
    property: string,
    primary: string,
    additional: readonly string[],
    createdAt: string,
    deleted = false,
  ) {
    const id = randomUUID()
    await q(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name,
                            slug, primary_guest_locale, additional_guest_locales,
                            created_at, deleted_at)
       VALUES ($1, $2, $3, 'property', $9, 'Portal', $4, $5, $6::jsonb, $7,
               CASE WHEN $8::boolean THEN now() ELSE NULL END)`,
      [
        id,
        orgId,
        property,
        `slug-${id}`,
        primary,
        JSON.stringify(additional),
        createdAt,
        deleted,
        property,
      ],
    )
  }

  const defaultsOf = async (profileId: string): Promise<unknown> =>
    (
      await q(
        `SELECT default_guest_locales FROM property_portal_brand_profiles WHERE id = $1`,
        [profileId],
      )
    ).rows[0]?.default_guest_locales

  const runBackfill = (orgId: string) => {
    expect(BACKFILL).toContain(OUTER_WHERE)
    return q(
      (BACKFILL as string).replace(
        OUTER_WHERE,
        `WHERE po."organization_id" = $1 AND po."deleted_at" IS NULL`,
      ),
      [orgId],
    )
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    await seedProperty(organizationId, mixedProperty)
    await seedProperty(organizationId, emptyProperty)
    await seedProperty(organizationId, singleProperty)
    await seedProperty(otherOrganizationId, otherProperty)
    await seedProfile(organizationId, mixedProperty, profileIds.mixed)
    await seedProfile(organizationId, emptyProperty, profileIds.empty)
    await seedProfile(organizationId, singleProperty, profileIds.single)
    await seedProfile(otherOrganizationId, otherProperty, profileIds.other)
    // Earliest Portal is Bulgarian with English on the side; a later English
    // Portal adds German; a deleted Italian one must not count.
    await seedPortal(organizationId, mixedProperty, 'bg', ['en'], '2026-01-01T00:00:00Z')
    await seedPortal(organizationId, mixedProperty, 'en', ['de'], '2026-02-01T00:00:00Z')
    await seedPortal(
      organizationId,
      mixedProperty,
      'it',
      [],
      '2025-12-01T00:00:00Z',
      true,
    )
    await seedPortal(organizationId, singleProperty, 'de', [], '2026-01-01T00:00:00Z')
    await seedPortal(
      otherOrganizationId,
      otherProperty,
      'fr',
      ['es'],
      '2026-01-01T00:00:00Z',
    )
  })

  afterAll(async () => {
    try {
      for (const table of ['portals', 'property_portal_brand_profiles', 'properties']) {
        await lease?.pool.query(
          `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
          [[organizationId, otherOrganizationId]],
        )
      }
    } finally {
      await lease?.release()
    }
  })

  it('starts every profile on English, look version 1, automatic background, no wordmark', async () => {
    const { rows } = await q(
      `SELECT default_guest_locales, look_version, background_mode, wordmark
       FROM property_portal_brand_profiles WHERE id = $1`,
      [profileIds.mixed],
    )
    expect(rows[0]).toEqual({
      default_guest_locales: ['en'],
      look_version: 1,
      background_mode: 'auto',
      wordmark: null,
    })
  })

  it('backfills the union of live Portal languages, the earliest Portal first', async () => {
    await runBackfill(organizationId)

    // bg leads (earliest portal), then the rest in catalogue order; the deleted
    // Italian Portal is not counted.
    await expect(defaultsOf(profileIds.mixed)).resolves.toEqual(['bg', 'en', 'de'])
    await expect(defaultsOf(profileIds.single)).resolves.toEqual(['de'])
  })

  it('keeps English for a Property with no Portal, and leaves other organisations alone', async () => {
    await expect(defaultsOf(profileIds.empty)).resolves.toEqual(['en'])
    await expect(defaultsOf(profileIds.other)).resolves.toEqual(['en'])
  })

  it('changes nothing on a second run', async () => {
    await runBackfill(organizationId)
    await expect(defaultsOf(profileIds.mixed)).resolves.toEqual(['bg', 'en', 'de'])
    await expect(defaultsOf(profileIds.single)).resolves.toEqual(['de'])
    await expect(defaultsOf(profileIds.empty)).resolves.toEqual(['en'])
  })

  it('puts the primary first and the rest in catalogue order for the other organisation', async () => {
    await runBackfill(otherOrganizationId)
    await expect(defaultsOf(profileIds.other)).resolves.toEqual(['fr', 'es'])
  })

  describe('constraints', () => {
    const set = (column: string, value: unknown) =>
      q(`UPDATE property_portal_brand_profiles SET ${column} = $2 WHERE id = $1`, [
        profileIds.single,
        value,
      ])

    it('refuses an empty, oversized, unknown or non-array language set', async () => {
      await expect(set('default_guest_locales', '[]')).rejects.toThrow(
        /default_locales_valid/,
      )
      await expect(
        set(
          'default_guest_locales',
          JSON.stringify(['en', 'es', 'it', 'fr', 'de', 'bg', 'en']),
        ),
      ).rejects.toThrow(/default_locales_valid/)
      await expect(set('default_guest_locales', '["en","xx"]')).rejects.toThrow(
        /default_locales_valid/,
      )
      await expect(set('default_guest_locales', '"en"')).rejects.toThrow(
        /default_locales_valid/,
      )
      await expect(set('default_guest_locales', '["bg","en"]')).resolves.toBeDefined()
    })

    it('refuses an unknown background mode and a look version below 1', async () => {
      await expect(set('background_mode', 'dark')).rejects.toThrow(
        /background_mode_valid/,
      )
      await expect(set('look_version', 0)).rejects.toThrow(/look_version_positive/)
      await expect(set('background_mode', 'manual')).resolves.toBeDefined()
    })

    it('refuses a blank wordmark or one past 24 characters, and accepts none', async () => {
      await expect(set('wordmark', '   ')).rejects.toThrow(/wordmark_present/)
      await expect(set('wordmark', 'x'.repeat(25))).rejects.toThrow(/too long/)
      await expect(set('wordmark', 'KODES')).resolves.toBeDefined()
      await expect(set('wordmark', null)).resolves.toBeDefined()
    })

    it('refuses a blank hero alt text and one past 160 characters', async () => {
      const setAlt = (value: string | null) =>
        q(
          `INSERT INTO property_portal_brand_contents
             (id, organization_id, property_id, locale, title, short_description,
              hero_alt_text, updated_by)
           VALUES ($1, $2, $3, 'en', 'T', 'D', $4, 'seed')
           ON CONFLICT (organization_id, property_id, locale)
           DO UPDATE SET hero_alt_text = EXCLUDED.hero_alt_text`,
          [randomUUID(), organizationId, singleProperty, value],
        )
      await expect(setAlt('  ')).rejects.toThrow(/hero_alt_present/)
      await expect(setAlt('x'.repeat(161))).rejects.toThrow(/too long/)
      await expect(setAlt('Lobby at dusk')).resolves.toBeDefined()
      await expect(setAlt(null)).resolves.toBeDefined()
      await q(`DELETE FROM property_portal_brand_contents WHERE organization_id = $1`, [
        organizationId,
      ])
    })
  })
})
