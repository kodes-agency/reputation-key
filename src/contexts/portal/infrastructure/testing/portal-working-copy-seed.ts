// Test-only seeding of a Portal working copy through raw SQL, so a test can
// prove what the working-copy reader returns without depending on the writers.
// Production code writes these rows through the Portal command store.

import type { Pool } from 'pg'

const SEEDED_AT = new Date('2026-08-26T10:00:00.000Z')

export type SeededBrandContent = Readonly<{
  locale: string
  title: string
  shortDescription: string
  heroAltText?: string | null
}>

/** A stored image of the Property; `taken_down` ones must never reach a publication. */
export type SeededMediaAsset = Readonly<{
  id: string
  purpose: 'hero' | 'logo' | 'link_image'
  status?: 'active' | 'taken_down'
  width: number
  height: number
}>

export type SeededBrand = Readonly<{
  displayName: string
  defaultHeroImageUrl: string | null
  wordmark?: string | null
  backgroundMode?: 'auto' | 'manual'
  lookVersion?: number
  heroAsset?: Readonly<{ id: string; focalX: number; focalY: number }>
  logoAssetId?: string
}>

export type SeededLinkText = Readonly<{
  locale: string
  label: string
  line?: string | null
  provenance?: 'ai_draft' | null
}>

export type SeededOverride = Readonly<{
  locale: string
  title: string | null
  shortDescription: string | null
  heroImageUrl: string | null
  linktreeTitle?: string | null
}>

export type SeededLink = Readonly<{
  id: string
  label: string
  sortKey: string
  iconKey?: string | null
  imageAssetId?: string | null
  /** Per-language wording; a link with none reads its own label in the primary language. */
  texts?: readonly SeededLinkText[]
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
  /** The Property's IANA time zone. */
  timeZone?: string
  linktreeEnabled?: boolean
  brand: SeededBrand | null
  mediaAssets?: readonly SeededMediaAsset[]
  contents: readonly SeededBrandContent[]
  overrides: readonly SeededOverride[]
  categoryId: string
  links: readonly SeededLink[]
}>

const idTail = (value: string) => value.slice(-12)

async function seedMediaAssets(pool: Pool, seed: PortalWorkingCopySeed): Promise<void> {
  for (const asset of seed.mediaAssets ?? []) {
    const takenDown = asset.status === 'taken_down'
    await pool.query(
      `INSERT INTO portal_media_assets
         (id, organization_id, property_id, purpose, status, object_key,
          content_type, width, height, byte_size, content_sha256,
          source_format, source_bytes, rights_confirmed_at, created_by,
          created_at, taken_down_at)
       VALUES ($1::uuid, $2, $3, $4, $5, 'portal-media/' || $1::text || '.webp',
               'image/webp', $6, $7, 1000, repeat('a', 64), 'jpeg', 2000, $8,
               'seed-manager', $8, $9)`,
      [
        asset.id,
        seed.organizationId,
        seed.propertyId,
        asset.purpose,
        takenDown ? 'taken_down' : 'active',
        asset.width,
        asset.height,
        SEEDED_AT,
        takenDown ? SEEDED_AT : null,
      ],
    )
  }
}

