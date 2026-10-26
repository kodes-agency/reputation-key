// Portal context — Drizzle schema for portal_look_overrides (per-portal looks).
//
// One row per Portal, made by the first save of one of its own look groups. A
// Portal with no row follows the whole Property look, which is every Portal
// before this table existed. Each group (photo, colours, name and logo) has its
// own mode: 'inherit' follows the Property's Brand Profile, 'own' uses the values
// on this row, and the photo has a third mode, 'none', for a page with no photo.
// A group that follows the Property holds no values, so no image it no longer
// shows is kept referenced (and counted against the Property's image cap). The
// own photo's descriptions live beside it, so a description always travels with
// its photo. `look_version` is the Portal's own effective look version and only
// ever moves up; writers never delete a row, only an Organization purge does.

import { sql } from 'drizzle-orm'
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import type { GuestLocale } from '../../domain/guest-locale'
import { createdAtColumn, updatedAtColumn } from '../columns'
import { portalMediaAssets } from './portal-assets.schema'
import { portals } from './portal.schema'

// The closed vocabularies of the modes. The Portal domain's own lists are held
// to these by its unit test, so a mode added there asks for a widening migration
// here instead of a refused write.
export const PORTAL_LOOK_PHOTO_MODE_SQL_LIST = "'inherit', 'own', 'none'"
export const PORTAL_LOOK_GROUP_MODE_SQL_LIST = "'inherit', 'own'"
export const PORTAL_LOOK_BACKGROUND_MODE_SQL_LIST = "'auto', 'manual'"

const HEX_COLOUR = "'^#[0-9A-Fa-f]{6}$'"

export const portalLookOverrides = pgTable(
  'portal_look_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    portalId: uuid('portal_id').notNull(),
    // Photo: 'inherit' (the Property's photo), 'own' (the asset below) or 'none'.
    photoMode: varchar('photo_mode', { length: 8 }).notNull().default('inherit'),
    heroAssetId: uuid('hero_asset_id'),
    // Where the own photo is anchored when a page crops it: 0 to 1 across and
    // down. Present exactly when the photo is the Portal's own.
    heroFocalX: doublePrecision('hero_focal_x'),
    heroFocalY: doublePrecision('hero_focal_y'),
    // The own photo's description per guest language: { "<locale>": "<text>" },
    // at most 160 characters each. Empty unless the photo is the Portal's own.
    // The keys and values are the domain's to check (a reader drops an unknown
    // language and a blank text), so the table holds only that it is an object.
    heroAltTexts: jsonb('hero_alt_texts')
      .$type<Partial<Record<GuestLocale, string>>>()
      .notNull()
      .default({}),
    // Colours: the accent and the background together, as contrast is judged on
    // the pair. `backgroundColor` is kept in automatic mode too, as the Brand
    // Profile keeps the last custom one.
    coloursMode: varchar('colours_mode', { length: 8 }).notNull().default('inherit'),
    primaryColor: varchar('primary_color', { length: 7 }),
    backgroundMode: varchar('background_mode', { length: 10 }),
    backgroundColor: varchar('background_color', { length: 7 }),
    // Name and logo: an own wordmark and logo; both null shows the public
    // display name, as a Property with neither does.
    identityMode: varchar('identity_mode', { length: 8 }).notNull().default('inherit'),
    wordmark: varchar('wordmark', { length: 24 }),
    logoAssetId: uuid('logo_asset_id'),
    // The Portal's effective look version: what its working copy publishes as
    // `lookVersion`. Moves with every change of what this Portal shows of the look.
    lookVersion: integer('look_version').notNull(),
    updatedBy: varchar('updated_by', { length: 255 }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('portal_look_overrides_portal_unique').on(t.organizationId, t.portalId),
    // The Property look writers find a Property's followers through it, and the
    // overview reads every Portal's sources.
    index('portal_look_overrides_property_idx').on(t.organizationId, t.propertyId),
    foreignKey({
      name: 'portal_look_overrides_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'portal_look_overrides_hero_asset_fk',
      columns: [t.organizationId, t.propertyId, t.heroAssetId],
      foreignColumns: [
        portalMediaAssets.organizationId,
        portalMediaAssets.propertyId,
        portalMediaAssets.id,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'portal_look_overrides_logo_asset_fk',
      columns: [t.organizationId, t.propertyId, t.logoAssetId],
      foreignColumns: [
        portalMediaAssets.organizationId,
        portalMediaAssets.propertyId,
        portalMediaAssets.id,
      ],
    }).onDelete('restrict'),
    check(
      'portal_look_overrides_photo_mode_valid',
      sql`${t.photoMode} IN (${sql.raw(PORTAL_LOOK_PHOTO_MODE_SQL_LIST)})`,
    ),
    check(
      'portal_look_overrides_photo_valid',
      sql`(${t.photoMode} = 'own' AND ${t.heroAssetId} IS NOT NULL AND ${t.heroFocalX} IS NOT NULL AND ${t.heroFocalX} BETWEEN 0 AND 1 AND ${t.heroFocalY} IS NOT NULL AND ${t.heroFocalY} BETWEEN 0 AND 1) OR (${t.photoMode} <> 'own' AND ${t.heroAssetId} IS NULL AND ${t.heroFocalX} IS NULL AND ${t.heroFocalY} IS NULL AND ${t.heroAltTexts} = '{}'::jsonb)`,
    ),
    check(
      'portal_look_overrides_alt_object',
      sql`jsonb_typeof(${t.heroAltTexts}) = 'object'`,
    ),
    check(
      'portal_look_overrides_colours_mode_valid',
      sql`${t.coloursMode} IN (${sql.raw(PORTAL_LOOK_GROUP_MODE_SQL_LIST)})`,
    ),
    check(
      'portal_look_overrides_colours_valid',
      sql`(${t.coloursMode} = 'own' AND ${t.primaryColor} IS NOT NULL AND ${t.backgroundMode} IS NOT NULL AND ${t.backgroundColor} IS NOT NULL) OR (${t.coloursMode} = 'inherit' AND ${t.primaryColor} IS NULL AND ${t.backgroundMode} IS NULL AND ${t.backgroundColor} IS NULL)`,
    ),
    check(
      'portal_look_overrides_palette_valid',
      sql`(${t.primaryColor} IS NULL OR ${t.primaryColor} ~ ${sql.raw(HEX_COLOUR)}) AND (${t.backgroundColor} IS NULL OR ${t.backgroundColor} ~ ${sql.raw(HEX_COLOUR)})`,
    ),
    check(
      'portal_look_overrides_background_mode_valid',
      sql`${t.backgroundMode} IS NULL OR ${t.backgroundMode} IN (${sql.raw(PORTAL_LOOK_BACKGROUND_MODE_SQL_LIST)})`,
    ),
    check(
      'portal_look_overrides_identity_mode_valid',
      sql`${t.identityMode} IN (${sql.raw(PORTAL_LOOK_GROUP_MODE_SQL_LIST)})`,
    ),
    check(
      'portal_look_overrides_identity_valid',
      sql`${t.identityMode} = 'own' OR (${t.wordmark} IS NULL AND ${t.logoAssetId} IS NULL)`,
    ),
    check(
      'portal_look_overrides_wordmark_present',
      sql`${t.wordmark} IS NULL OR length(btrim(${t.wordmark})) > 0`,
    ),
    check('portal_look_overrides_look_version_positive', sql`${t.lookVersion} >= 1`),
  ],
)
