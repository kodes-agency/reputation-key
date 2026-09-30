// Migration 0044 backfills one text row per existing link, in the language of
// its Portal. The migration is applied once, so this suite re-runs its backfill
// statement (taken from the migration file, narrowed to one organization) over
// legacy-shaped rows and proves what it writes, what it skips and that a second
// run changes nothing. It also covers the table's own constraints.

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
    '0044_portal_linktree_model.sql',
  ),
  'utf8',
)
const BACKFILL = MIGRATION.split('--> statement-breakpoint')
  .map((statement) => statement.trim())
  .find((statement) => statement.startsWith('INSERT INTO "portal_link_texts"'))

const WHERE_CLAUSE = 'WHERE length(btrim(l."label")) > 0'

describe('Linktree backfill and constraints (real PostgreSQL)', () => {
  let lease: TestLease
  const organizationId = `linktree-backfill-${randomUUID()}`
  const otherOrganizationId = `linktree-backfill-${randomUUID()}`
  const propertyId = randomUUID()
  const otherPropertyId = randomUUID()
  const portals = {
    english: randomUUID(),
    bulgarian: randomUUID(),
    other: randomUUID(),
  }
  const categoryIds = {
    english: randomUUID(),
    bulgarian: randomUUID(),
    other: randomUUID(),
  }

  const q = (text: string, values: readonly unknown[] = []) =>
    lease.pool.query(text, [...values])

  async function seedPortal(
    orgId: string,
    property: string,
    id: string,
    categoryId: string,
    primary: string,
  ) {
    await q(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name,
                            slug, primary_guest_locale)
       VALUES ($1, $2, $3, 'property', $6, 'Portal', $4, $5)`,
      [id, orgId, property, `slug-${id}`, primary, property],
    )
    await q(
      `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key)
       VALUES ($1, $2, $3, 'Links', 'a0')`,
      [categoryId, id, orgId],
    )
  }

  async function seedLink(
    orgId: string,
    property: string,
    portalId: string,
    categoryId: string,
    label: string,
    sortKey: string,
  ): Promise<string> {
    const id = randomUUID()
    await q(
      `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                                 label, url, legacy_destination_state, sort_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'unclassified', $8)`,
      [
        id,
        categoryId,
        portalId,
        orgId,
        property,
        label,
        `https://example.test/${id}`,
        sortKey,
      ],
    )
    return id
  }

  const texts = async (orgId: string) =>
    (
      await q(
        `SELECT link_id, locale, label, line, provenance, version, updated_by
         FROM portal_link_texts WHERE organization_id = $1 ORDER BY label`,
        [orgId],
      )
    ).rows

  const runBackfill = (orgId: string) => {
    expect(BACKFILL).toContain(WHERE_CLAUSE)
    return q(
      (BACKFILL as string).replace(
        WHERE_CLAUSE,
        `WHERE l."organization_id" = $1 AND length(btrim(l."label")) > 0`,
      ),
      [orgId],
    )
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    for (const [orgId, property, slug] of [
      [organizationId, propertyId, 'a'],
      [otherOrganizationId, otherPropertyId, 'b'],
    ] as const) {
      await q(
        `INSERT INTO properties (id, organization_id, name, slug, timezone)
         VALUES ($1, $2, 'Backfill Property', $3, 'UTC')`,
        [property, orgId, `backfill-${slug}-${randomUUID()}`],
      )
    }
    await seedPortal(
      organizationId,
      propertyId,
      portals.english,
      categoryIds.english,
      'en',
    )
    await seedPortal(
      organizationId,
      propertyId,
      portals.bulgarian,
      categoryIds.bulgarian,
      'bg',
    )
    await seedPortal(
      otherOrganizationId,
      otherPropertyId,
      portals.other,
      categoryIds.other,
      'de',
    )
  })

  afterAll(async () => {
    try {
      for (const table of [
        'portal_localized_overrides',
        'portal_link_texts',
        'portal_links',
        'portal_link_categories',
        'portals',
        'properties',
      ]) {
        await lease?.pool.query(
          `DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`,
          [[organizationId, otherOrganizationId]],
        )
      }
    } finally {
      await lease?.release()
    }
  })

  it('writes one text per link in its Portal primary language, trimmed, and nothing else', async () => {
    const menu = await seedLink(
      organizationId,
      propertyId,
      portals.english,
      categoryIds.english,
      '  Menu  ',
      'a0',
    )
    const spa = await seedLink(
      organizationId,
      propertyId,
      portals.bulgarian,
      categoryIds.bulgarian,
      'Спа',
      'a0',
    )
    await seedLink(
      organizationId,
      propertyId,
      portals.english,
      categoryIds.english,
      '   ',
      'a1',
    )
    const foreign = await seedLink(
      otherOrganizationId,
      otherPropertyId,
      portals.other,
      categoryIds.other,
      'Speisekarte',
      'a0',
    )

    await runBackfill(organizationId)

    expect(await texts(organizationId)).toEqual([
      {
        link_id: menu,
        locale: 'en',
        label: 'Menu',
        line: null,
        provenance: null,
        version: 1,
        updated_by: 'system:migration-0044',
      },
      {
        link_id: spa,
        locale: 'bg',
        label: 'Спа',
        line: null,
        provenance: null,
        version: 1,
        updated_by: 'system:migration-0044',
      },
    ])
    // The blank-label link has no text row, and the other organization was not touched.
    expect(await texts(otherOrganizationId)).toEqual([])
    await runBackfill(otherOrganizationId)
    expect(
      (await texts(otherOrganizationId)).map((row) => [row.link_id, row.locale]),
    ).toEqual([[foreign, 'de']])
  })

  it('is idempotent and never overwrites a text a manager already wrote', async () => {
    const before = await texts(organizationId)
    await q(
      `UPDATE portal_link_texts SET label = 'Menu (edited)', version = 2
       WHERE organization_id = $1 AND locale = 'en'`,
      [organizationId],
    )

    await runBackfill(organizationId)

    const after = await texts(organizationId)
    expect(after).toHaveLength(before.length)
    expect(after.find((row) => row.locale === 'en')).toMatchObject({
      label: 'Menu (edited)',
      version: 2,
    })
  })

  describe('constraints', () => {
    const insertText = async (overrides: Partial<Record<string, unknown>> = {}) => {
      const linkId = await seedLink(
        organizationId,
        propertyId,
        portals.english,
        categoryIds.english,
        'Constraint link',
        `z${Math.random()}`,
      )
      const row = {
        link_id: linkId,
        locale: 'en',
        label: 'Label',
        line: null,
        provenance: null,
        version: 1,
        ...overrides,
      }
      return q(
        `INSERT INTO portal_link_texts (organization_id, property_id, portal_id, link_id,
                                        locale, label, line, provenance, version, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'user-1')`,
        [
          organizationId,
          propertyId,
          portals.english,
          row.link_id,
          row.locale,
          row.label,
          row.line,
          row.provenance,
          row.version,
        ],
      )
    }

    it('accepts every locale of the catalogue and an AI provenance', async () => {
      await expect(
        insertText({ locale: 'de', provenance: 'ai_draft' }),
      ).resolves.toBeDefined()
    })

    it.each([
      ['an unknown locale', { locale: 'pt' }, /portal_link_texts_locale_active/],
      ['a blank label', { label: '   ' }, /portal_link_texts_label_present/],
      ['a blank line', { line: '  ' }, /portal_link_texts_line_present/],
      [
        'an unknown provenance',
        { provenance: 'guess' },
        /portal_link_texts_provenance_valid/,
      ],
      ['a zero version', { version: 0 }, /portal_link_texts_version_positive/],
    ])('refuses %s', async (_name, overrides, constraint) => {
      await expect(insertText(overrides)).rejects.toThrow(constraint)
    })

    it('refuses two texts for one link and language', async () => {
      const linkId = await seedLink(
        organizationId,
        propertyId,
        portals.english,
        categoryIds.english,
        'Duplicate link',
        'y0',
      )
      const insert = () =>
        q(
          `INSERT INTO portal_link_texts (organization_id, property_id, portal_id, link_id,
                                          locale, label, updated_by)
           VALUES ($1, $2, $3, $4, 'en', 'Label', 'user-1')`,
          [organizationId, propertyId, portals.english, linkId],
        )
      await insert()
      await expect(insert()).rejects.toThrow(/portal_link_texts_link_locale_unique/)
    })

    it('refuses a text whose link belongs to another organization or Portal', async () => {
      const foreignLink = await seedLink(
        otherOrganizationId,
        otherPropertyId,
        portals.other,
        categoryIds.other,
        'Foreign',
        'x0',
      )
      await expect(
        q(
          `INSERT INTO portal_link_texts (organization_id, property_id, portal_id, link_id,
                                          locale, label, updated_by)
           VALUES ($1, $2, $3, $4, 'en', 'Label', 'user-1')`,
          [organizationId, propertyId, portals.english, foreignLink],
        ),
      ).rejects.toThrow(/portal_link_texts_link_tenant_fk/)
    })

    it('closes portal_links.icon_key to the catalogue', async () => {
      const linkId = await seedLink(
        organizationId,
        propertyId,
        portals.english,
        categoryIds.english,
        'Icon link',
        'w0',
      )
      await expect(
        q(`UPDATE portal_links SET icon_key = 'map-pin' WHERE id = $1`, [linkId]),
      ).resolves.toBeDefined()
      await expect(
        q(`UPDATE portal_links SET icon_key = 'guide' WHERE id = $1`, [linkId]),
      ).rejects.toThrow(/portal_links_icon_key_valid/)
    })

    it('counts a Linktree title as an override value', async () => {
      await expect(
        q(
          `INSERT INTO portal_localized_overrides
             (id, organization_id, property_id, portal_id, locale, linktree_title, updated_by)
           VALUES ($1, $2, $3, $4, 'en', 'Around town', 'user-1')`,
          [randomUUID(), organizationId, propertyId, portals.english],
        ),
      ).resolves.toBeDefined()
      await expect(
        q(
          `INSERT INTO portal_localized_overrides
             (id, organization_id, property_id, portal_id, locale, updated_by)
           VALUES ($1, $2, $3, $4, 'bg', 'user-1')`,
          [randomUUID(), organizationId, propertyId, portals.english],
        ),
      ).rejects.toThrow(/portal_localized_overrides_has_value/)
    })
  })
})
