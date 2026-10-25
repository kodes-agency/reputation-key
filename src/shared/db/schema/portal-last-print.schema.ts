// Portal context — Drizzle schema for portal_last_prints (final print kit, slice 12).
//
// One row per Portal: the choices of the last final print and the photo it used,
// replaced by every print. Share reads it to say "Last printed Oct 12 · …", to set
// the same choices again, and to say the photo has changed since. A row holds
// choices and a day only: never the address, a print code or a file.

import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { portals } from './portal.schema'

// The closed vocabularies of the final kit. `portal-last-print.schema.test.ts`
// holds each list to the domain's own, so a piece or a look added there asks for
// a widening migration here instead of a refused write.
export const PORTAL_LAST_PRINT_PIECE_SQL_LIST = "'counter', 'tent', 'small'"
export const PORTAL_LAST_PRINT_ORIENTATION_SQL_LIST = "'upright', 'wide'"
export const PORTAL_LAST_PRINT_LOOK_SQL_LIST = "'paper', 'immersive'"
export const PORTAL_LAST_PRINT_PAPER_SQL_LIST = "'letter', 'a4'"
export const PORTAL_LAST_PRINT_PRINTER_SQL_LIST = "'my_printer', 'print_shop'"
export const PORTAL_LAST_PRINT_CTA_SQL_LIST = "'rate', 'tell'"

/** The most pieces a print may ask for: the download's own bound. */
export const PORTAL_LAST_PRINT_MAX_QUANTITY = 1000

/** The most languages a print carries: the download's own bound. */
export const PORTAL_LAST_PRINT_MAX_LANGUAGES = 2

export const portalLastPrints = pgTable(
  'portal_last_prints',
  {
    // One row per Portal: the next print replaces it.
    portalId: uuid('portal_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    piece: varchar('piece', { length: 16 }).notNull(),
    orientation: varchar('orientation', { length: 16 }).notNull(),
    look: varchar('look', { length: 16 }).notNull(),
    paper: varchar('paper', { length: 16 }).notNull(),
    printer: varchar('printer', { length: 16 }).notNull(),
    quantity: integer('quantity').notNull(),
    fillSpares: boolean('fill_spares').notNull(),
    // Null: every cell of the sheet.
    perSheet: integer('per_sheet'),
    cropMarks: boolean('crop_marks').notNull(),
    backPage: boolean('back_page').notNull(),
    // The languages in print order, one or two. Their values are read through
    // the guest locale schema, not constrained here: a catalogue that changes
    // must not make an old row unwritable.
    languages: jsonb('languages').notNull(),
    callToAction: varchar('call_to_action', { length: 16 }).notNull(),
    // The photo an Immersive print used, by image and framing, with no foreign
    // key: a photo that is taken down must not hold a remembered print. All
    // three are null for a print with no photo.
    photoAssetId: uuid('photo_asset_id'),
    photoFocalX: doublePrecision('photo_focal_x'),
    photoFocalY: doublePrecision('photo_focal_y'),
    printedAt: timestamp('printed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'portal_last_prints_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('cascade'),
    check(
      'portal_last_prints_piece_valid',
      sql`${t.piece} IN (${sql.raw(PORTAL_LAST_PRINT_PIECE_SQL_LIST)})`,
    ),
    check(
      'portal_last_prints_orientation_valid',
      sql`${t.orientation} IN (${sql.raw(PORTAL_LAST_PRINT_ORIENTATION_SQL_LIST)})`,
    ),
    check(
      'portal_last_prints_look_valid',
      sql`${t.look} IN (${sql.raw(PORTAL_LAST_PRINT_LOOK_SQL_LIST)})`,
    ),
    check(
      'portal_last_prints_paper_valid',
      sql`${t.paper} IN (${sql.raw(PORTAL_LAST_PRINT_PAPER_SQL_LIST)})`,
    ),
    check(
      'portal_last_prints_printer_valid',
      sql`${t.printer} IN (${sql.raw(PORTAL_LAST_PRINT_PRINTER_SQL_LIST)})`,
    ),
    check(
      'portal_last_prints_call_to_action_valid',
      sql`${t.callToAction} IN (${sql.raw(PORTAL_LAST_PRINT_CTA_SQL_LIST)})`,
    ),
    check(
      'portal_last_prints_quantity_valid',
      sql`${t.quantity} BETWEEN 1 AND ${sql.raw(String(PORTAL_LAST_PRINT_MAX_QUANTITY))}`,
    ),
    check(
      'portal_last_prints_per_sheet_valid',
      sql`${t.perSheet} IS NULL OR ${t.perSheet} >= 1`,
    ),
    check(
      'portal_last_prints_languages_valid',
      sql`jsonb_typeof(${t.languages}) = 'array' AND jsonb_array_length(${t.languages}) BETWEEN 1 AND ${sql.raw(String(PORTAL_LAST_PRINT_MAX_LANGUAGES))}`,
    ),
    check(
      'portal_last_prints_photo_whole',
      sql`(${t.photoAssetId} IS NULL) = (${t.photoFocalX} IS NULL) AND (${t.photoAssetId} IS NULL) = (${t.photoFocalY} IS NULL)`,
    ),
  ],
)
