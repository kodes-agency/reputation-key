// Migration 0043 widens the guest-locale CHECKs to the six catalogue locales.
// The database is deliberately broader than what managers may offer today: the
// application registry stays authoritative and fails closed (see ADR 0061).
// This suite proves the widened constraints against real PostgreSQL; the
// snapshot-table constraints are covered next to the publication repository.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'

describe('guest locale CHECK constraints (real PostgreSQL)', () => {
  let lease: TestLease
  const organizationId = `guest-locale-checks-${randomUUID()}`
  const propertyId = randomUUID()
  const portalId = randomUUID()

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1, $2, 'Locale Property', $3, 'UTC')`,
      [propertyId, organizationId, `locale-${randomUUID()}`],
    )
    await lease.pool.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $4, 'Locale Portal', $5)`,
      [portalId, organizationId, propertyId, propertyId, `locale-portal-${randomUUID()}`],
    )
  })

  afterAll(async () => {
    try {
      for (const table of [
        'portal_localized_overrides',
        'property_portal_brand_contents',
        'portals',
        'properties',
      ]) {
        await lease?.pool.query(`DELETE FROM ${table} WHERE organization_id = $1`, [
          organizationId,
        ])
      }
    } finally {
      await lease?.release()
    }
  })

  function insertPortal(primary: string, additional: readonly string[]) {
    const id = randomUUID()
    return lease.pool.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug,
          primary_guest_locale, additional_guest_locales)
       VALUES ($1, $2, $3, 'property', $4, 'Locale Portal', $5, $6, $7::jsonb)`,
      [
        id,
        organizationId,
        propertyId,
        propertyId,
        `locale-${id}`,
        primary,
        JSON.stringify(additional),
      ],
    )
  }

  it.each(GUEST_LOCALES)('accepts %s as a Portal primary locale', async (locale) => {
    await expect(insertPortal(locale, [])).resolves.toBeDefined()
  })

  it('accepts every other catalogue locale as an additional locale', async () => {
    await expect(
      insertPortal('de', ['en', 'es', 'it', 'fr', 'bg']),
    ).resolves.toBeDefined()
  })

  it('rejects a primary locale outside the catalogue with the named constraint', async () => {
    await expect(insertPortal('pt', [])).rejects.toMatchObject({
      constraint: 'portals_primary_guest_locale_active',
    })
  })

  it('rejects an additional locale outside the catalogue with the named constraint', async () => {
    await expect(insertPortal('en', ['pt'])).rejects.toMatchObject({
      constraint: 'portals_additional_guest_locales_array',
    })
    await expect(
      lease.pool.query(
        `UPDATE portals SET additional_guest_locales = '"de"'::jsonb WHERE id = $1`,
        [portalId],
      ),
    ).rejects.toMatchObject({ constraint: 'portals_additional_guest_locales_array' })
  })

  function insertBrandContent(locale: string) {
    return lease.pool.query(
      `INSERT INTO property_portal_brand_contents
         (id, organization_id, property_id, locale, title, short_description, updated_by)
       VALUES ($1, $2, $3, $4, 'Title', 'Description', 'manager')`,
      [randomUUID(), organizationId, propertyId, locale],
    )
  }

  function insertOverride(locale: string) {
    return lease.pool.query(
      `INSERT INTO portal_localized_overrides
         (id, organization_id, property_id, portal_id, locale, title, updated_by)
       VALUES ($1, $2, $3, $4, $5, 'Title', 'manager')`,
      [randomUUID(), organizationId, propertyId, portalId, locale],
    )
  }

  it.each(GUEST_LOCALES)('accepts %s in Brand Content and overrides', async (locale) => {
    await expect(insertBrandContent(locale)).resolves.toBeDefined()
    await expect(insertOverride(locale)).resolves.toBeDefined()
  })

  it('rejects a locale outside the catalogue in Brand Content and overrides', async () => {
    await expect(insertBrandContent('pt')).rejects.toMatchObject({
      constraint: 'property_portal_brand_contents_locale_active',
    })
    await expect(insertOverride('pt')).rejects.toMatchObject({
      constraint: 'portal_localized_overrides_locale_active',
    })
  })
})
