// The words of the unavailable page in the language the visitor's browser asks
// for. Its own module, loaded only when a page is unavailable, so none of it
// (the server read, the copy pack loader, the English fallback) is in the
// route's first-paint code.

import { getUnavailableGuestLocale } from '#/contexts/guest/server/unavailable-locale'
import {
  unavailableCopyOf,
  type PortalUnavailableCopy,
} from '#/components/features/guest/portal-unavailable-copy'
import { loadGuestPortalCopyV2 } from '#/components/features/guest/public-portal/language-packs/load-guest-copy-v2'

/**
 * The server reads `Accept-Language` (the page has no portal to take a language
 * from, and must not take one from the token), and the one copy pack loads
 * here, with the page's data, so the server render and the hydration read the
 * same words. Null means English: the page draws English by itself, and it is
 * what a lookup that fails leaves, rather than failing the page.
 */
export async function loadUnavailableCopy(): Promise<PortalUnavailableCopy | null> {
  try {
    const { locale } = await getUnavailableGuestLocale()
    if (locale === 'en') return null
    return unavailableCopyOf(await loadGuestPortalCopyV2(locale))
  } catch {
    return null
  }
}
