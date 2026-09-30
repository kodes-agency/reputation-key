import {
  currentGuestLanguagePack,
  isSupportedGuestLanguagePack,
  type GuestLocale,
} from '#/shared/domain/guest-locale'
import type { GuestPortalCopyV2 } from './guest-copy-v2'

// One pack per request: each locale sits behind its own dynamic import, so a
// request reads (and a client bundle ships) only the language it renders, never
// the whole set. Add a locale here when its v2 pack is reviewed and appended to
// `GUEST_LANGUAGE_PACKS`.
const PACK_MODULES: Readonly<
  Partial<Record<GuestLocale, () => Promise<GuestPortalCopyV2>>>
> = {
  en: async () => (await import('./en-v2')).enV2,
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
  const resolved = version ?? currentGuestLanguagePack(locale, 2)
  if (resolved === null)
    throw new Error(`No guest language pack exists for locale ${locale}`)
  if (!isSupportedGuestLanguagePack(locale, resolved, 2)) throw new Error(MISMATCH)
  const load = PACK_MODULES[locale]
  if (!load) throw new Error(`No guest language pack exists for locale ${locale}`)
  const pack = await load()
  if (pack.locale !== locale || pack.version !== resolved) throw new Error(MISMATCH)
  return pack
}
