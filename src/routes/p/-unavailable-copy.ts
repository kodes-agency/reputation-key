// The words of the unavailable page in the language the visitor's browser asks
// for. Its own module, loaded only when a page is unavailable, so none of it
// (the language read, the copy pack loader, the English fallback) is in the
// route's first-paint code.

import { preferredGuestLocale } from '#/contexts/guest/application/preferred-guest-locale'
import {
  unavailableCopyOf,
  type PortalUnavailableCopy,
} from '#/components/features/guest/portal-unavailable-copy'
import { loadGuestPortalCopyV2 } from '#/components/features/guest/public-portal/language-packs/load-guest-copy-v2'
import { readBrowserLanguages } from './-browser-languages'

/**
 * The browser's own language preference picks the page's language (the page has
 * no portal to take a language from, and must not take one from the token), and
 * the one copy pack loads here, with the page's data, so the server render and
 * the hydration read the same words. Null means English: the page draws English
 * by itself, and it is what a read that fails leaves, rather than failing the page.
 */
export async function loadUnavailableCopy(): Promise<PortalUnavailableCopy | null> {
  try {
    const locale = preferredGuestLocale(readBrowserLanguages())
    if (locale === 'en') return null
    return unavailableCopyOf(await loadGuestPortalCopyV2(locale))
  } catch {
    return null
  }
}
