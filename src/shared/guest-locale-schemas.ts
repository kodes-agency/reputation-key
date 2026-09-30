// Zod schemas over the guest-locale catalogue, for the layers that may use zod
// (application, infrastructure, routes, events, db schema). Pure catalogue
// logic stays in `src/shared/domain/guest-locale.ts`, which domain code imports.

import { z } from 'zod/v4'
import {
  GUEST_LOCALES,
  MAX_ADDITIONAL_GUEST_LOCALES,
  OFFERED_GUEST_LOCALES,
} from './domain/guest-locale'

/** Readers: any locale the guest surface can render. */
export const guestLocaleSchema = z.enum(GUEST_LOCALES)

/** Readers: the additional locales of a Portal, bounded by what the catalogue leaves. */
export const additionalGuestLocalesSchema = z
  .array(guestLocaleSchema)
  .max(MAX_ADDITIONAL_GUEST_LOCALES)

/** Manager inputs: only locales that have a reviewed language pack today. */
export const offeredGuestLocaleSchema = z.enum(OFFERED_GUEST_LOCALES)

// SQL renderings of the catalogue, for the CHECK constraints in the Drizzle
// model and for the hand-written migration that widened them (0043). The
// database is deliberately broader than what managers may offer today: the
// application registry stays authoritative and fails closed.

/** `'en', 'es', 'it', 'fr', 'de', 'bg'`, ready for a SQL `IN (...)` list. */
export const GUEST_LOCALE_SQL_LIST = GUEST_LOCALES.map((locale) => `'${locale}'`).join(
  ', ',
)

/**
 * The catalogue as a jsonb literal. Comma-space separators match the text of
 * migration 0043 and how Postgres prints jsonb (`pg_get_constraintdef`, the
 * parity test). `check:schema-drift` ignores the spacing, so this is about
 * textual parity, not drift.
 */
export const GUEST_LOCALE_JSONB_LITERAL = `[${GUEST_LOCALES.map((locale) => `"${locale}"`).join(', ')}]`

/** Any pack id shaped `guest-ui-<locale>-v<1..999>`; the registry decides which exist. */
export const GUEST_LANGUAGE_PACK_SQL_PATTERN = `^guest-ui-(${GUEST_LOCALES.join('|')})-v[1-9][0-9]{0,2}$`
