import {
  currentGuestLanguagePack,
  isSupportedGuestLanguagePack,
  type GuestLocale,
} from '#/shared/domain/guest-locale'
import type { GuestPortalCopyV2 } from './guest-copy-v2'

// One pack per request: each locale sits behind its own dynamic import, so a
// request reads (and a client bundle ships) only the language it renders, never
// the whole set. Every catalogue locale has an entry (the type below makes a missing one a
// compile error); a pack is registered in `GUEST_LANGUAGE_PACKS` first.
const PACK_MODULES: Readonly<Record<GuestLocale, () => Promise<GuestPortalCopyV2>>> = {
  en: async () => (await import('./en-v2')).enV2,
  es: async () => (await import('./es-v2')).esV2,
  it: async () => (await import('./it-v2')).itV2,
  fr: async () => (await import('./fr-v2')).frV2,
  de: async () => (await import('./de-v2')).deV2,
  bg: async () => (await import('./bg-v2')).bgV2,
}

const MISMATCH = 'Guest locale and immutable language pack do not match'

/**
 * Loads the v2 copy pack of `locale`, at the version a snapshot pinned or, when
 * none is given, the current one. Fails closed: a locale with no pack, a pinned
 * id that is not a v2 pack of that locale, or a module that does not describe
 * what was asked for all throw rather than render another language.
 */
export async function loadGuestPortalCopyV2(
  locale: GuestLocale,
  version?: unknown,
): Promise<GuestPortalCopyV2> {
  // Only an absent pin means "current": an explicit null is a corrupt snapshot field.
  const resolved = version === undefined ? currentGuestLanguagePack(locale, 2) : version
  if (version === undefined && resolved === null)
    throw new Error(`No guest language pack exists for locale ${locale}`)
  if (!isSupportedGuestLanguagePack(locale, resolved, 2)) throw new Error(MISMATCH)
  const pack = await PACK_MODULES[locale]()
  if (pack.locale !== locale || pack.version !== resolved) throw new Error(MISMATCH)
  return pack
}
