// Zod schemas over the guest-locale catalogue, for the layers that may use zod
// (application, infrastructure, routes, events, db schema). Pure catalogue
// logic stays in `src/shared/domain/guest-locale.ts`, which domain code imports.

import { z } from 'zod/v4'
import { GUEST_LOCALES, OFFERED_GUEST_LOCALES } from './domain/guest-locale'

/** Readers: any locale the guest surface can render. */
export const guestLocaleSchema = z.enum(GUEST_LOCALES)

/** Manager inputs: only locales that have a reviewed language pack today. */
export const offeredGuestLocaleSchema = z.enum(OFFERED_GUEST_LOCALES)
