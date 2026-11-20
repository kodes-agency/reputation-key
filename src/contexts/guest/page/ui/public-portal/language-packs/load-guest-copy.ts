import {
  currentGuestLanguagePack,
  isSupportedGuestLanguagePack,
  type GuestLocale,
} from '#/shared/domain/guest-locale'
import type { GuestPortalCopy } from './guest-copy'

// One pack per request: each locale sits behind its own dynamic import, so a
// request reads (and a client bundle ships) only the language it renders, never
// the whole set. Every catalogue locale has an entry (the type below makes a missing one a
// compile error); a pack is registered in `GUEST_LANGUAGE_PACKS` first.
const PACK_MODULES: Readonly<Record<GuestLocale, () => Promise<GuestPortalCopy>>> = {
  en: async () => (await import('./en')).enCopy,
  es: async () => (await import('./es')).esCopy,
  it: async () => (await import('./it')).itCopy,
  fr: async () => (await import('./fr')).frCopy,
  de: async () => (await import('./de')).deCopy,
  bg: async () => (await import('./bg')).bgCopy,
}

const MISMATCH = 'Guest locale and immutable language pack do not match'

/**
 * Loads the copy pack of `locale`, at the version a snapshot pinned or, when
 * none is given, the current one. Fails closed: a locale with no pack, a pinned
 * id that is not a template pack of that locale, or a module that does not describe
 * what was asked for all throw rather than render another language.
 */
export async function loadGuestPortalCopy(
  locale: GuestLocale,
  version?: unknown,
): Promise<GuestPortalCopy> {
  // Only an absent pin means "current": an explicit null is a corrupt snapshot field.
  const resolved = version === undefined ? currentGuestLanguagePack(locale, 2) : version
  if (version === undefined && resolved === null)
    throw new Error(`No guest language pack exists for locale ${locale}`)
  if (!isSupportedGuestLanguagePack(locale, resolved, 2)) throw new Error(MISMATCH)
  const pack = await PACK_MODULES[locale]()
  if (pack.locale !== locale || pack.version !== resolved) throw new Error(MISMATCH)
  return pack
}
