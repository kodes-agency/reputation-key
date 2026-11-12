// Test seed — the Properties, Portals, Brand Profiles and stored images the
// media, look and experience integration suites build on, written as rows so a
// suite proves what a use case does without depending on another writer. Ids are
// random, so suites sharing one database never meet each other's rows. Not
// imported by production code.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import {
  portalId,
  portalMediaAssetId,
  propertyId,
  userId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import { currentGuestLanguagePack } from '#/shared/domain/guest-locale'
import { portalMediaObjectKey } from '#/shared/domain/portal-media'
import type { PortalMediaAsset } from '../../domain/portal-media-asset'
import { createPortalMediaAssetRepository } from '../repositories/portal-media-asset.repository'

/** The tables a media, look and experience suite empties between tests, children first. */
export const MEDIA_EXPERIENCE_TABLES = [
  'portal_pending_content_changes',
  'portal_page_edits',
  'portal_publication_activations',
  'portal_publication_snapshots',
  'portal_look_overrides',
  'portal_localized_overrides',
  'property_portal_brand_contents',
  'property_portal_brand_profiles',
  'portal_link_categories',
  'portal_media_assets',
  'outbox_events',
  'portals',
  'properties',
]

export const SEED_ACTOR = 'seed-admin-media-experience'
export const SEED_AT = new Date('2026-10-01T10:00:00.000Z')

export async function seedMediaProperty(
  pool: Pool,
  organization: OrganizationId,
  slug = `prop-${randomUUID().slice(0, 8)}`,
): Promise<PropertyId> {
  const id = propertyId(randomUUID())
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'UTC', $4, $4)`,
    [id, organization, slug, SEED_AT],
  )
  return id
}

export type SeededPortalOptions = Readonly<{
  slug?: string
  name?: string
  state?: 'draft' | 'published' | 'archived'
  deletedAt?: Date
  primaryLocale?: string
  additionalLocales?: readonly string[]
  personal?: Readonly<{ publicName: string }>
  published?: boolean
}>

export async function seedMediaPortal(
  pool: Pool,
  organization: OrganizationId,
  property: PropertyId,
  options: SeededPortalOptions = {},
): Promise<PortalId> {
  const id = portalId(randomUUID())
  const slug = options.slug ?? `portal-${id.slice(0, 8)}`
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name,
                          slug, theme, publication_state, primary_guest_locale,
                          additional_guest_locales, kind, public_name, created_by,
                          created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, 'property', $4, $5, $6, '{"primaryColor":"#6366F1"}'::jsonb, $7,
             $8, $9::jsonb, $10, $11, $12, $13, $13, $14)`,
    [
      id,
      organization,
      property,
      property,
      options.name ?? slug,
      slug,
      options.state ?? 'draft',
      options.primaryLocale ?? 'en',
      JSON.stringify(options.additionalLocales ?? []),
      options.personal ? 'personal' : 'place',
      options.personal?.publicName ?? null,
      SEED_ACTOR,
      SEED_AT,
      options.deletedAt ?? null,
    ],
  )
  if (options.published) await seedFirstSnapshot(pool, organization, property, id)
  return id
}

/** A first publication, so the Portal counts as live for the edits recorded against it. */
export async function seedFirstSnapshot(
  pool: Pool,
  organization: OrganizationId,
  property: PropertyId,
  portal: PortalId,
): Promise<void> {
  await pool.query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', $8, 3,
               'https://example.test/review', $6, 0, 1, $7, $6)`,
    [
      randomUUID(),
      organization,
      property,
      portal,
      'a'.repeat(64),
      SEED_AT,
      SEED_ACTOR,
      currentGuestLanguagePack('en'),
    ],
  )
}

export type SeededBrandProfile = Readonly<{
  displayName?: string
  heroAssetId?: string | null
  heroFocalX?: number | null
  heroFocalY?: number | null
  logoAssetId?: string | null
  wordmark?: string | null
  lookVersion?: number
  version?: number
  updatedBy?: string
}>

export async function seedBrandProfile(
  pool: Pool,
  organization: OrganizationId,
  property: PropertyId,
  profile: SeededBrandProfile = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO property_portal_brand_profiles
       (id, organization_id, property_id, display_name, primary_color, background_color,
        text_color, background_mode, wordmark, hero_asset_id, hero_focal_x, hero_focal_y,
        logo_asset_id, version, look_version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, '#B8860B', '#1A1A1A', '#F5F1E8', 'auto', $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $13)`,
    [
      randomUUID(),
      organization,
      property,
      profile.displayName ?? 'Avela Resort',
      profile.wordmark ?? null,
      profile.heroAssetId ?? null,
      profile.heroFocalX ?? null,
      profile.heroFocalY ?? null,
      profile.logoAssetId ?? null,
      profile.version ?? 5,
      profile.lookVersion ?? 4,
      profile.updatedBy ?? SEED_ACTOR,
      SEED_AT,
    ],
  )
}

export async function seedBrandContent(
  pool: Pool,
  organization: OrganizationId,
  property: PropertyId,
  content: Readonly<{
    locale: string
    title: string
    shortDescription: string
    heroAltText?: string
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO property_portal_brand_contents
       (id, organization_id, property_id, locale, title, short_description, hero_alt_text,
        version, updated_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9, $9)`,
    [
      randomUUID(),
      organization,
      property,
      content.locale,
      content.title,
      content.shortDescription,
      content.heroAltText ?? null,
      SEED_ACTOR,
      SEED_AT,
    ],
  )
}

/** Stores one image row through the real repository, so the database's own checks judge it. */
export async function seedMediaAsset(
  organization: OrganizationId,
  property: PropertyId,
  overrides: Partial<PortalMediaAsset> = {},
): Promise<PortalMediaAsset> {
  const id = overrides.id ?? portalMediaAssetId(randomUUID())
  const asset: PortalMediaAsset = {
    id,
    organizationId: organization,
    propertyId: property,
    purpose: 'hero',
    status: 'active',
    objectKey: portalMediaObjectKey(id),
    contentType: 'image/webp',
    width: 2400,
    height: 1600,
    byteSize: 180_000,
    contentSha256: 'a'.repeat(64),
    sourceFormat: 'jpeg',
    sourceBytes: 2_500_000,
    rightsConfirmedAt: SEED_AT,
    createdBy: userId(SEED_ACTOR),
    createdAt: SEED_AT,
    takenDownAt: null,
    objectDeletedAt: null,
    ...overrides,
  }
  await createPortalMediaAssetRepository(getDb()).insert(asset)
  return asset
}
