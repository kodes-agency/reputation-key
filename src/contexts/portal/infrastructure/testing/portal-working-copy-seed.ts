// Test-only seeding of a Portal working copy through raw SQL, so a test can
// prove what the working-copy reader returns without depending on the writers.
// Production code writes these rows through the Portal command store.

import type { Pool } from 'pg'

const SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')

export type SeededBrandContent = Readonly<{
  locale: string
  title: string
  shortDescription: string
}>

export type SeededOverride = Readonly<{
  locale: string
  title: string | null
  shortDescription: string | null
  heroImageUrl: string | null
}>

export type SeededLink = Readonly<{
  id: string
  label: string
  sortKey: string
  /** `approved` and `pending` link to a Property-owned destination; `legacy` keeps a raw URL. */
  destination: Readonly<{ state: 'approved' | 'pending'; uri: string }> | 'legacy'
}>

export type PortalWorkingCopySeed = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  slug: string
  primaryGuestLocale: string
  additionalGuestLocales: readonly string[]
  brand: Readonly<{ displayName: string; defaultHeroImageUrl: string | null }> | null
  contents: readonly SeededBrandContent[]
  overrides: readonly SeededOverride[]
  categoryId: string
  links: readonly SeededLink[]
}>

const idTail = (value: string) => value.slice(-12)

async function seedBrand(pool: Pool, seed: PortalWorkingCopySeed): Promise<void> {
  if (seed.brand) {
    await pool.query(
      `INSERT INTO property_portal_brand_profiles
         (id, organization_id, property_id, display_name, logo_url,
          default_hero_image_url, primary_color, background_color, text_color,
          version, updated_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, '#1D4ED8', '#FFFFFF', '#111827', 3,
               'seed-manager', $6, $6)`,
      [
        `b1000000-0000-4000-8000-${idTail(seed.propertyId)}`,
        seed.organizationId,
        seed.propertyId,
        seed.brand.displayName,
        seed.brand.defaultHeroImageUrl,
        SEEDED_AT,
      ],
    )
  }
  for (const content of seed.contents) {
    await pool.query(
      `INSERT INTO property_portal_brand_contents
         (id, organization_id, property_id, locale, title, short_description,
          version, updated_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, 'seed-manager', $6, $6)`,
      [
        seed.organizationId,
        seed.propertyId,
        content.locale,
        content.title,
        content.shortDescription,
        SEEDED_AT,
      ],
    )
  }
  for (const override of seed.overrides) {
    await pool.query(
      `INSERT INTO portal_localized_overrides
         (id, organization_id, property_id, portal_id, locale, title,
          short_description, hero_image_url, version, updated_by, created_at,
          updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 1, 'seed-manager',
               $8, $8)`,
      [
        seed.organizationId,
        seed.propertyId,
        seed.portalId,
        override.locale,
        override.title,
        override.shortDescription,
        override.heroImageUrl,
        SEEDED_AT,
      ],
    )
  }
}

async function seedLink(
  pool: Pool,
  seed: PortalWorkingCopySeed,
  link: SeededLink,
): Promise<void> {
  if (link.destination === 'legacy') {
    await pool.query(
      `INSERT INTO portal_links
         (id, category_id, portal_id, organization_id, property_id, label,
          destination_id, url, legacy_destination_state, sort_key, created_at,
          updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, 'https://legacy.example/menu',
               'unclassified', $7, $8, $8)`,
      [
        link.id,
        seed.categoryId,
        seed.portalId,
        seed.organizationId,
        seed.propertyId,
        link.label,
        link.sortKey,
        SEEDED_AT,
      ],
    )
    return
  }
  const destinationId = `d1000000-0000-4000-8000-${idTail(link.id)}`
  const approved = link.destination.state === 'approved'
  await pool.query(
    `INSERT INTO portal_approved_destinations
       (id, organization_id, property_id, normalized_uri, hostname, source_type,
        approval_state, validation_version, requested_by, approved_by,
        approved_at, last_validated_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'example.com', 'custom', $5, 'seed-v1',
             'seed-manager', $6, $7, $8, $8, $8)`,
    [
      destinationId,
      seed.organizationId,
      seed.propertyId,
      link.destination.uri,
      link.destination.state,
      approved ? 'seed-manager' : null,
      approved ? SEEDED_AT : null,
      SEEDED_AT,
    ],
  )
  await pool.query(
    `INSERT INTO portal_links
       (id, category_id, portal_id, organization_id, property_id, label,
        destination_id, url, legacy_destination_state, sort_key, created_at,
        updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'migrated', $8, $9, $9)`,
    [
      link.id,
      seed.categoryId,
      seed.portalId,
      seed.organizationId,
      seed.propertyId,
      link.label,
      destinationId,
      link.sortKey,
      SEEDED_AT,
    ],
  )
}

/** Inserts the Property, the Portal and every working-copy row the seed names. */
export async function seedPortalWorkingCopy(
  pool: Pool,
  seed: PortalWorkingCopySeed,
): Promise<void> {
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Working Copy Property', $3, 'UTC', $4, $4)`,
    [seed.propertyId, seed.organizationId, `wc-${idTail(seed.propertyId)}`, SEEDED_AT],
  )
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        description, theme, private_feedback_threshold, publication_state,
        primary_guest_locale, additional_guest_locales, created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Lobby portal', $4, 'Scan for the lobby',
             '{"primaryColor":"#123456"}'::jsonb, 4, 'draft', $5, $6::jsonb, $7, $7)`,
    [
      seed.portalId,
      seed.organizationId,
      seed.propertyId,
      seed.slug,
      seed.primaryGuestLocale,
      JSON.stringify(seed.additionalGuestLocales),
      SEEDED_AT,
    ],
  )
  await seedBrand(pool, seed)
  await pool.query(
    `INSERT INTO portal_link_categories
       (id, portal_id, organization_id, title, sort_key, created_at, updated_at)
     VALUES ($1, $2, $3, 'Around the hotel', 'a0', $4, $4)`,
    [seed.categoryId, seed.portalId, seed.organizationId, SEEDED_AT],
  )
  for (const link of seed.links) {
    await seedLink(pool, seed, link)
  }
}