async function seedBrand(pool: Pool, seed: PortalWorkingCopySeed): Promise<void> {
  await seedMediaAssets(pool, seed)
  if (seed.brand) {
    const { brand } = seed
    await pool.query(
      `INSERT INTO property_portal_brand_profiles
         (id, organization_id, property_id, display_name, logo_url,
          default_hero_image_url, logo_asset_id, hero_asset_id, hero_focal_x,
          hero_focal_y, wordmark, background_mode, look_version, primary_color,
          background_color, text_color, version, updated_by, created_at,
          updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, $12,
               '#1D4ED8', '#101820', '#111827', 3, 'seed-manager', $13, $13)`,
      [
        `b1000000-0000-4000-8000-${idTail(seed.propertyId)}`,
        seed.organizationId,
        seed.propertyId,
        brand.displayName,
        brand.defaultHeroImageUrl,
        brand.logoAssetId ?? null,
        brand.heroAsset?.id ?? null,
        brand.heroAsset?.focalX ?? null,
        brand.heroAsset?.focalY ?? null,
        brand.wordmark ?? null,
        brand.backgroundMode ?? 'auto',
        brand.lookVersion ?? 1,
        SEEDED_AT,
      ],
    )
  }
  for (const content of seed.contents) {
    await pool.query(
      `INSERT INTO property_portal_brand_contents
         (id, organization_id, property_id, locale, title, short_description,
          hero_alt_text, version, updated_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 1, 'seed-manager', $7, $7)`,
      [
        seed.organizationId,
        seed.propertyId,
        content.locale,
        content.title,
        content.shortDescription,
        content.heroAltText ?? null,
        SEEDED_AT,
      ],
    )
  }
  for (const override of seed.overrides) {
    await pool.query(
      `INSERT INTO portal_localized_overrides
         (id, organization_id, property_id, portal_id, locale, title,
          short_description, hero_image_url, linktree_title, version, updated_by,
          created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 1, 'seed-manager',
               $9, $9)`,
      [
        seed.organizationId,
        seed.propertyId,
        seed.portalId,
        override.locale,
        override.title,
        override.shortDescription,
        override.heroImageUrl,
        override.linktreeTitle ?? null,
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
          destination_id, url, legacy_destination_state, sort_key, icon_key,
          image_asset_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, 'https://legacy.example/menu',
               'unclassified', $7, $8, $9, $10, $10)`,
      [
        link.id,
        seed.categoryId,
        seed.portalId,
        seed.organizationId,
        seed.propertyId,
        link.label,
        link.sortKey,
        link.iconKey ?? null,
        link.imageAssetId ?? null,
        SEEDED_AT,
      ],
    )
    await seedLinkTexts(pool, seed, link)
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
        destination_id, url, legacy_destination_state, sort_key, icon_key,
        image_asset_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'migrated', $8, $9, $10, $11, $11)`,
    [
      link.id,
      seed.categoryId,
      seed.portalId,
      seed.organizationId,
      seed.propertyId,
      link.label,
      destinationId,
      link.sortKey,
      link.iconKey ?? null,
      link.imageAssetId ?? null,
      SEEDED_AT,
    ],
  )
  await seedLinkTexts(pool, seed, link)
}

async function seedLinkTexts(
  pool: Pool,
  seed: PortalWorkingCopySeed,
  link: SeededLink,
): Promise<void> {
  for (const text of link.texts ?? []) {
    await pool.query(
      `INSERT INTO portal_link_texts
         (id, organization_id, property_id, portal_id, link_id, locale, label,
          line, provenance, version, updated_by, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 1,
               'seed-manager', $9, $9)`,
      [
        seed.organizationId,
        seed.propertyId,
        seed.portalId,
        link.id,
        text.locale,
        text.label,
        text.line ?? null,
        text.provenance ?? null,
        SEEDED_AT,
      ],
    )
  }
}

/** Inserts the Property, the Portal and every working-copy row the seed names. */
export async function seedPortalWorkingCopy(
  pool: Pool,
  seed: PortalWorkingCopySeed,
): Promise<void> {
  await pool.query(
    `INSERT INTO properties
       (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Working Copy Property', $3, $5, $4, $4)`,
    [
      seed.propertyId,
      seed.organizationId,
      `wc-${idTail(seed.propertyId)}`,
      SEEDED_AT,
      seed.timeZone ?? 'UTC',
    ],
  )
  await pool.query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        description, theme, private_feedback_threshold, publication_state,
        primary_guest_locale, additional_guest_locales, linktree_enabled,
        created_at, updated_at)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Lobby portal', $4, 'Scan for the lobby',
             '{"primaryColor":"#123456"}'::jsonb, 4, 'draft', $5, $6::jsonb, $8, $7, $7)`,
    [
      seed.portalId,
      seed.organizationId,
      seed.propertyId,
      seed.slug,
      seed.primaryGuestLocale,
      JSON.stringify(seed.additionalGuestLocales),
      SEEDED_AT,
      seed.linktreeEnabled ?? true,
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
