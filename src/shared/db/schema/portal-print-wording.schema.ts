// Portal context — Drizzle schema for portal_print_wordings (final print kit,
// saved wording).
//
// One row per Portal: the call to action a manager saved from Share ("Save
// wording") so that Share opens on it next time, and the manager's own words
// where they wrote them. A row holds a wording id and words only: never the
// address, a print code, a file or the person who saved it. A download also
// saves its wording here, so the saved wording is what printed last.

import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { PORTAL_LAST_PRINT_CTA_SQL_LIST } from './portal-last-print.schema'
import { portals } from './portal.schema'

export const portalPrintWordings = pgTable(
  'portal_print_wordings',
  {
    // One row per Portal: the next save replaces it.
    portalId: uuid('portal_id').primaryKey(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    propertyId: uuid('property_id').notNull(),
    // The wording the words show, or the one the manager's own words started from.
    callToAction: varchar('call_to_action', { length: 32 }).notNull(),
    // The manager's own words, per language: { "<locale>": { "headline": …,
    // "subline": … } }. Null when the wording's copy is what Share opens on. The
    // shape of each field is the domain's to check (a save refuses anything else),
    // so the table holds only that it is an object.
    callToActionCustom: jsonb('call_to_action_custom'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'portal_print_wordings_portal_tenant_fk',
      columns: [t.organizationId, t.propertyId, t.portalId],
      foreignColumns: [portals.organizationId, portals.propertyId, portals.id],
    }).onDelete('cascade'),
    check(
      'portal_print_wordings_call_to_action_valid',
      sql`${t.callToAction} IN (${sql.raw(PORTAL_LAST_PRINT_CTA_SQL_LIST)})`,
    ),
    check(
      'portal_print_wordings_call_to_action_custom_valid',
      sql`${t.callToActionCustom} IS NULL OR jsonb_typeof(${t.callToActionCustom}) = 'object'`,
    ),
  ],
)
